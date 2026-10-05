// Port of src/client/simulation/world.ts.
package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/random"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
)

// Entity supplies Go's virtual dispatch for the TypeScript GameObject hierarchy.
type Entity interface {
	Base() *GameObject
	Update(float64)
	Hitbox() []*collision.Collider
	MaxSpeed() float64
}

type Player struct {
	ID, ShipID int64
	Credits    *float64
}

type World struct {
	// Called only by the world owner for gameplay creation/removal, not loading.
	EntityChanged   func(Entity, bool)
	Loading         bool
	Collisions      CollisionWorld
	shapeOutlines   map[asteroidShapeKey]*ShapeOutline
	ItemTypes       []func(ObjectProperties) Entity
	schedule        movementSchedule
	Entities        *utilities.OrderedMap[int64, Entity]
	MovementParents []Entity
	movementParents []movementParent
	contactHandlers []Entity
	NextEntityID    int64
	NextObjectID    int64
	Players         *utilities.OrderedMap[int64, Player]
	Random          *random.Random
	Tick            uint64
	Specification   definitions.Catalog
}

func CreateWorld(seed float64, spec definitions.Catalog) *World {
	return &World{Entities: utilities.NewOrderedMap[int64, Entity](), NextEntityID: 1, Players: utilities.NewOrderedMap[int64, Player](), Random: random.CreateRandom(seed), Specification: spec}
}

func AddEntity(world *World, entity Entity) Entity {
	entity.Base().World = world
	world.Entities.Set(entity.Base().ID, entity)
	world.NextEntityID = max(world.NextEntityID, entity.Base().ID+1)

	if world.EntityChanged != nil && !world.Loading {
		world.EntityChanged(entity, false)
	}

	return entity
}

func AddPlayer(world *World, player Player) Player {
	world.Players.Set(player.ID, player)
	return player
}

func EntityID(world *World) int64 { id := world.NextEntityID; world.NextEntityID++; return id }

// ObjectID allocates negative IDs for modules and other non-entity objects.
func ObjectID(world *World) int64 { world.NextObjectID--; return world.NextObjectID }
