// Port of src/shared/simulation/update-world.ts.
package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/utilities"
)

type CollisionWorld interface {
	CapturePoses(*utilities.OrderedMap[int64, Entity])
	Step(*utilities.OrderedMap[int64, Entity], float64, *[]protocol.SimulationEvent) []collision.Contact
}
type ContactHandler interface {
	Entity
	HandleContacts([]collision.Contact, *[]protocol.SimulationEvent, *World, float64)
}
type UpdateWorldOptions struct {
	Inputs map[int64]protocol.InputFrame
	DT     *float64
	Ticks  int
}

func UpdateWorld(world *World, options UpdateWorldOptions) []protocol.SimulationEvent {
	dt := world.Specification.Simulation.SimulationStep
	if options.DT != nil {
		dt = *options.DT
	}
	ticks := options.Ticks
	if ticks == 0 {
		ticks = 1
	}
	events := []protocol.SimulationEvent{}
	world.Entities.ForEach(func(e Entity, _ int64) {
		if ship, ok := e.(interface{ ResetBiting() }); ok {
			ship.ResetBiting()
		}
	})
	world.Players.ForEach(func(player Player, id int64) {
		entity, ok := world.Entities.Get(player.ShipID)
		if !ok {
			return
		}
		if ship, ok := entity.(ControlledShip); ok {
			ship.Control(options.Inputs[id].Input, &events)
		}
	})
	if world.Collisions == nil {
		panic("simulation world has no collision system")
	}
	world.Collisions.CapturePoses(world.Entities)
	for i := 0; i < ticks; i++ {
		tick := world.Tick + uint64(i)
		duration := dt / float64(ticks)
		UpdateEntities(world, UpdateEntitiesOptions{Inputs: options.Inputs, Events: &events, DT: &duration, Tick: &tick, InputOffset: float64(i) * dt / float64(ticks)})
	}
	contacts := world.Collisions.Step(world.Entities, dt, &events)
	byOwner := utilities.NewOrderedMap[Entity, []collision.Contact]()
	for _, contact := range contacts {
		for _, owner := range []Entity{contact.Collider.Owner.(Entity), contact.Other.Owner.(Entity)} {
			own, _ := byOwner.Get(owner)
			byOwner.Set(owner, append(own, contact))
		}
	}
	for _, kind := range []string{"station", "ship"} {
		byOwner.ForEach(func(contacts []collision.Contact, e Entity) {
			if e.Base().Kind == kind {
				e.(ContactHandler).HandleContacts(contacts, &events, world, dt)
			}
		})
	}
	world.Entities.ForEach(func(e Entity, _ int64) { e.Base().RoundMotion() })
	world.Tick += uint64(ticks)
	return events
}
