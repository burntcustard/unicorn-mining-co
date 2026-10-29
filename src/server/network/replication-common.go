// Per-player replication views and snapshot baselines.
package network

import (
	"math"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type moduleRecord struct {
	modules []simulation.Module
	mounts  []*simulation.Mount
	states  []protocol.ModuleState
	indexes map[simulation.Module]int
	counts  []int
}

func sameModuleSegments(entity *objects.Craft, record *moduleRecord) bool {
	if len(record.indexes) != len(record.modules) {
		return false
	}

	clear(record.counts)

	for _, segment := range entity.Segments {
		index, ok := record.indexes[segment.Module]

		if !ok || segment.Mount != record.modules[index].ModuleBase().Mount {
			continue
		}

		at := record.counts[index]
		record.counts[index]++

		if at >= len(record.states[index].Segments) {
			return false
		}

		before := record.states[index].Segments[at]

		if segment.Active != before.Active || segment.ActivationProgress != before.ActivationProgress {
			return false
		}
	}

	for i, count := range record.counts {
		if count != len(record.states[i].Segments) {
			return false
		}
	}

	return true
}

func readModules(entity *objects.Craft, binary *binaryRecord) *moduleRecord {
	clear(binary.moduleBuffer)
	binary.moduleBuffer = entity.AppendModules(binary.moduleBuffer[:0])

	// Impacts precede snapshots, while detachment waits until the next update.
	// The client removes broken hulls when applying health, so omit their modules
	// and mounts together before assigning the replicated indexes.
	binary.moduleBuffer = slices.DeleteFunc(binary.moduleBuffer, func(module simulation.Module) bool {
		mount := module.ModuleBase().Mount
		return mount != nil && mount.Hull != nil && mount.Hull.Health < 1
	})

	modules := binary.moduleBuffer

	if len(modules) == 0 {
		return nil
	}

	clear(binary.mountBuffer)
	binary.mountBuffer = entity.AppendMounts(binary.mountBuffer[:0])

	binary.mountBuffer = slices.DeleteFunc(binary.mountBuffer, func(mount *simulation.Mount) bool {
		return mount.Hull != nil && mount.Hull.Health < 1
	})

	mounts := binary.mountBuffer
	p := binary.modules
	same := p != nil && len(modules) == len(p.modules) && slices.Equal(mounts, p.mounts)
	stateChanged := false

	if same {
		for i, module := range modules {
			state := p.states[i]
			object, data := module.Base(), module.ModuleBase()
			var mount *simulation.Mount

			if state.Mount >= 0 {
				mount = p.mounts[int(state.Mount)]
			}

			health := object.Health

			if data.Mount != nil {
				health = data.Mount.Health
			}

			cooldown := 0.0

			if state.FireCooldown != nil {
				cooldown = *state.FireCooldown
			}

			charge := 0.0

			if state.ChargeCooldown != nil {
				charge = *state.ChargeCooldown
			}

			if data.Mount != nil && data.Mount.HealthActivated != nil && (state.HealthActivated == nil || *data.Mount.HealthActivated != *state.HealthActivated) {
				same = false
				break
			}

			aim := 0.0

			if state.AimRotation != nil {
				aim = *state.AimRotation
			}

			if data.FireCooldown != cooldown || data.ChargeCooldown != charge || data.AimRotation != aim {
				stateChanged = true
			}

			if module != p.modules[i] || state.ID == nil || float64(object.ID) != *state.ID || data.Mount != mount || state.Health == nil || health != *state.Health || !slices.Equal(object.Shades, state.Shades) {
				same = false
				break
			}
		}
	}

	if same && sameModuleSegments(entity, p) {
		if !stateChanged {
			return p
		}

		// Weapon state changes while aiming and firing; retain the module layout.
		record := *p
		record.states = slices.Clone(p.states)

		for i, module := range modules {
			data := module.ModuleBase()
			state := &record.states[i]
			state.FireCooldown, state.ChargeCooldown = nil, nil
			state.AimRotation = nil

			if data.FireCooldown > 0 {
				state.FireCooldown = new(data.FireCooldown)
			}

			if data.ChargeCooldown > 0 {
				state.ChargeCooldown = new(data.ChargeCooldown)
			}

			if data.AimRotation != 0 {
				state.AimRotation = new(data.AimRotation)
			}

		}

		binary.modules = &record
		return &record
	}

	record := &moduleRecord{modules: slices.Clone(modules), mounts: slices.Clone(mounts), indexes: map[simulation.Module]int{}, counts: make([]int, len(modules))}

	for i, module := range modules {
		o, d := module.Base(), module.ModuleBase()
		id, health := float64(o.ID), o.Health

		if d.Mount != nil {
			health = d.Mount.Health
		}

		value := protocol.ModuleState{ID: &id, Type: float64(slices.Index(entity.Catalog.ModuleIDs, d.Type)), Mount: float64(slices.Index(mounts, d.Mount)), Health: &health, Shades: slices.Clone(o.Shades), Segments: []protocol.ModuleSegment{}}

		if d.Mount != nil && d.Mount.HealthActivated != nil {
			value.HealthActivated = new(*d.Mount.HealthActivated)
		}

		if d.ChargeCooldown > 0 {
			value.ChargeCooldown = new(d.ChargeCooldown)
		}

		if d.FireCooldown > 0 {
			value.FireCooldown = new(d.FireCooldown)
		}

		if d.AimRotation != 0 {
			value.AimRotation = new(d.AimRotation)
		}

		for _, s := range entity.Segments {
			if s.Mount == d.Mount && s.Module == module {
				value.Segments = append(value.Segments, protocol.ModuleSegment{Active: s.Active, ActivationProgress: s.ActivationProgress})
			}
		}

		record.states = append(record.states, value)
		record.indexes[modules[i]] = i
	}

	binary.modules = record
	return record
}

func sameSegments(a []*simulation.AsteroidSegment, b []protocol.AsteroidSegment) bool {
	if b == nil || len(a) != len(b) {
		return false
	}

	for i, s := range a {
		p := b[i]

		if s.Health != p.Health || s.MaxHealth != p.MaxHealth || s.Mass != p.Mass || len(s.Contents) != len(p.Contents) || len(s.ShapeOutline.Points) != len(p.ShapeOutline) {
			return false
		}

		for j, v := range s.Contents {
			if float64(v) != p.Contents[j] {
				return false
			}
		}

		for j, point := range s.ShapeOutline.Points {
			if len(p.ShapeOutline[j]) != 2 || point[0] != p.ShapeOutline[j][0] || point[1] != p.ShapeOutline[j][1] {
				return false
			}
		}
	}

	return true
}

func copySegments(segments []*simulation.AsteroidSegment, previous []protocol.AsteroidSegment) []protocol.AsteroidSegment {
	out := make([]protocol.AsteroidSegment, len(segments))

	for i, s := range segments {
		state := &out[i]
		*state = protocol.AsteroidSegment{Health: s.Health, MaxHealth: s.MaxHealth, Mass: s.Mass}

		if i < len(previous) {
			before := &previous[i]
			sameContents := len(s.Contents) == len(before.Contents)

			if sameContents {
				for index, value := range s.Contents {
					if float64(value) != before.Contents[index] {
						sameContents = false
						break
					}
				}
			}

			if sameContents {
				state.Contents = before.Contents
			}

			sameOutline := len(s.ShapeOutline.Points) == len(before.ShapeOutline)

			if sameOutline {
				for index, point := range s.ShapeOutline.Points {
					wire := before.ShapeOutline[index]

					if len(wire) != 2 || point[0] != wire[0] || point[1] != wire[1] {
						sameOutline = false
						break
					}
				}
			}

			if sameOutline {
				state.ShapeOutline = before.ShapeOutline
			}
		}

		if state.Contents == nil {
			state.Contents = make([]float64, len(s.Contents))

			for index, value := range s.Contents {
				state.Contents[index] = float64(value)
			}
		}

		if state.ShapeOutline == nil {
			state.ShapeOutline = wireOutline(s.ShapeOutline)
		}
	}

	return out
}

type ReplicationView struct {
	spatialPrepared bool
	spatialUsable   bool
	spatialCells    map[[2]int][]int
	spatialPool     [][]int
	spatialMarkers  []int
	spatialEntities []simulation.Entity
	spatialKeys     [][3]int
	spatialIDs      map[int64]int
	prepared        bool
	idsPrepared     bool
	world           *simulation.World
	snapshotList    []simulation.Entity
	objects         []*simulation.GameObject
	records         []*binaryRecord
	Kinds, Phases   []int
	X, Y            []float64
	IDs             []int64
	distanceBlock   [16]float64
}

func NewReplicationView(world *simulation.World) *ReplicationView {
	return &ReplicationView{world: world}
}

func (v *ReplicationView) Entities() []simulation.Entity {
	if !v.prepared {
		v.prepared = true
		v.snapshotList = v.world.Entities.ReadValues()

		count := len(v.snapshotList)

		if cap(v.X) < count {
			v.objects = make([]*simulation.GameObject, count*2)
			v.records = make([]*binaryRecord, count*2)
			v.Kinds = make([]int, count*2)
			v.Phases = make([]int, count*2)
			v.X = make([]float64, count*2)
			v.Y = make([]float64, count*2)
		}

		v.objects = v.objects[:count]
		v.records = v.records[:count]
		clear(v.records)
		v.Kinds = v.Kinds[:count]
		clear(v.Kinds)
		v.Phases = v.Phases[:count]
		v.X = v.X[:count]
		v.Y = v.Y[:count]

		for i, e := range v.snapshotList {
			o := e.Base()
			v.objects[i] = o
			v.records[i], _ = o.ReplicationState.(*binaryRecord)
			v.X[i], v.Y[i] = o.Position.X, o.Position.Y
			station := o.Kind == "station"

			if station {
				v.Kinds[i] = 1
			}

			if (station || o.Kind == "asteroid") && o.Ballistic {
				v.Kinds[i] |= 2
			}

			v.Phases[i] = int(o.ID % int64(v.world.Specification.Simulation.BallisticReplicateEvery))
		}
	}

	return v.snapshotList
}

func (v *ReplicationView) spatialCandidates(position Vec.Vector, reach float64, owned int64, selected []uint64) ([]uint64, bool) {
	const cellSize = 3000.0

	if !(reach >= 0 && reach <= cellSize*4) || !(math.Abs(position.X) <= 1e12 && math.Abs(position.Y) <= 1e12) {
		return selected, false
	}

	if !v.spatialPrepared {
		v.spatialPrepared = true
		sameEntities := len(v.spatialEntities) == len(v.snapshotList) && (len(v.snapshotList) == 0 || &v.spatialEntities[0] == &v.snapshotList[0])
		v.spatialEntities = v.snapshotList

		if !sameEntities {
			v.spatialUsable = false
			return selected, false
		}

		unchanged := v.spatialUsable && len(v.spatialKeys) == len(v.objects)

		if cap(v.spatialKeys) < len(v.objects) {
			v.spatialKeys = make([][3]int, len(v.objects))
		} else {
			v.spatialKeys = v.spatialKeys[:len(v.objects)]
		}

		v.spatialUsable = true

		for index := range v.objects {
			x, y := v.X[index], v.Y[index]

			if !(math.Abs(x) <= 1e12 && math.Abs(y) <= 1e12) {
				v.spatialUsable = false
				break
			}

			key := [3]int{int(math.Floor(x / cellSize)), int(math.Floor(y / cellSize)), v.Kinds[index] & 1}

			if key[2] != 0 {
				key[0], key[1] = 0, 0
			}

			unchanged = unchanged && v.spatialKeys[index] == key
			v.spatialKeys[index] = key
		}

		if !v.spatialUsable {
			return selected, false
		}

		if !unchanged {
			v.spatialMarkers = v.spatialMarkers[:0]
			clear(v.spatialIDs)

			if v.spatialIDs == nil {
				v.spatialIDs = make(map[int64]int, len(v.objects))
			}

			for key, indices := range v.spatialCells {
				v.spatialPool = append(v.spatialPool, indices[:0])
				delete(v.spatialCells, key)
			}

			if v.spatialCells == nil {
				v.spatialCells = make(map[[2]int][]int)
			}

			for index, cell := range v.spatialKeys {
				v.spatialIDs[v.objects[index].ID] = index

				if cell[2] != 0 {
					v.spatialMarkers = append(v.spatialMarkers, index)
					continue
				}

				key := [2]int{cell[0], cell[1]}
				indices, exists := v.spatialCells[key]

				if !exists && len(v.spatialPool) > 0 {
					last := len(v.spatialPool) - 1
					indices = v.spatialPool[last]
					v.spatialPool[last] = nil
					v.spatialPool = v.spatialPool[:last]
				}

				v.spatialCells[key] = append(indices, index)
			}
		}
	}

	if !v.spatialUsable {
		return selected, false
	}

	count := (len(v.objects) + 63) / 64

	if cap(selected) < count {
		selected = make([]uint64, count)
	} else {
		selected = selected[:count]
		clear(selected)
	}

	minX := int(math.Floor(math.Nextafter(position.X-reach, math.Inf(-1)) / cellSize))
	maxX := int(math.Floor(math.Nextafter(position.X+reach, math.Inf(1)) / cellSize))
	minY := int(math.Floor(math.Nextafter(position.Y-reach, math.Inf(-1)) / cellSize))
	maxY := int(math.Floor(math.Nextafter(position.Y+reach, math.Inf(1)) / cellSize))

	for x := minX; x <= maxX; x++ {
		for y := minY; y <= maxY; y++ {
			for _, index := range v.spatialCells[[2]int{x, y}] {
				selected[index/64] |= uint64(1) << (index % 64)
			}
		}
	}

	for _, index := range v.spatialMarkers {
		selected[index/64] |= uint64(1) << (index % 64)
	}

	if index, exists := v.spatialIDs[owned]; exists {
		selected[index/64] |= uint64(1) << (index % 64)
	}

	return selected, true
}

func (v *ReplicationView) Reset() *ReplicationView {
	v.snapshotList = nil
	v.prepared = false
	v.idsPrepared = false
	v.spatialPrepared = false
	return v
}
