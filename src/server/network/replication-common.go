// Per-player replication views and snapshot baselines.
package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"slices"
)

type moduleRecord struct {
	modules []simulation.Module
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
	modules := binary.moduleBuffer

	if len(modules) == 0 {
		return nil
	}

	clear(binary.mountBuffer)
	binary.mountBuffer = entity.AppendMounts(binary.mountBuffer[:0])
	mounts := binary.mountBuffer
	p := binary.modules
	same := p != nil && len(modules) == len(p.modules)

	if same {
		for i, module := range modules {
			state := p.states[i]
			object, data := module.Base(), module.ModuleBase()
			health := object.Health

			if data.Mount != nil {
				health = data.Mount.Health
			}

			if module != p.modules[i] || state.ID == nil || float64(object.ID) != *state.ID || float64(slices.Index(mounts, data.Mount)) != state.Mount || state.Health == nil || health != *state.Health || !slices.Equal(object.Shades, state.Shades) {
				same = false
				break
			}
		}
	}

	if same && sameModuleSegments(entity, p) {
		return p
	}

	record := &moduleRecord{modules: slices.Clone(modules), indexes: map[simulation.Module]int{}, counts: make([]int, len(modules))}

	for i, module := range modules {
		o, d := module.Base(), module.ModuleBase()
		id, health := float64(o.ID), o.Health

		if d.Mount != nil {
			health = d.Mount.Health
		}

		value := protocol.ModuleState{ID: &id, Type: float64(slices.Index(entity.Catalog.ModuleIDs, d.Type)), Mount: float64(slices.Index(mounts, d.Mount)), Health: &health, Shades: slices.Clone(o.Shades), Segments: []protocol.ModuleSegment{}}

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

func copySegments(segments []*simulation.AsteroidSegment) []protocol.AsteroidSegment {
	out := make([]protocol.AsteroidSegment, len(segments))

	for i, s := range segments {
		out[i] = protocol.AsteroidSegment{Health: s.Health, MaxHealth: s.MaxHealth, Mass: s.Mass, Contents: make([]float64, len(s.Contents)), ShapeOutline: wireOutline(s.ShapeOutline)}

		for j, v := range s.Contents {
			out[i].Contents[j] = float64(v)
		}
	}

	return out
}

type ReplicationView struct {
	prepared      bool
	idsPrepared   bool
	world         *simulation.World
	snapshotList  []simulation.Entity
	objects       []*simulation.GameObject
	records       []*binaryRecord
	Kinds, Phases []int
	X, Y          []float64
	IDs           []int64
	distanceBlock [16]float64
}

func NewReplicationView(world *simulation.World) *ReplicationView {
	return &ReplicationView{world: world}
}

func (v *ReplicationView) Entities() []simulation.Entity {
	if !v.prepared {
		v.prepared = true
		v.snapshotList = v.snapshotList[:0]

		v.world.Entities.ForEach(func(e simulation.Entity, _ int64) { v.snapshotList = append(v.snapshotList, e) })

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

func (v *ReplicationView) Reset() *ReplicationView {
	clear(v.snapshotList)
	v.snapshotList = v.snapshotList[:0]
	v.prepared = false
	v.idsPrepared = false
	return v
}
