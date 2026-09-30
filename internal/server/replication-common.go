// Port of src/server/replication-common.ts.
package server

import (
	"github.com/burntcustard/unicorn-mining-co/internal/craft"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/simulation"
	"slices"
)

type moduleRecord struct {
	modules []simulation.Module
	states  []protocol.ModuleState
	indexes map[simulation.Module]int
	counts  []int
}

func sameModuleSegments(entity *craft.Craft, record *moduleRecord) bool {
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
func readModules(entity *craft.Craft, previous **moduleRecord) *moduleRecord {
	modules := entity.Modules()
	if len(modules) == 0 {
		return nil
	}
	mounts := entity.Mounts()
	p := *previous
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
	record := &moduleRecord{modules: modules, indexes: map[simulation.Module]int{}, counts: make([]int, len(modules))}
	for i, state := range entity.ModuleStates() {
		id := float64(modules[i].Base().ID)
		value := protocol.ModuleState{ID: &id, Type: float64(state.Type), Mount: float64(state.Mount), Health: state.Health, Shades: slices.Clone(state.Shades), Segments: make([]protocol.ModuleSegment, len(state.Segments))}
		for at, s := range state.Segments {
			value.Segments[at] = protocol.ModuleSegment{Active: s.Active, ActivationProgress: s.ActivationProgress}
		}
		record.states = append(record.states, value)
		record.indexes[modules[i]] = i
	}
	*previous = record
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
	world         *simulation.World
	snapshotList  []simulation.Entity
	Kinds, Phases []int
}

func NewReplicationView(world *simulation.World) *ReplicationView {
	return &ReplicationView{world: world}
}
func (v *ReplicationView) Entities() []simulation.Entity {
	if v.snapshotList == nil {
		v.snapshotList = v.world.Entities.Values()
		v.Kinds = make([]int, len(v.snapshotList))
		v.Phases = make([]int, len(v.snapshotList))
		for i, e := range v.snapshotList {
			o := e.Base()
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
