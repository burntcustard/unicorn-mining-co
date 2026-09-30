// Port of src/server/binary-replication.ts. The protocol package supplies the
// same wire primitives; revision tracking and shared fragments live here.
package server

import (
	"bytes"
	"github.com/burntcustard/unicorn-mining-co/internal/craft"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"github.com/burntcustard/unicorn-mining-co/internal/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
	"slices"
	"sync/atomic"
)

type nullValue struct{}
type fieldState struct {
	id            int
	compare, wire any
	revision      int64
}
type binaryRecord struct {
	source                                           simulation.Entity
	batchGeneration                                  uint64
	revision, previousRevision                       int64
	fields                                           []fieldState
	recentChanges                                    []int
	modules                                          *moduleRecord
	nested                                           []byte
	fullGeneration, deltaGeneration                  uint64
	fullOffset, fullLength, deltaOffset, deltaLength int
}

func recordOf(source simulation.Entity, fieldCount int) *binaryRecord {
	if record, ok := source.Base().ReplicationState.(*binaryRecord); ok {
		return record
	}
	record := &binaryRecord{source: source, fields: make([]fieldState, fieldCount+1)}
	for id := range record.fields {
		record.fields[id].id = id
	}
	source.Base().ReplicationState = record
	return record
}
func markChanged(record *binaryRecord, field *fieldState) {
	record.revision++
	field.revision = record.revision
	record.recentChanges = append(record.recentChanges, field.id)
}
func changed(record *binaryRecord, field *fieldState, comparison, wire any) {
	field.compare, field.wire = comparison, wire
	markChanged(record, field)
}
func canonical(value float64) any {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return nullValue{}
	}
	if value == 0 {
		return float64(0)
	}
	return value
}
func scalar(record *binaryRecord, id int, value any) {
	field := &record.fields[id]
	if field.compare == value {
		return
	}
	normalized := value
	if number, ok := value.(float64); ok {
		normalized = canonical(number)
	}
	if field.compare == normalized {
		return
	}
	wire := normalized
	if _, null := normalized.(nullValue); null {
		wire = nil
	}
	changed(record, field, normalized, wire)
}
func vector(record *binaryRecord, id int, value *Vec.Vector) {
	field := &record.fields[id]
	if value == nil {
		if field.compare != nil {
			changed(record, field, nil, nil)
		}
		return
	}
	if before, ok := field.compare.(Vec.Vector); ok && before == *value {
		return
	}
	field.compare = *value
	field.wire = *value
	markChanged(record, field)
}
func sameNumbers(a, b []float64) bool {
	if b == nil || len(a) != len(b) {
		return false
	}
	for i, v := range a {
		if canonical(v) != canonical(b[i]) {
			return false
		}
	}
	return true
}
func numberArray(record *binaryRecord, id int, value []float64) {
	field := &record.fields[id]
	if value == nil {
		if field.compare != nil {
			changed(record, field, nil, nil)
		}
		return
	}
	before, _ := field.compare.([]float64)
	if sameNumbers(value, before) {
		return
	}
	changed(record, field, slices.Clone(value), value)
}
func stringArray(record *binaryRecord, id int, value []string) {
	field := &record.fields[id]
	if value == nil {
		if field.compare != nil {
			changed(record, field, nil, nil)
		}
		return
	}
	before, ok := field.compare.([]string)
	if ok && slices.Equal(value, before) {
		return
	}
	changed(record, field, slices.Clone(value), value)
}
func wireOutline(value *simulation.ShapeOutline) [][]float64 {
	if value == nil {
		return nil
	}
	out := make([][]float64, len(value.Points))
	for i, p := range value.Points {
		out[i] = []float64{p[0], p[1]}
	}
	return out
}
func outline(record *binaryRecord, id int, value *simulation.ShapeOutline) {
	field := &record.fields[id]
	if value == nil {
		if field.compare != nil {
			changed(record, field, nil, nil)
		}
		return
	}
	before, ok := field.compare.([][]float64)
	same := ok && len(before) == len(value.Points)
	if same {
		for i, p := range value.Points {
			if len(before[i]) != 2 || canonical(p[0]) != canonical(before[i][0]) || canonical(p[1]) != canonical(before[i][1]) {
				same = false
				break
			}
		}
	}
	if same {
		return
	}
	copy := wireOutline(value)
	changed(record, field, copy, copy)
}
func asteroidSegments(record *binaryRecord, id int, value []*simulation.AsteroidSegment) {
	field := &record.fields[id]
	if value == nil {
		if field.compare != nil {
			changed(record, field, nil, nil)
		}
		return
	}
	previous, _ := field.compare.([]protocol.AsteroidSegment)
	if sameSegments(value, previous) {
		return
	}
	copy := copySegments(value)
	changed(record, field, copy, copy)
}
func clearField(record *binaryRecord, id int) {
	field := &record.fields[id]
	if field.compare != nil {
		changed(record, field, nil, nil)
	}
}
func captureBytes(record *binaryRecord, id int, value any, catalog specification.Catalog) {
	data, err := protocol.AppendField(record.nested[:0], id, value, catalog.Protocol)
	if err != nil {
		panic(err)
	}
	record.nested = data
	field := &record.fields[id]
	previous, _ := field.compare.([]byte)
	if bytes.Equal(data, previous) && previous != nil {
		return
	}
	copy := slices.Clone(data)
	changed(record, field, copy, copy)
}
func fullRecord(record *binaryRecord, baseline int64, replaced *binaryRecord) protocol.EntityRecord {
	fields := map[int]any{}
	order := []int{}
	recent := baseline >= 0 && baseline >= record.previousRevision
	ids := record.recentChanges
	if !recent {
		ids = make([]int, len(record.fields)-1)
		for i := range ids {
			ids[i] = i + 1
		}
	}
	for _, id := range ids {
		field := &record.fields[id]
		removed := replaced != nil && replaced.fields[id].wire != nil && field.wire == nil
		included := field.revision > baseline
		if baseline < 0 {
			included = field.wire != nil || removed
		}
		if !included {
			continue
		}
		fields[id] = field.wire
		order = append(order, id)
	}
	return protocol.EntityRecord{ID: uint64(record.source.Base().ID), Fields: fields, FieldOrder: order}
}
func prepare(source simulation.Entity, batch *BinarySnapshotBatch) *binaryRecord {
	catalog := batch.catalog
	field := catalog.Protocol.BinaryFieldIDs
	record := recordOf(source, len(field))
	if record.batchGeneration == batch.Generation {
		return record
	}
	record.batchGeneration = batch.Generation
	record.previousRevision = record.revision
	record.recentChanges = record.recentChanges[:0]
	o := source.Base()
	if a, ok := source.(*simulation.Asteroid); ok {
		var contents []float64
		if len(a.Contents) > 0 {
			contents = make([]float64, len(a.Contents))
			for i, v := range a.Contents {
				contents[i] = float64(v)
			}
		}
		numberArray(record, field["contents"], contents)
		var decay, maxHealth any
		if a.Decay != 0 {
			decay = a.Decay
		}
		if a.MaxHealth != a.Radius*2 {
			maxHealth = a.MaxHealth
		}
		scalar(record, field["decay"], decay)
		scalar(record, field["maxHealth"], maxHealth)
		outline(record, field["shapeOutline"], a.ShapeOutline)
		var segments []*simulation.AsteroidSegment
		if a.ShapeOutline != nil || a.Damaged() {
			segments = a.Segments()
		}
		asteroidSegments(record, field["segments"], segments)
	}
	c, crafted := source.(interface{ CraftBase() *craft.Craft })
	if crafted {
		entity := c.CraftBase()
		cargo := entity.CargoContents
		if len(cargo) > 0 {
			entries := make([]protocol.CargoEntry, len(cargo))
			sourceModules := entity.Modules()
			for i, object := range cargo {
				if module, ok := object.(simulation.Module); ok {
					index := float64(slices.Index(sourceModules, module))
					entries[i].ModuleIndex = &index
				} else {
					nested := fullRecord(prepare(object, batch), -1, nil)
					entries[i].Entity = &nested
				}
			}
			captureBytes(record, field["cargoContents"], entries, catalog)
		} else {
			clearField(record, field["cargoContents"])
		}
		var credits, docked, launching, maxSpeed any
		if entity.HasCredits {
			credits = entity.Credits
		}
		if entity.DockedTo != nil {
			docked = float64(*entity.DockedTo)
		}
		if entity.HasLaunching {
			launching = entity.Launching
		}
		if _, ok := source.(interface{ ShipBase() *craft.Ship }); ok {
			maxSpeed = source.MaxSpeed()
		} else if !math.IsNaN(o.SpeedLimit) {
			maxSpeed = o.SpeedLimit
		}
		scalar(record, field["credits"], credits)
		scalar(record, field["dockedTo"], docked)
		if o.Kind != "station" {
			numberArray(record, field["hullHealth"], entity.HullHealth())
		}
		scalar(record, field["launching"], launching)
		scalar(record, field["maxSpeed"], maxSpeed)
		states := readModules(entity, &record.modules)
		f := &record.fields[field["modules"]]
		if states != nil {
			if f.compare != states {
				changed(record, f, states, states.states)
			}
		} else if f.compare != nil {
			changed(record, f, nil, nil)
		}
		wreckage := entity.Wreckage()
		if wreckage != nil {
			values := make([]protocol.WreckageSegment, len(wreckage))
			for i, w := range wreckage {
				values[i] = protocol.WreckageSegment{Radius: w.Radius, Offset: w.Offset, Health: w.Health, FillShade: w.FillShade, Stroke: w.Stroke}
				if w.ShapeOutline != nil {
					values[i].ShapeOutline = wireOutline(&simulation.ShapeOutline{Points: w.ShapeOutline})
				}
			}
			captureBytes(record, field["wreckage"], values, catalog)
		} else {
			clearField(record, field["wreckage"])
		}
		var decay any
		if entity.Decay != 0 {
			decay = entity.Decay
		}
		scalar(record, field["decay"], decay)
		shades := entity.Shades
		if slices.Equal(shades, catalog.Colors["white"]) {
			shades = nil
		}
		stringArray(record, field["shades"], shades)
	}
	if s, ok := source.(interface{ ShipBase() *craft.Ship }); ok {
		ship := s.ShipBase()
		scalar(record, field["thrust"], ship.Forward)
		scalar(record, field["turn"], ship.Turn)
	}
	defaultFriction := 0.01
	if crafted || o.Kind == "asteroid" {
		defaultFriction = 0.2
	}
	if module, ok := source.(simulation.Module); ok && module.ModuleBase().Definition.Friction != nil {
		defaultFriction = *module.ModuleBase().Definition.Friction
	}
	var friction, health, label, message, paint, player, pointCount, radiusEven, resource, mass, pending any
	if o.Friction != defaultFriction {
		friction = o.Friction
	}
	if !math.IsNaN(o.Health) && !(o.Kind == "asteroid" && o.Health == o.Radius*2) && !(crafted && o.Health == 100) {
		health = o.Health
	}
	if o.Label != "" {
		label = o.Label
	}
	if o.Message != nil {
		message = *o.Message
	}
	if o.HasPaint {
		paint = float64(o.Paint)
	}
	if o.PlayerID != nil {
		player = float64(*o.PlayerID)
	}
	if o.PointCount != 0 {
		pointCount = float64(o.PointCount)
	}
	if o.RadiusEven != nil {
		radiusEven = *o.RadiusEven
	}
	if o.HasResource {
		resource = float64(o.Resource)
	}
	scalar(record, field["friction"], friction)
	scalar(record, field["health"], health)
	scalar(record, field["label"], label)
	scalar(record, field["message"], message)
	scalar(record, field["paint"], paint)
	scalar(record, field["playerId"], player)
	scalar(record, field["pointCount"], pointCount)
	scalar(record, field["radiusEven"], radiusEven)
	scalar(record, field["resource"], resource)
	kind := "object"
	if o.Kind == "asteroid" {
		kind = "asteroid"
	} else if o.Item {
		kind = "item"
	} else if o.Kind == "station" {
		kind = "station"
	} else if crafted {
		kind = "ship"
	}
	scalar(record, field["kind"], kind)
	if !(o.Kind == "asteroid" && o.Mass == 0.4*(o.Radius*o.Radius)) {
		mass = o.Mass
	}
	if o.PendingUpdateTime != 0 {
		pending = o.PendingUpdateTime
	}
	scalar(record, field["mass"], mass)
	scalar(record, field["pendingUpdateTime"], pending)
	vector(record, field["position"], &o.Position)
	scalar(record, field["radius"], o.Radius)
	scalar(record, field["rotation"], o.Rotation)
	scalar(record, field["spin"], o.Spin)
	var velocity *Vec.Vector
	if o.Velocity.X != 0 || o.Velocity.Y != 0 {
		velocity = &o.Velocity
	}
	vector(record, field["velocity"], velocity)
	return record
}

