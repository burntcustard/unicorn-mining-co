// Port of src/shared/simulation/update-tier.ts.
package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
)

// These interfaces replace instanceof without circular imports from simulation
// back into craft. The implementations belong to Craft and Ship respectively.
type CraftEntity interface {
	Entity
	IsCraft()
}
type ControlledShip interface {
	CraftEntity
	Control(protocol.Input, *[]protocol.SimulationEvent)
}
type scheduledEntity struct {
	entity Entity
	tier   specification.UpdateTier
	step   float64
}
type movementSchedule struct {
	observers, parents, entities []Entity
	entries                      []scheduledEntity
}
type UpdateEntitiesOptions struct {
	Entities    []Entity
	Tick        *uint64
	Inputs      map[int64]protocol.InputFrame
	Events      *[]protocol.SimulationEvent
	DT          *float64
	InputOffset float64
}

func UpdateTier(entity Entity, observers []Entity, rules specification.Simulation) specification.UpdateTier {
	for _, observer := range observers {
		if Vec.DistanceSquared(entity.Base().Position, observer.Base().Position) <= rules.VisibleRange*rules.VisibleRange {
			return rules.UpdateTiers["visible"]
		}
	}
	return rules.UpdateTiers["distant"]
}
func UpdateEntities(world *World, options UpdateEntitiesOptions) {
	rules := world.Specification.Simulation
	tick, dt := world.Tick, rules.SimulationStep
	if options.Tick != nil {
		tick = *options.Tick
	}
	if options.DT != nil {
		dt = *options.DT
	}
	events := options.Events
	if events == nil {
		events = new([]protocol.SimulationEvent)
	}
	schedule := &world.schedule
	list := options.Entities
	if list == nil {
		clear(schedule.entities)
		schedule.entities = schedule.entities[:0]
		world.Entities.ForEach(func(entity Entity, _ int64) { schedule.entities = append(schedule.entities, entity) })
		list = schedule.entities
	}
	clear(schedule.observers)
	schedule.observers = schedule.observers[:0]
	clear(schedule.parents)
	schedule.parents = schedule.parents[:0]
	world.Players.ForEach(func(player Player, _ int64) {
		if entity, ok := world.Entities.Get(player.ShipID); ok {
			schedule.observers = append(schedule.observers, entity)
		}
	})
	clear(schedule.entries)
	schedule.entries = schedule.entries[:0]
	for _, entity := range list {
		tier := rules.UpdateTiers["visible"]
		if len(schedule.observers) > 0 {
			tier = UpdateTier(entity, schedule.observers, rules)
		}
		_, craft := entity.(CraftEntity)
		object := entity.Base()
		if tier == rules.UpdateTiers["visible"] && object.Velocity.X == 0 && object.Velocity.Y == 0 && !craft {
			tier = rules.UpdateTiers["drift"]
		}
		step := (object.PendingUpdateTime + rules.SimulationStep) / float64(tier.Substeps)
		schedule.entries = append(schedule.entries, scheduledEntity{entity, tier, step})
	}
	world.Entities.ForEach(func(entity Entity, _ int64) {
		if _, ok := entity.(MovementParent); ok {
			schedule.parents = append(schedule.parents, entity)
		}
	})
	// An empty but non-nil slice is significant to GameObject.Update.
	if schedule.parents == nil {
		schedule.parents = []Entity{}
	}
	world.MovementParents = schedule.parents
	for substep := 0; substep < rules.UpdateTiers["visible"].Substeps; substep++ {
		for _, entry := range schedule.entries {
			entity, tier := entry.entity, entry.tier
			object := entity.Base()
			if object.Dead {
				continue
			}
			if substep == 0 {
				object.PendingUpdateTime += dt
			}
			if (tick+1)%uint64(tier.UpdateEvery) != 0 || substep >= tier.Substeps {
				continue
			}
			if object.PendingUpdateTime <= 0 {
				continue
			}
			duration := math.Min(object.PendingUpdateTime, entry.step)
			elapsed := dt - object.PendingUpdateTime
			object.PendingUpdateTime -= duration
			end := elapsed + duration
			if ship, ok := entity.(ControlledShip); ok && object.PlayerID != nil {
				if input, ok := options.Inputs[*object.PlayerID]; ok {
					for _, change := range input.Changes {
						offset := change.Offset - options.InputOffset
						if offset < elapsed || offset >= end {
							continue
						}
						if offset > elapsed {
							entity.Update(offset - elapsed)
						}
						ship.Control(change.Input, events)
						elapsed = offset
					}
				}
			}
			entity.Update(end - elapsed)
			if object.Dead {
				world.Entities.Delete(object.ID)
			}
		}
	}
	world.MovementParents = nil
}
