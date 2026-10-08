// Port of src/server/binary-replication.ts. The protocol package supplies the
// same wire primitives; revision tracking and shared fragments live here.
package network

import (
	"bytes"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"math/bits"
	"slices"
	"sync/atomic"
)

type nullValue struct{}

type fieldState struct {
	compare, wire any
	revision      int64
}

type binaryRecord struct {
	numberValues                                     []float64
	numberMask                                       uint64
	source                                           simulation.Entity
	batchGeneration                                  uint64
	revision, previousRevision                       int64
	fields                                           []fieldState
	recentChanges                                    []int
	modules                                          *moduleRecord
	moduleBuffer                                     []simulation.Module
	mountBuffer                                      []*simulation.Mount
	nested                                           []byte
	values                                           []protocol.FieldValue
	hullHealth                                       []float64
	fullGeneration, deltaGeneration                  uint64
	fullOffset, fullLength, deltaOffset, deltaLength int
}

func recordOf(source simulation.Entity, fieldCount int) *binaryRecord {
	if record, ok := source.Base().ReplicationState.(*binaryRecord); ok {
		return record
	}

	record := &binaryRecord{source: source, fields: make([]fieldState, fieldCount+1), numberValues: make([]float64, fieldCount+1)}
	source.Base().ReplicationState = record
	return record
}

func markChanged(record *binaryRecord, id int) {
	field := &record.fields[id]
	record.numberMask &^= uint64(1) << id
	record.revision++
	field.revision = record.revision
	record.recentChanges = append(record.recentChanges, id)
}

func changed(record *binaryRecord, id int, comparison, wire any) {
	field := &record.fields[id]
	field.compare, field.wire = comparison, wire
	markChanged(record, id)
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

	changed(record, id, normalized, wire)
}

func vector(record *binaryRecord, id int, value *Vec.Vector) {
	field := &record.fields[id]

	if value == nil {
		if field.compare != nil {
			changed(record, id, nil, nil)
		}

		return
	}

	if before, ok := field.compare.(Vec.Vector); ok && before == *value {
		return
	}

	boxed := any(*value)
	field.compare = boxed
	field.wire = boxed
	markChanged(record, id)
}

func sameNumbers(a, b []float64) bool {
	if b == nil || len(a) != len(b) {
		return false
	}

	for i, v := range a {
		if v == b[i] {
			continue
		}

		if (math.IsNaN(v) || math.IsInf(v, 0)) && (math.IsNaN(b[i]) || math.IsInf(b[i], 0)) {
			continue
		}

		return false
	}

	return true
}

func numberArray(record *binaryRecord, id int, value []float64) {
	field := &record.fields[id]

	if value == nil {
		if field.compare != nil {
			changed(record, id, nil, nil)
		}

		return
	}

	before, _ := field.compare.([]float64)

	if sameNumbers(value, before) {
		return
	}

	changed(record, id, slices.Clone(value), value)
}

func integerArray(record *binaryRecord, id int, value []int) {
	if len(value) == 0 {
		clearField(record, id)
		return
	}

	field := &record.fields[id]
	before, _ := field.compare.([]float64)
	same := len(before) == len(value)

	if same {
		for i, v := range value {
			if before[i] != float64(v) {
				same = false
				break
			}
		}
	}

	if same {
		return
	}

	numbers := make([]float64, len(value))

	for i, v := range value {
		numbers[i] = float64(v)
	}

	changed(record, id, numbers, numbers)
}

func stringArray(record *binaryRecord, id int, value []string) {
	field := &record.fields[id]

	if value == nil {
		if field.compare != nil {
			changed(record, id, nil, nil)
		}

		return
	}

	before, ok := field.compare.([]string)

	if ok && slices.Equal(value, before) {
		return
	}

	changed(record, id, slices.Clone(value), value)
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
			changed(record, id, nil, nil)
		}

		return
	}

	before, ok := field.compare.([][]float64)
	same := ok && len(before) == len(value.Points)

	if same {
		for i, p := range value.Points {
			if len(before[i]) != 2 || !sameNumbers(p[:], before[i]) {
				same = false
				break
			}
		}
	}

	if same {
		return
	}

	copy := wireOutline(value)
	changed(record, id, copy, copy)
}