var nextBatchGeneration atomic.Uint64

type fragment struct{ offset, length int }
type BinarySnapshotBatch struct {
	records    map[int64]*binaryRecord
	arena      []byte
	Generation uint64
	View       *ReplicationView
	catalog    specification.Catalog
}

func NewBinarySnapshotBatch(catalog specification.Catalog) *BinarySnapshotBatch {
	return &BinarySnapshotBatch{records: map[int64]*binaryRecord{}, arena: make([]byte, 0, 4096), catalog: catalog}
}
func (b *BinarySnapshotBatch) Begin(view *ReplicationView) *BinarySnapshotBatch {
	b.Generation = nextBatchGeneration.Add(1)
	b.View = view
	clear(b.records)
	b.arena = b.arena[:0]
	return b
}
func (b *BinarySnapshotBatch) prepared(source simulation.Entity) *binaryRecord {
	id := source.Base().ID
	record := b.records[id]
	if record == nil || record.source != source {
		record = prepare(source, b)
		b.records[id] = record
	}
	return record
}
func (b *BinarySnapshotBatch) fragment(record *binaryRecord, baseline int64, replaced *binaryRecord) *fragment {
	full := baseline < 0
	if full && replaced == nil && record.fullGeneration == b.Generation {
		return &fragment{record.fullOffset, record.fullLength}
	}
	if !full && baseline >= record.revision {
		return nil
	}
	if !full && baseline == record.previousRevision && record.deltaGeneration == b.Generation {
		if record.deltaLength == 0 {
			return nil
		}
		return &fragment{record.deltaOffset, record.deltaLength}
	}
	offset := len(b.arena)
	value := fullRecord(record, baseline, replaced)
	count := len(value.Fields)
	length := 0
	if count > 0 {
		data, err := protocol.AppendEntityRecord(b.arena, value, b.catalog.Protocol)
		if err != nil {
			panic(err)
		}
		b.arena = data
		length = len(data) - offset
	}
	if full && replaced == nil {
		record.fullGeneration = b.Generation
		record.fullOffset = offset
		record.fullLength = length
	}
	if !full && baseline == record.previousRevision {
		record.deltaGeneration = b.Generation
		record.deltaOffset = offset
		record.deltaLength = length
	}
	if count == 0 {
		return nil
	}
	return &fragment{offset, length}
}

