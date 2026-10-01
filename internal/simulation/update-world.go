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
	// Physics and collision damage have already run for every object. These
	// reusable lists only feed docking, scooping and drilling callbacks.
	for _, contact := range contacts {
		for _, owner := range [2]any{contact.Collider.Owner, contact.Other.Owner} {
			handler, ok := owner.(ContactHandler)
			if !ok {
				continue
			}
			object := handler.Base()
			if len(object.gameplayContacts) == 0 {
				world.contactHandlers = append(world.contactHandlers, handler)
			}
			object.gameplayContacts = append(object.gameplayContacts, contact)
		}
	}
	for _, kind := range []string{"station", "ship"} {
		for _, e := range world.contactHandlers {
			if e.Base().Kind == kind {
				e.HandleContacts(e.Base().gameplayContacts, &events, world, dt)
			}
		}
	}
	for _, owner := range world.contactHandlers {
		clear(owner.Base().gameplayContacts)
		owner.Base().gameplayContacts = owner.Base().gameplayContacts[:0]
	}
	clear(world.contactHandlers)
	world.contactHandlers = world.contactHandlers[:0]
	world.Entities.ForEach(func(e Entity, _ int64) { e.Base().RoundMotion() })
	world.Tick += uint64(ticks)
	return events
}