func asteroidSegments(record *binaryRecord, id int, value []*simulation.AsteroidSegment) {
	field := &record.fields[id]

	if value == nil {
		if field.compare != nil {
			changed(record, id, nil, nil)
		}

		return
	}

	previous, _ := field.compare.([]protocol.AsteroidSegment)

	if sameSegments(value, previous) {
		return
	}

	copy := copySegments(value)
	changed(record, id, copy, copy)
}

func clearField(record *binaryRecord, id int) {
	field := &record.fields[id]

	if field.compare != nil {
		changed(record, id, nil, nil)
	}
}

func captureBytes(record *binaryRecord, id int, value any, catalog *specs.Catalog) {
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
	changed(record, id, copy, copy)
}

func fullRecord(record *binaryRecord, baseline int64, replaced *binaryRecord) protocol.EntityRecord {
	if record.values == nil {
		record.values = make([]protocol.FieldValue, 0, len(record.fields)-1)
	}

	clear(record.values)
	values := record.values[:0]
	recent := baseline >= 0 && baseline >= record.previousRevision
	count := len(record.fields) - 1

	if recent {
		count = len(record.recentChanges)
	}

	for i := 0; i < count; i++ {
		id := i + 1

		if recent {
			id = record.recentChanges[i]
		}

		field := &record.fields[id]
		removed := replaced != nil && replaced.fields[id].wire != nil && field.wire == nil
		included := field.revision > baseline

		if baseline < 0 {
			included = field.wire != nil || removed
		}

		if !included {
			continue
		}

		values = append(values, protocol.FieldValue{ID: id, Value: field.wire})
	}

	record.values = values
	return protocol.EntityRecord{ID: uint64(record.source.Base().ID), Values: values}
}

