package simulation

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"

	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
)

type movementHolder struct{ *GameObject }

func (h *movementHolder) Holds(child Entity) bool {
	return Vec.DistanceSquared(child.Base().Position, h.Position) <= 400
}
func (h *movementHolder) Momentum(position Vec.Vector) Vec.Vector {
	offset := Vec.Subtract(position, h.Position)
	return Vec.Create(-offset.Y*h.Spin, offset.X*h.Spin)
}

type scheduleProbe struct {
	*GameObject
	calls []map[string]any
}

func (*scheduleProbe) IsCraft() {}
func (p *scheduleProbe) Update(dt float64) {
	p.calls = append(p.calls, map[string]any{"type": "update", "value": dt})
}
func (p *scheduleProbe) Control(input protocol.Input, _ *[]protocol.SimulationEvent) {
	p.calls = append(p.calls, map[string]any{"type": "control", "value": input.Thrust})
}
func TestTypeScriptMovement(t *testing.T) {
	data, err := os.ReadFile("../../tests/go-fixtures/movement.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Objects   []ObjectProperties
		Snapshots []struct {
			Tick     uint64
			Entities json.RawMessage
		}
		Frame protocol.InputFrame
		Calls json.RawMessage
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	spec, err := specification.Load()
	if err != nil {
		t.Fatal(err)
	}
	world := CreateWorld(1, spec)
	for _, props := range fixture.Objects {
		AddEntity(world, NewGameObject(props, spec.Simulation))
	}
	AddPlayer(world, Player{ID: 1, ShipID: 1})
	id := int64(20)
	holder := &movementHolder{NewGameObject(ObjectProperties{ID: &id, Spin: 0.7}, spec.Simulation)}
	holder.Self = holder
	AddEntity(world, holder)
	object := func(id int64) *GameObject { e, _ := world.Entities.Get(id); return e.Base() }
	snapshot := 0
	for tick := range uint64(1800) {
		world.Tick = tick
		switch tick {
		case 40:
			holder.Remove()
		case 80:
			holder.Add()
		case 120:
			object(1).Position = Vec.Create(50000, 100)
		case 240:
			object(2).Velocity = Vec.Vector{}
		case 400:
			object(3).Velocity = Vec.Create(3, -8)
		case 500:
			object(5).Buried = true
		case 560:
			object(5).Buried = false
		case 600:
			world.Players.Clear()
		}
		UpdateEntities(world, UpdateEntitiesOptions{})
		if snapshot < len(fixture.Snapshots) && tick == fixture.Snapshots[snapshot].Tick {
			entities := []any{}
			world.Entities.ForEach(func(e Entity, _ int64) {
				o := e.Base()
				var health, parent any
				if !math.IsNaN(o.Health) {
					health = o.Health
				}
				if o.LocalMovementParent != nil {
					parent = o.LocalMovementParent.Base().ID
				}
				entities = append(entities, map[string]any{"id": o.ID, "position": o.Position, "velocity": o.Velocity, "rotation": o.Rotation, "spin": o.Spin, "pendingUpdateTime": o.PendingUpdateTime, "health": health, "parent": parent, "rate": o.LocalMovementRate})
			})
			compareRecordedJSON(t, "movement", entities, fixture.Snapshots[snapshot].Entities)
			snapshot++
		}
	}
	if snapshot != len(fixture.Snapshots) {
		t.Fatal("unread snapshots")
	}
	world = CreateWorld(1, spec)
	id = 1
	probe := &scheduleProbe{GameObject: NewGameObject(ObjectProperties{ID: &id, PlayerID: &id}, spec.Simulation)}
	probe.Self = probe
	AddEntity(world, probe)
	UpdateEntities(world, UpdateEntitiesOptions{Inputs: map[int64]protocol.InputFrame{1: fixture.Frame}})
	compareRecordedJSON(t, "timed controls", probe.calls, fixture.Calls)
}
