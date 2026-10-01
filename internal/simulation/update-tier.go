// Port of src/shared/simulation/update-tier.ts.
package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
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
	entity                Entity
	object                *GameObject
	substeps, updateEvery int
	step                  float64
}
type movementSchedule struct {
	observers, parents, entities []Entity
	positions                    []Vec.Vector
	entries                      []scheduledEntity
	parentRecords                []movementParent
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
	rules := &world.Specification.Simulation
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
	schedule.positions = schedule.positions[:0]
	for _, observer := range schedule.observers {
		schedule.positions = append(schedule.positions, observer.Base().Position)
	}
	visible, distant, drift := rules.UpdateTiers["visible"], rules.UpdateTiers["distant"], rules.UpdateTiers["drift"]
	radiusSquared := rules.VisibleRange * rules.VisibleRange
	clear(schedule.entries)
	schedule.entries = schedule.entries[:0]
	for _, entity := range list {
		object := entity.Base()
		tier := visible
		if len(schedule.positions) > 0 {
			tier = distant
			for _, position := range schedule.positions {
				if Vec.DistanceSquared(object.Position, position) <= radiusSquared {
					tier = visible
					break
				}
			}
		}
		_, craft := entity.(CraftEntity)
		if tier == visible && object.Velocity.X == 0 && object.Velocity.Y == 0 && !craft {
			tier = drift
		}
		step := (object.PendingUpdateTime + rules.SimulationStep) / float64(tier.Substeps)
		schedule.entries = append(schedule.entries, scheduledEntity{entity, object, tier.Substeps, tier.UpdateEvery, step})
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
	clear(schedule.parentRecords)
	schedule.parentRecords = schedule.parentRecords[:0]
	for _, entity := range schedule.parents {
		p := movementParent{entity: entity, object: entity.Base(), holder: entity.(MovementParent)}
		if radial, ok := entity.(interface{ MovementRadius() float64 }); ok {
			radius := radial.MovementRadius()
			p.radiusSquared, p.radial = radius*radius, true
		}
		schedule.parentRecords = append(schedule.parentRecords, p)
	}
	if schedule.parentRecords == nil {
		schedule.parentRecords = []movementParent{}
	}
	world.movementParents = schedule.parentRecords
	for substep := 0; substep < visible.Substeps; substep++ {
		for _, entry := range schedule.entries {
			entity, object := entry.entity, entry.object
			if object.Dead {
				continue
			}
			if substep == 0 {
				object.PendingUpdateTime += dt
			}
			if (tick+1)%uint64(entry.updateEvery) != 0 || substep >= entry.substeps {
				continue
			}
			if object.PendingUpdateTime <= 0 {
				continue
			}
			duration := min(object.PendingUpdateTime, entry.step)
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
	world.movementParents = nil
}