func prepare(source simulation.Entity, batch *BinarySnapshotBatch) *binaryRecord {
	catalog := &batch.catalog
	field := catalog.Protocol.BinaryFieldIDs
	record := recordOf(source, field.Rounds)

	if record.batchGeneration == batch.Generation {
		return record
	}

	record.batchGeneration = batch.Generation
	record.previousRevision = record.revision
	record.recentChanges = record.recentChanges[:0]
	o := source.Base()

	if item, ok := source.(*objects.Item); ok && item.Rounds != nil {
		scalarNumber(record, field.Rounds, float64(*item.Rounds))
	}

	if a, ok := source.(*simulation.Asteroid); ok {
		integerArray(record, field.Contents, a.Contents)
		optionalNumber(record, field.Decay, a.Decay, a.Decay != 0)
		optionalNumber(record, field.MaxHealth, a.MaxHealth, a.MaxHealth != a.Radius*2)
		outline(record, field.ShapeOutline, a.ShapeOutline)
		var segments []*simulation.AsteroidSegment

		if a.ShapeOutline != nil || a.Damaged() {
			segments = a.Segments()
		}

		asteroidSegments(record, field.Segments, segments)
	}

	c, crafted := source.(interface{ CraftBase() *objects.Craft })

	if crafted {
		entity := c.CraftBase()
		states := readModules(entity, record)
		cargo := entity.CargoContents

		if len(cargo) > 0 {
			entries := make([]protocol.CargoEntry, len(cargo))

			for i, object := range cargo {
				if module, ok := object.(simulation.Module); ok {
					index := float64(states.indexes[module])
					entries[i].ModuleIndex = &index
				} else {
					nested := fullRecord(prepare(object, batch), -1, nil)
					entries[i].Entity = &nested
				}
			}

			captureBytes(record, field.CargoContents, entries, catalog)
		} else {
			clearField(record, field.CargoContents)
		}

		if entity.DockedTo != nil {
			scalarNumber(record, field.DockedTo, float64(*entity.DockedTo))
		} else {
			clearField(record, field.DockedTo)
		}

		maxSpeed := o.SpeedLimit

		_, ship := source.(interface{ ShipBase() *objects.Ship })

		if ship {
			maxSpeed = source.MaxSpeed()
		}

		optionalNumber(record, field.MaxSpeed, maxSpeed, ship || !math.IsNaN(maxSpeed))

		if o.Kind != "station" {
			record.hullHealth = entity.AppendHullHealth(record.hullHealth)
			numberArray(record, field.HullHealth, record.hullHealth)
		}

		optionalNumber(record, field.Launching, entity.Launching, entity.HasLaunching)
		f := &record.fields[field.Modules]

		if states != nil {
			if f.compare != states {
				changed(record, field.Modules, states, states.states)
			}
		} else if f.compare != nil {
			changed(record, field.Modules, nil, nil)
		}

		wreckage := entity.Wreckage()

		if wreckage != nil {
			values := make([]protocol.WreckageSegment, len(wreckage))

			for i, w := range wreckage {
				values[i] = protocol.WreckageSegment{Radius: w.Radius, Offset: w.Offset, Health: w.Health, FillShade: w.FillShade, Color: w.Color, Stroke: w.Stroke}

				if w.ShapeOutline != nil {
					values[i].ShapeOutline = wireOutline(&simulation.ShapeOutline{Points: w.ShapeOutline})
				}
			}

			captureBytes(record, field.Wreckage, values, catalog)
		} else {
			clearField(record, field.Wreckage)
		}

		optionalNumber(record, field.Decay, entity.Decay, entity.Decay != 0)
		shades := entity.Shades

		if slices.Equal(shades, catalog.Colors["white"]) {
			shades = nil
		}

		stringArray(record, field.Shades, shades)
	}

	if s, ok := source.(interface{ ShipBase() *objects.Ship }); ok {
		ship := s.ShipBase()
		scalarNumber(record, field.Thrust, ship.Forward)
		scalarNumber(record, field.Turn, ship.Turn)
	}

	defaultFriction := 0.01

	if crafted || o.Kind == "asteroid" {
		defaultFriction = 0.2
	}

	if module, ok := source.(simulation.Module); ok && module.ModuleBase().Spec.Friction != nil {
		defaultFriction = *module.ModuleBase().Spec.Friction
	}

	optionalNumber(record, field.Friction, o.Friction, o.Friction != defaultFriction)
	optionalNumber(record, field.Health, o.Health, !math.IsNaN(o.Health) && !(o.Kind == "asteroid" && o.Health == o.Radius*2) && !(crafted && o.Health == 100))

	if o.Label != "" {
		scalar(record, field.Label, o.Label)
	} else {
		clearField(record, field.Label)
	}

	if o.Message != nil {
		scalar(record, field.Message, *o.Message)
	} else {
		clearField(record, field.Message)
	}

	optionalNumber(record, field.Paint, float64(o.Paint), o.HasPaint)

	if o.PlayerID != nil {
		scalarNumber(record, field.PlayerId, float64(*o.PlayerID))
	} else {
		clearField(record, field.PlayerId)
	}

	optionalNumber(record, field.PointCount, float64(o.PointCount), o.PointCount != 0)

	if o.RadiusEven != nil {
		scalarNumber(record, field.RadiusEven, *o.RadiusEven)
	} else {
		clearField(record, field.RadiusEven)
	}

	optionalNumber(record, field.Resource, float64(o.Resource), o.HasResource)
	kind := "object"

	if o.Kind == "asteroid" {
		kind = "asteroid"
	} else if o.Kind == "projectile" {
		kind = "projectile"
	} else if o.Item {
		kind = "item"
	} else if o.Kind == "station" {
		kind = "station"
	} else if crafted {
		kind = "ship"
	}

	scalar(record, field.Kind, kind)

	if o.DefinitionID != "" {
		scalar(record, field.DefinitionID, o.DefinitionID)
	} else {
		clearField(record, field.DefinitionID)
	}

	optionalNumber(record, field.Mass, o.Mass, !(o.Kind == "asteroid" && o.Mass == 0.4*(o.Radius*o.Radius)))
	optionalNumber(record, field.PendingUpdateTime, o.PendingUpdateTime, o.PendingUpdateTime != 0)
	vector(record, field.Position, &o.Position)
	scalarNumber(record, field.Radius, o.Radius)
	scalarNumber(record, field.Rotation, o.Rotation)
	scalarNumber(record, field.Spin, o.Spin)
	var velocity *Vec.Vector

	if o.Velocity.X != 0 || o.Velocity.Y != 0 {
		velocity = &o.Velocity
	}

	vector(record, field.Velocity, velocity)
	return record
}

