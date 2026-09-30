// Port of src/shared/simulation/world.ts.
package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	"github.com/burntcustard/unicorn-mining-co/internal/random"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"github.com/burntcustard/unicorn-mining-co/internal/utilities"
	"math"
)

// Entity supplies Go's virtual dispatch for the TypeScript GameObject hierarchy.
type Entity interface {
	Base() *GameObject
	Update(float64)
	Hitbox() []*collision.Collider
	MaxSpeed() float64
}
type Player struct{ ID, ShipID int64 }
type World struct {
	Collisions      CollisionWorld
	shapeOutlines   map[asteroidShapeKey]*ShapeOutline
	ItemTypes       []func(ObjectProperties) Entity
	schedule        movementSchedule
	Entities        *utilities.OrderedMap[int64, Entity]
	MovementParents []Entity
	NextEntityID    int64
	Players         *utilities.OrderedMap[int64, Player]
	Random          *random.Random
	Tick            uint64
	Specification   specification.Catalog
}

func CreateWorld(seed float64, spec specification.Catalog) *World {
	return &World{Entities: utilities.NewOrderedMap[int64, Entity](), NextEntityID: 1, Players: utilities.NewOrderedMap[int64, Player](), Random: random.CreateRandom(seed), Specification: spec}
}
func AddEntity(world *World, entity Entity) Entity {
	entity.Base().World = world
	world.Entities.Set(entity.Base().ID, entity)
	world.NextEntityID = int64(math.Max(float64(world.NextEntityID), float64(entity.Base().ID+1)))
	return entity
}
func AddPlayer(world *World, player Player) Player {
	world.Players.Set(player.ID, player)
	return player
}
func EntityID(world *World) int64 { id := world.NextEntityID; world.NextEntityID++; return id }
