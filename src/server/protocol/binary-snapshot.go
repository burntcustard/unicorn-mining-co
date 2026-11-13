package protocol

import (
	"encoding/binary"
	"errors"
	"math"
	"slices"
	"sort"
	"unicode/utf16"

	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

var ErrSnapshot = errors.New("invalid binary snapshot")

type Vector = specs.Vector

type ModuleState struct {
	Type, Mount                                               float64
	ID, Health, HealthActivated, FireCooldown, ChargeCooldown *float64
	AimRotation                                               *float64
	Shades                                                    []string
	Segments                                                  []ModuleSegment
}

type ModuleSegment struct{ Active, ActivationProgress float64 }

type WreckageSegment struct {
	Color        string
	Radius       float64
	Offset       Vector
	Health       float64
	ShapeOutline [][]float64
	FillShade    *float64
	Stroke       [][][]float64
}

type AsteroidSegment struct {
	Contents                []float64
	Health, Mass, MaxHealth float64
	ShapeOutline            [][]float64
}

type CargoEntry struct {
	ModuleIndex *float64
	Entity      *EntityRecord
}

type FieldValue struct {
	ID    int
	Value any
}

type EntityRecord struct {
	Values     []FieldValue
	FieldOrder []int
	ID         uint64
	// A nil value clears a previously replicated field.
	Fields map[int]any
}

type Snapshot struct {
	Fragments          [][]byte
	Load               bool
	MembershipChanged  bool
	Tick, NextEntityID uint64
	Ack, Sequence      *uint64
	DockSequence       *uint64
	Credits            *float64
	DockIDs            [][2]int64
	InputLead          *int64
	EntityIDs          []uint64
	// Snapshot flag 64 carries a replacement radar position list. Nil retains
	// the previous list; an empty non-nil slice clears it.
	AsteroidPositions []Vector
	Records           []EntityRecord
}

func (w *writer) string(value string) {
	units := uint64(0)

	for _, r := range value {
		units++

		if r > 0xffff {
			units++
		}
	}

	w.unsigned(units)

	for _, r := range value {
		if r <= 0xffff {
			w.data = append(w.data, byte(r), byte(r>>8))
		} else {
			high, low := utf16.EncodeRune(r)
			w.data = append(w.data, byte(high), byte(high>>8), byte(low), byte(low>>8))
		}
	}
}

func (w *writer) vector(value Vector) { w.number(value.X); w.number(value.Y) }

func (w *writer) numbers(values []float64) {
	w.unsigned(uint64(len(values)))

	for _, value := range values {
		w.number(value)
	}
}

func (w *writer) strings(values []string) {
	w.unsigned(uint64(len(values)))

	for _, value := range values {
		w.string(value)
	}
}

func (w *writer) outline(values [][]float64) {
	w.unsigned(uint64(len(values)))

	for _, point := range values {
		w.numbers(point)
	}
}

// Zigzag encoding must remain an exact JavaScript integer after doubling.
func compactInteger(value float64) bool {
	return !(value == 0 && math.Signbit(value)) &&
		value >= -(1<<52-1) && value <= 1<<52-1 && math.Trunc(value) == value
}

func compactSegment(value float64) byte {
	if value == 0 && !math.Signbit(value) {
		return 0
	}

	if value == 1 {
		return 1
	}

	return 2
}

// ModuleDelta describes the state already received by an observer.
type ModuleDelta struct {
	Revisions, ShadeRevisions []int64
	Baseline, LayoutRevision  int64
}

func (w *writer) modules(values []ModuleState, palettes [][]string, delta *ModuleDelta) error {
	partial := delta != nil && delta.Baseline >= delta.LayoutRevision &&
		len(delta.Revisions) == len(values) && len(delta.ShadeRevisions) == len(values)
	count := uint64(len(values)) << 1

	if partial {
		count++
	}

	w.unsigned(count)

	if partial {
		for start := 0; start < len(values); start += 8 {
			var mask byte

			for i := start; i < min(start+8, len(values)); i++ {
				if delta.Revisions[i] > delta.Baseline {
					mask |= 1 << (i - start)
				}
			}

			w.byte(mask)
		}
	}

	for index, value := range values {
		if partial && delta.Revisions[index] <= delta.Baseline {
			continue
		}

		if !compactInteger(value.Type) || !compactInteger(value.Mount) || value.ID != nil && !compactInteger(*value.ID) {
			return ErrSnapshot
		}

		var mask byte

		if value.ID != nil {
			mask |= 1
		}

		if value.Health != nil {
			mask |= 2
		}

		if value.Shades != nil {
			if partial && delta.ShadeRevisions[index] <= delta.Baseline && value.ID != nil {
				mask |= 128
			} else {
				mask |= 4
			}
		}

		if value.FireCooldown != nil {
			mask |= 8
		}

		if value.ChargeCooldown != nil {
			mask |= 16
		}

		if value.HealthActivated != nil {
			mask |= 32
		}

		if value.AimRotation != nil {
			mask |= 64
		}

		w.byte(mask)
		w.signed(int64(value.Type))
		w.signed(int64(value.Mount))

		if value.ID != nil {
			w.signed(int64(*value.ID))
		}

		if value.Health != nil {
			w.number(*value.Health)
		}

		if mask&4 != 0 {
			palette := slices.IndexFunc(palettes, func(p []string) bool { return slices.Equal(p, value.Shades) })

			if palette < 0 || palette > 255 {
				return ErrSnapshot
			}

			w.byte(byte(palette))
		}

		if value.FireCooldown != nil {
			w.number(*value.FireCooldown)
		}

		if value.ChargeCooldown != nil {
			w.number(*value.ChargeCooldown)
		}

		if value.HealthActivated != nil {
			w.number(*value.HealthActivated)
		}

		if value.AimRotation != nil {
			w.number(*value.AimRotation)
		}

		w.unsigned(uint64(len(value.Segments)))

		for _, segment := range value.Segments {
			active, progress := compactSegment(segment.Active), compactSegment(segment.ActivationProgress)
			w.byte(active | progress<<2)

			if active == 2 {
				w.number(segment.Active)
			}

			if progress == 2 {
				w.number(segment.ActivationProgress)
			}
		}
	}

	return nil
}

func (w *writer) wreckage(values []WreckageSegment) {
	w.unsigned(uint64(len(values)))

	for _, value := range values {
		var mask byte

		if value.ShapeOutline != nil {
			mask |= 1
		}

		if value.FillShade != nil {
			mask |= 2
		}

		if value.Stroke != nil {
			mask |= 4
		}

		if value.Color != "" {
			mask |= 8
		}

		w.byte(mask)
		w.number(value.Radius)
		w.vector(value.Offset)
		w.number(value.Health)

		if value.ShapeOutline != nil {
			w.outline(value.ShapeOutline)
		}

		if value.FillShade != nil {
			w.number(*value.FillShade)
		}

		if value.Color != "" {
			w.string(value.Color)
		}

		if value.Stroke != nil {
			w.unsigned(uint64(len(value.Stroke)))

			for _, outline := range value.Stroke {
				w.outline(outline)
			}
		}
	}
}

func (w *writer) segments(values []AsteroidSegment) {
	w.unsigned(uint64(len(values)))

	for _, value := range values {
		w.numbers(value.Contents)
		w.number(value.Health)
		w.number(value.Mass)
		w.number(value.MaxHealth)
		w.outline(value.ShapeOutline)
	}
}

func (w *writer) cargo(values []CargoEntry, protocol specs.Protocol, depth int) error {
	w.unsigned(uint64(len(values)))

	for _, value := range values {
		if value.ModuleIndex != nil {
			w.byte(0)
			w.number(*value.ModuleIndex)
		} else if value.Entity != nil {
			w.byte(1)

			if err := w.record(*value.Entity, protocol, depth+1); err != nil {
				return err
			}
		} else {
			return ErrSnapshot
		}
	}

	return nil
}

func (w *writer) field(id int, value any, protocol specs.Protocol, depth int) error {
	fields := protocol.BinaryFieldIDs

	if raw, ok := value.([]byte); ok && (id == fields.CargoContents || id == fields.Wreckage) {
		w.data = append(w.data, raw...)
		return nil
	}

	switch id {
	case fields.Thrust, fields.Turn:
		number, ok := value.(float64)

		if !ok {
			return ErrSnapshot
		}

		switch number {
		case 0:
			w.byte(0)
		case 1:
			w.byte(1)
		case -1:
			w.byte(2)
		default:
			w.byte(3)
			w.number(number)
		}
	case fields.Firing, fields.Hostile:
		flag, ok := value.(bool)

		if !ok {
			return ErrSnapshot
		}

		if flag {
			w.byte(1)
		} else {
			w.byte(0)
		}
	case fields.CargoContents:
		entries, ok := value.([]CargoEntry)

		if !ok {
			return ErrSnapshot
		}

		return w.cargo(entries, protocol, depth)
	case fields.Wreckage:
		entries, ok := value.([]WreckageSegment)

		if !ok {
			return ErrSnapshot
		}

		w.wreckage(entries)
	case fields.Contents, fields.HullHealth:
		values, ok := value.([]float64)

		if !ok {
			return ErrSnapshot
		}

		w.numbers(values)
	case fields.Modules:
		values, ok := value.([]ModuleState)

		if !ok {
			return ErrSnapshot
		}

		var delta *ModuleDelta

		if depth == 0 {
			delta = w.moduleDelta
		}

		return w.modules(values, protocol.ModulePalettes, delta)
	case fields.ShapeOutline:
		values, ok := value.([][]float64)

		if !ok {
			return ErrSnapshot
		}

		w.outline(values)
	case fields.Shades:
		values, ok := value.([]string)

		if !ok {
			return ErrSnapshot
		}

		w.strings(values)
	case fields.Segments:
		values, ok := value.([]AsteroidSegment)

		if !ok {
			return ErrSnapshot
		}

		w.segments(values)
	case fields.Position, fields.Velocity:
		point, ok := value.(Vector)

		if !ok {
			return ErrSnapshot
		}

		w.vector(point)
	case fields.Kind:
		kind, ok := value.(string)

		if !ok {
			return ErrSnapshot
		}

		tag, ok := protocol.EntityKindIDs[kind]

		if !ok {
			return ErrSnapshot
		}

		w.byte(byte(tag))
	case fields.Name, fields.Message, fields.DefinitionID, fields.DestinationName, fields.TargetLabel, fields.NPCState:
		name, ok := value.(string)

		if !ok {
			return ErrSnapshot
		}

		w.string(name)
	default:
		number, ok := value.(float64)

		if !ok {
			return ErrSnapshot
		}

		if math.IsNaN(number) || math.IsInf(number, 0) {
			w.number(math.NaN())
		} else {
			w.number(number)
		}
	}

	return nil
}

// Motion rounding often leaves exact zero low bytes in the float64 encoding.
// Retain all eight bytes for values that do not have those zero bytes.
func (w *writer) motionField(id int, value any, protocol specs.Protocol) bool {
	fields := protocol.BinaryFieldIDs

	if id == fields.Position || id == fields.Velocity {
		point, ok := value.(Vector)

		if !ok {
			return false
		}

		x, y := math.Float64bits(point.X), math.Float64bits(point.Y)

		if (x|y)&0xffff != 0 {
			return false
		}

		if id == fields.Position {
			w.unsigned(uint64(fields.PackedPosition << 1))
		} else {
			w.unsigned(uint64(fields.PackedVelocity << 1))
		}

		var bytes [8]byte

		binary.LittleEndian.PutUint64(bytes[:], x)
		w.data = append(w.data, bytes[2:]...)
		binary.LittleEndian.PutUint64(bytes[:], y)
		w.data = append(w.data, bytes[2:]...)

		return true
	}

	if id == fields.Rotation || id == fields.Spin {
		number, ok := value.(float64)

		if !ok {
			return false
		}

		bits := math.Float64bits(number)

		if bits&0xffffff != 0 {
			return false
		}

		if id == fields.Rotation {
			w.unsigned(uint64(fields.PackedRotation << 1))
		} else {
			w.unsigned(uint64(fields.PackedSpin << 1))
		}

		var bytes [8]byte

		binary.LittleEndian.PutUint64(bytes[:], bits)
		w.data = append(w.data, bytes[3:]...)

		return true
	}

	return false
}

func (w *writer) record(value EntityRecord, protocol specs.Protocol, depth int) error {
	if depth > 32 || value.ID > (1<<53)-1 || len(value.Fields) > protocol.BinaryFieldIDs.NPCState {
		return ErrSnapshot
	}

	if value.Values != nil {
		if len(value.Values) > protocol.BinaryFieldIDs.NPCState {
			return ErrSnapshot
		}

		w.unsigned(value.ID)
		w.unsigned(uint64(len(value.Values)))

		for _, field := range value.Values {
			if field.ID < 1 || field.ID > protocol.BinaryFieldIDs.NPCState {
				return ErrSnapshot
			}

			if w.motionField(field.ID, field.Value, protocol) {
				continue
			}

			tag := uint64(field.ID << 1)

			if field.Value == nil {
				tag++
			}

			w.unsigned(tag)

			if field.Value != nil {
				if err := w.field(field.ID, field.Value, protocol, depth); err != nil {
					return err
				}
			}
		}

		return nil
	}

	w.unsigned(value.ID)
	w.unsigned(uint64(len(value.Fields)))
	ids := value.FieldOrder

	if ids == nil {
		ids = make([]int, 0, len(value.Fields))

		for id := range value.Fields {
			ids = append(ids, id)
		}

		sort.Ints(ids)
	}

	for _, id := range ids {
		if id < 1 || id > protocol.BinaryFieldIDs.NPCState {
			return ErrSnapshot
		}

		field := value.Fields[id]

		if w.motionField(id, field, protocol) {
			continue
		}

		tag := uint64(id << 1)

		if field == nil {
			tag++
		}

		w.unsigned(tag)

		if field != nil {
			if err := w.field(id, field, protocol, depth); err != nil {
				return err
			}
		}
	}

	return nil
}

func EncodeSnapshot(value Snapshot, protocol specs.Protocol) ([]byte, error) {
	return AppendSnapshot(make([]byte, 0, 4096), value, protocol)
}

func AppendSnapshot(destination []byte, value Snapshot, protocol specs.Protocol) ([]byte, error) {
	if value.Tick > (1<<53)-1 || value.NextEntityID > (1<<53)-1 {
		return nil, ErrSnapshot
	}

	if value.DockSequence != nil && (value.Credits == nil || *value.Credits < 0 || math.IsNaN(*value.Credits) || math.IsInf(*value.Credits, 0)) {
		return nil, ErrSnapshot
	}

	w := writer{data: destination}
	var flags byte

	if value.Load {
		flags |= 1
	}

	if value.MembershipChanged && !value.Load {
		flags |= 2
	}

	if value.Ack != nil {
		flags |= 4
	}

	if value.InputLead != nil {
		flags |= 8
	}

	if value.Sequence != nil {
		flags |= 16
	}

	if value.DockSequence != nil {
		flags |= 32
	}

	if value.AsteroidPositions != nil {
		flags |= 64
	}

	w.data = append(w.data, 0x55, 0x4d, 1, flags)
	w.unsigned(value.Tick)
	w.unsigned(value.NextEntityID)

	if value.Ack != nil {
		w.unsigned(*value.Ack)
	}

	if value.InputLead != nil {
		w.signed(*value.InputLead)
	}

	if value.Sequence != nil {
		w.unsigned(*value.Sequence)
	}

	if value.DockSequence != nil {
		w.unsigned(*value.DockSequence)
		w.number(*value.Credits)
		w.unsigned(uint64(len(value.DockIDs)))

		for _, pair := range value.DockIDs {
			w.signed(pair[0])
			w.signed(pair[1])
		}
	}

	if flags&64 != 0 {
		w.unsigned(uint64(len(value.AsteroidPositions)))

		for _, position := range value.AsteroidPositions {
			w.vector(position)
		}
	}

	if flags&2 != 0 {
		w.unsigned(uint64(len(value.EntityIDs)))

		for _, id := range value.EntityIDs {
			w.unsigned(id)
		}
	}

	if value.Fragments != nil {
		w.unsigned(uint64(len(value.Fragments)))

		for _, fragment := range value.Fragments {
			w.data = append(w.data, fragment...)
		}

		return w.data, nil
	}

	w.unsigned(uint64(len(value.Records)))

	for _, record := range value.Records {
		if err := w.record(record, protocol, 0); err != nil {
			return nil, err
		}
	}

	return w.data, nil
}

// Append helpers share the wire primitives with the authoritative replication
// writer while allowing its reusable arena to own the backing storage.
func AppendEntityRecord(destination []byte, value EntityRecord, ids specs.Protocol) ([]byte, error) {
	return AppendEntityRecordDelta(destination, value, ids, nil)
}

func AppendEntityRecordDelta(destination []byte, value EntityRecord, ids specs.Protocol, delta *ModuleDelta) ([]byte, error) {
	w := writer{data: destination, moduleDelta: delta}
	err := w.record(value, ids, 0)
	return w.data, err
}

func AppendField(destination []byte, id int, value any, ids specs.Protocol) ([]byte, error) {
	w := writer{data: destination}
	err := w.field(id, value, ids, 0)
	return w.data, err
}