var nextBatchGeneration atomic.Uint64

type fragment struct{ offset, length int }

type BinarySnapshotBatch struct {
	arena      []byte
	Generation uint64
	View       *ReplicationView
	catalog    specs.Catalog
}

func NewBinarySnapshotBatch(catalog specs.Catalog) *BinarySnapshotBatch {
	return &BinarySnapshotBatch{arena: make([]byte, 0, 4096), catalog: catalog}
}

func (b *BinarySnapshotBatch) Begin(view *ReplicationView) *BinarySnapshotBatch {
	b.Generation = nextBatchGeneration.Add(1)
	b.View = view
	b.arena = b.arena[:0]
	return b
}

func (b *BinarySnapshotBatch) prepared(source simulation.Entity) *binaryRecord {
	return prepare(source, b)
}

func (b *BinarySnapshotBatch) fragment(record *binaryRecord, baseline int64, replaced *binaryRecord) (fragment, bool) {
	full := baseline < 0

	if full && replaced == nil && record.fullGeneration == b.Generation {
		return fragment{record.fullOffset, record.fullLength}, true
	}

	if !full && baseline >= record.revision {
		return fragment{}, false
	}

	if !full && baseline == record.previousRevision && record.deltaGeneration == b.Generation {
		if record.deltaLength == 0 {
			return fragment{}, false
		}

		return fragment{record.deltaOffset, record.deltaLength}, true
	}

	offset := len(b.arena)
	value := fullRecord(record, baseline, replaced)
	count := len(value.Values)
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
		return fragment{}, false
	}

	return fragment{offset, length}, true
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
	entityID int64
}

type BinaryReplicationManager struct {
	snapshotTick, stamp uint64
	writer              []byte
	entityIDs           []uint64
	fragments           []fragment
	wireFragments       [][]byte
	members             map[int64]*member
	memberCache         []*member
	catalog             specs.Catalog
}

func NewBinaryReplicationManager(catalog specs.Catalog) *BinaryReplicationManager {
	return &BinaryReplicationManager{catalog: catalog, writer: make([]byte, 0, 4096), members: make(map[int64]*member)}
}

func (m *BinaryReplicationManager) Initial(options SnapshotOptions) []byte {
	return slices.Clone(m.encode(options, true))
}

func (m *BinaryReplicationManager) Snapshot(options SnapshotOptions) []byte {
	return slices.Clone(m.encode(options, false))
}

