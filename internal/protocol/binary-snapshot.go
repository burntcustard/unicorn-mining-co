package protocol

import (
	"errors"
	"math"
	"sort"
	"unicode/utf16"

	"github.com/burntcustard/unicorn-mining-co/internal/specification"
)

var ErrSnapshot = errors.New("invalid binary snapshot")

type Vector = specification.Vector
type ModuleState struct {
	Type, Mount float64
	ID, Health  *float64
	Shades      []string
	Segments    []ModuleSegment
}
type ModuleSegment struct{ Active, ActivationProgress float64 }
type WreckageSegment struct {
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
type EntityRecord struct {
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
	InputLead          *int64
	EntityIDs          []uint64
	Records            []EntityRecord
}

func (w *writer) string(value string) {
	units := utf16.Encode([]rune(value))
	w.unsigned(uint64(len(units)))
	for _, unit := range units {
		w.byte(byte(unit))
		w.byte(byte(unit >> 8))
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
func (w *writer) modules(values []ModuleState) {
	w.unsigned(uint64(len(values)))
	for _, value := range values {
		var mask byte
		if value.ID != nil {
			mask |= 1
		}
		if value.Health != nil {
			mask |= 2
		}
		if value.Shades != nil {
			mask |= 4
		}
		w.byte(mask)
		w.number(value.Type)
		w.number(value.Mount)
		if value.ID != nil {
			w.number(*value.ID)
		}
		if value.Health != nil {
			w.number(*value.Health)
		}
		if value.Shades != nil {
			w.strings(value.Shades)
		}
		w.unsigned(uint64(len(value.Segments)))
		for _, segment := range value.Segments {
			w.number(segment.Active)
			w.number(segment.ActivationProgress)
		}
	}
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
func (w *writer) cargo(values []CargoEntry, protocol specification.Protocol, depth int) error {
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
func (w *writer) field(id int, value any, protocol specification.Protocol, depth int) error {
	fields := protocol.BinaryFieldIDs
	if raw, ok := value.([]byte); ok && (id == fields["cargoContents"] || id == fields["wreckage"]) {
		w.data = append(w.data, raw...)
		return nil
	}
	switch id {
	case fields["cargoContents"]:
		entries, ok := value.([]CargoEntry)
		if !ok {
			return ErrSnapshot
		}
		return w.cargo(entries, protocol, depth)
	case fields["wreckage"]:
		entries, ok := value.([]WreckageSegment)
		if !ok {
			return ErrSnapshot
		}
		w.wreckage(entries)
	case fields["contents"], fields["hullHealth"]:
		values, ok := value.([]float64)
		if !ok {
			return ErrSnapshot
		}
		w.numbers(values)
	case fields["modules"]:
		values, ok := value.([]ModuleState)
		if !ok {
			return ErrSnapshot
		}
		w.modules(values)
	case fields["shapeOutline"]:
		values, ok := value.([][]float64)
		if !ok {
			return ErrSnapshot
		}
		w.outline(values)
	case fields["shades"]:
		values, ok := value.([]string)
		if !ok {
			return ErrSnapshot
		}
		w.strings(values)
	case fields["segments"]:
		values, ok := value.([]AsteroidSegment)
		if !ok {
			return ErrSnapshot
		}
		w.segments(values)
	case fields["position"], fields["velocity"]:
		point, ok := value.(Vector)
		if !ok {
			return ErrSnapshot
		}
		w.vector(point)
	case fields["kind"]:
		kind, ok := value.(string)
		if !ok {
			return ErrSnapshot
		}
		tag, ok := protocol.EntityKindIDs[kind]
		if !ok {
			return ErrSnapshot
		}
		w.byte(byte(tag))
	case fields["label"], fields["message"]:
		label, ok := value.(string)
		if !ok {
			return ErrSnapshot
		}
		w.string(label)
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
func (w *writer) record(value EntityRecord, protocol specification.Protocol, depth int) error {
	if depth > 32 || value.ID > (1<<53)-1 || len(value.Fields) > 33 {
		return ErrSnapshot
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
		if id < 1 || id > 33 {
			return ErrSnapshot
		}
		field := value.Fields[id]
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

func EncodeSnapshot(value Snapshot, protocol specification.Protocol) ([]byte, error) {
	return AppendSnapshot(make([]byte, 0, 4096), value, protocol)
}
func AppendSnapshot(destination []byte, value Snapshot, protocol specification.Protocol) ([]byte, error) {
	if value.Tick > (1<<53)-1 || value.NextEntityID > (1<<53)-1 {
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
func AppendEntityRecord(destination []byte, value EntityRecord, ids specification.Protocol) ([]byte, error) {
	w := writer{data: destination}
	err := w.record(value, ids, 0)
	return w.data, err
}
func AppendField(destination []byte, id int, value any, ids specification.Protocol) ([]byte, error) {
	w := writer{data: destination}
	err := w.field(id, value, ids, 0)
	return w.data, err
}