type SnapshotOptions struct {
	World                                  *simulation.World
	ShipID                                 int64
	Position                               Vec.Vector
	AcknowledgedSequence, SnapshotSequence *uint64
	InputLead                              *int64
	ReplicationView                        *ReplicationView
	BinaryBatch                            *BinarySnapshotBatch
}
type member struct {
	record   *binaryRecord
	revision int64
	seen     uint64
}
type BinaryReplicationManager struct {
	snapshotTick, stamp uint64
	writer              []byte
	entityIDs           []uint64
	fragments           []fragment
	members             *utilities.OrderedMap[int64, *member]
	catalog             specification.Catalog
}

func NewBinaryReplicationManager(catalog specification.Catalog) *BinaryReplicationManager {
	return &BinaryReplicationManager{catalog: catalog, writer: make([]byte, 0, 4096), members: utilities.NewOrderedMap[int64, *member]()}
}
func (m *BinaryReplicationManager) Initial(options SnapshotOptions) []byte {
	m.members.Clear()
	return m.encode(options, true)
}
func (m *BinaryReplicationManager) Snapshot(options SnapshotOptions) []byte {
	return m.encode(options, false)
}
func (m *BinaryReplicationManager) encode(options SnapshotOptions, load bool) []byte {
	world := options.World
	view := options.ReplicationView
	if view == nil {
		view = NewReplicationView(world)
	}
	batch := options.BinaryBatch
	if batch == nil {
		batch = NewBinarySnapshotBatch(m.catalog).Begin(view)
	}
	list := view.Entities()
	position := options.Position
	if ship, ok := world.Entities.Get(options.ShipID); ok {
		position = ship.Base().Position
	}
	m.stamp++
	stamp := m.stamp
	previousSize := m.members.Len()
	retained := 0
	membershipChanged := false
	m.entityIDs = m.entityIDs[:0]
	m.fragments = m.fragments[:0]
	rules := m.catalog.Simulation
	ranges := rules.Replication
	for i, e := range list {
		object := e.Base()
		dx, dy := object.Position.X-position.X, object.Position.Y-position.Y
		distance := dx*dx + dy*dy
		station := view.Kinds[i]&1 != 0
		if distance > ranges.EntityUnload*ranges.EntityUnload && object.ID != options.ShipID && (distance > ranges.MarkerUnload*ranges.MarkerUnload || !station) {
			continue
		}
		previous, loaded := m.members.Get(object.ID)
		reach := ranges.EntityLoad
		if loaded {
			reach = ranges.EntityUnload
		}
		if station {
			reach = ranges.MarkerLoad
			if loaded {
				reach = ranges.MarkerUnload
			}
		}
		if object.ID != options.ShipID && !(distance <= reach*reach) {
			continue
		}
		m.entityIDs = append(m.entityIDs, uint64(object.ID))
		if loaded {
			previous.seen = stamp
			retained++
		} else {
			membershipChanged = true
		}
		interval := rules.UpdateTiers["distant"].ReplicateEvery
		if distance <= rules.VisibleRange*rules.VisibleRange {
			interval = rules.UpdateTiers["visible"].ReplicateEvery
		}
		phase := 0
		if view.Kinds[i] > 1 {
			interval = max(interval, rules.BallisticReplicateEvery)
			phase = view.Phases[i]
		}
		tick, old := world.Tick+uint64(phase), m.snapshotTick+uint64(phase)
		if loaded && tick%uint64(interval) != 0 && tick/uint64(interval) == old/uint64(interval) {
			continue
		}
		prepared := batch.prepared(e)
		var previousRecord *binaryRecord
		revision := int64(-1)
		if loaded {
			previousRecord = previous.record
			if previousRecord == prepared {
				revision = previous.revision
			}
			previous.record = prepared
			previous.revision = prepared.revision
		} else {
			m.members.Set(object.ID, &member{prepared, prepared.revision, stamp})
		}
		replaced := previousRecord
		if replaced == prepared {
			replaced = nil
		}
		if f := batch.fragment(prepared, revision, replaced); f != nil {
			m.fragments = append(m.fragments, *f)
		}
	}
	membershipChanged = membershipChanged || retained != previousSize
	m.snapshotTick = world.Tick
	if membershipChanged {
		m.members.ForEach(func(member *member, id int64) {
			if member.seen != stamp {
				m.members.Delete(id)
			}
		})
	}
	fragments := make([][]byte, len(m.fragments))
	for i, f := range m.fragments {
		fragments[i] = batch.arena[f.offset : f.offset+f.length]
	}
	data, err := protocol.AppendSnapshot(m.writer[:0], protocol.Snapshot{Load: load, MembershipChanged: membershipChanged, Tick: world.Tick, NextEntityID: uint64(world.NextEntityID), Ack: options.AcknowledgedSequence, InputLead: options.InputLead, Sequence: options.SnapshotSequence, EntityIDs: m.entityIDs, Fragments: fragments}, m.catalog.Protocol)
	if err != nil {
		panic(err)
	}
	m.writer = data
	return slices.Clone(data)
}