func (m *BinaryReplicationManager) encode(options SnapshotOptions, load bool) []byte {
	// The session calls encode directly to avoid cloning the packet. Invalidate
	// both membership representations on every load, including respawn.
	if load {
		clear(m.members)
		clear(m.memberCache)
	}

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

	if cap(m.memberCache) < len(list) {
		m.memberCache = append(m.memberCache, make([]*member, len(list)*2-len(m.memberCache))...)
	}

	if len(m.memberCache) > len(list) {
		clear(m.memberCache[len(list):])
	}

	m.memberCache = m.memberCache[:len(list)]
	position := options.Position

	if ship, ok := world.Entities.Get(options.ShipID); ok {
		position = ship.Base().Position
	}

	m.stamp++
	stamp := m.stamp
	previousSize := len(m.members)
	retained := 0
	membershipChanged := false
	m.entityIDs = m.entityIDs[:0]
	m.fragments = m.fragments[:0]
	rules := &m.catalog.Simulation
	ranges := rules.Replication
	distantInterval := rules.UpdateTiers["distant"].ReplicateEvery
	visibleInterval := rules.UpdateTiers["visible"].ReplicateEvery
	visibleSquared := rules.VisibleRange * rules.VisibleRange
	visibleDue, distantDue := true, true
	var ballisticVisible, ballisticDistant uint64
	packedCadence := rules.BallisticReplicateEvery > 0 && rules.BallisticReplicateEvery <= 64 && rules.BallisticReplicateEvery == view.world.Specification.Simulation.BallisticReplicateEvery && visibleInterval > 0 && distantInterval > 0

	if previousSize > 0 && packedCadence {
		visibleDue = replicationDue(world.Tick, m.snapshotTick, visibleInterval)
		distantDue = replicationDue(world.Tick, m.snapshotTick, distantInterval)

		for phase := 0; phase < rules.BallisticReplicateEvery; phase++ {
			tick, old := world.Tick+uint64(phase), m.snapshotTick+uint64(phase)

			if replicationDue(tick, old, max(visibleInterval, rules.BallisticReplicateEvery)) {
				ballisticVisible |= uint64(1) << phase
			}

			if replicationDue(tick, old, max(distantInterval, rules.BallisticReplicateEvery)) {
				ballisticDistant |= uint64(1) << phase
			}
		}
	}

	useVectors := vectorReplication && previousSize*4 < len(list) && world.Players != nil && world.Players.Len() >= 8
	// Views can be supplied independently of the manager's catalog. Fall back
	// when their prepacked unload policy does not match this observer's policy.
	viewRanges := view.world.Specification.Simulation.Replication
	useVectors = useVectors && ranges.EntityUnload == viewRanges.EntityUnload && ranges.MarkerUnload == viewRanges.MarkerUnload

	if useVectors {
		view.packReplicationIDs()
	}

	accept := func(i int, distance float64) {
		e := list[i]
		object := view.objects[i]
		station := view.Kinds[i]&1 != 0
		var previous *member

		if cached := m.memberCache[i]; cached != nil && cached.entityID == object.ID && cached.seen == stamp-1 {
			previous = cached
		}

		if previous == nil {
			previous = m.members[object.ID]
		}

		loaded := previous != nil
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
			return
		}

		m.entityIDs = append(m.entityIDs, uint64(object.ID))

		if loaded {
			previous.seen = stamp
			m.memberCache[i] = previous
			retained++
		} else {
			membershipChanged = true
		}

		if loaded {
			if packedCadence {
				due := distantDue
				mask := ballisticDistant

				if distance <= visibleSquared {
					due = visibleDue
					mask = ballisticVisible
				}

				if view.Kinds[i] > 1 {
					due = mask&(uint64(1)<<view.Phases[i]) != 0
				}

				if !due {
					return
				}
			} else {
				interval := distantInterval

				if distance <= visibleSquared {
					interval = visibleInterval
				}

				phase := 0

				if view.Kinds[i] > 1 {
					interval = max(interval, rules.BallisticReplicateEvery)
					phase = view.Phases[i]
				}

				tick, old := world.Tick+uint64(phase), m.snapshotTick+uint64(phase)

				if loaded && !replicationDue(tick, old, interval) {
					return
				}
			}
		}

		prepared := view.records[i]

		if prepared == nil || prepared.batchGeneration != batch.Generation {
			prepared = batch.prepared(e)
			view.records[i] = prepared
		}

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
			previous = &member{record: prepared, revision: prepared.revision, seen: stamp, entityID: object.ID}
			m.members[object.ID] = previous
		}

		m.memberCache[i] = previous
		replaced := previousRecord

		if replaced == prepared {
			replaced = nil
		}

		if f, ok := batch.fragment(prepared, revision, replaced); ok {
			m.fragments = append(m.fragments, f)
		}
	}

	end := 0

	if useVectors {
		end = len(list) &^ 15

		for base := 0; base < end; base += 16 {
			mask := ^view.replicationBlock(base, position.X, position.Y, ranges.EntityUnload*ranges.EntityUnload, ranges.MarkerUnload*ranges.MarkerUnload, options.ShipID)

			for mask != 0 {
				offset := bits.TrailingZeros16(mask)
				mask &= mask - 1
				accept(base+offset, view.distanceBlock[offset])
			}
		}
	}

	// Dense views and the incomplete SIMD tail use the original scalar checks.
	for i := end; i < len(list); i++ {
		dx, dy := view.X[i]-position.X, view.Y[i]-position.Y
		distance := dx*dx + dy*dy
		object, station := view.objects[i], view.Kinds[i]&1 != 0

		if distance > ranges.EntityUnload*ranges.EntityUnload && object.ID != options.ShipID && (distance > ranges.MarkerUnload*ranges.MarkerUnload || !station) {
			continue
		}

		accept(i, distance)
	}

	membershipChanged = membershipChanged || retained != previousSize
	m.snapshotTick = world.Tick

	if membershipChanged {
		for id, member := range m.members {
			if member.seen != stamp {
				delete(m.members, id)
				member.record = nil
			}
		}
	}

	clear(m.wireFragments)

	if cap(m.wireFragments) < len(m.fragments) {
		m.wireFragments = make([][]byte, len(m.fragments)*2)
	}

	m.wireFragments = m.wireFragments[:len(m.fragments)]
	fragments := m.wireFragments

	for i, f := range m.fragments {
		fragments[i] = batch.arena[f.offset : f.offset+f.length]
	}

	data, err := protocol.AppendSnapshot(m.writer[:0], protocol.Snapshot{Load: load, MembershipChanged: membershipChanged, Tick: world.Tick, NextEntityID: uint64(world.NextEntityID), Ack: options.AcknowledgedSequence, InputLead: options.InputLead, Sequence: options.SnapshotSequence, EntityIDs: m.entityIDs, Fragments: fragments}, m.catalog.Protocol)

	if err != nil {
		panic(err)
	}

	m.writer = data
	return data
}

// Compare hot numeric fields before boxing a changed value for the wire writer.
func scalarNumber(record *binaryRecord, id int, value float64) {
	bit := uint64(1) << id

	if record.numberMask&bit != 0 && record.numberValues[id] == value {
		return
	}

	field := &record.fields[id]
	normalized := canonical(value)

	if field.compare != normalized {
		wire := normalized

		if _, null := normalized.(nullValue); null {
			wire = nil
		}

		changed(record, id, normalized, wire)
	}

	if number, ok := normalized.(float64); ok {
		record.numberMask |= bit
		record.numberValues[id] = number
	}
}

func optionalNumber(record *binaryRecord, id int, value float64, present bool) {
	if present {
		scalarNumber(record, id, value)
	} else {
		clearField(record, id)
	}
}

func replicationDue(tick, previous uint64, interval int) bool {
	if interval == 1 {
		return true
	}

	if interval > 0 && interval&(interval-1) == 0 {
		mask := uint64(interval - 1)
		return tick&mask == 0 || tick&^mask != previous&^mask
	}

	return tick%uint64(interval) == 0 || tick/uint64(interval) != previous/uint64(interval)
}
