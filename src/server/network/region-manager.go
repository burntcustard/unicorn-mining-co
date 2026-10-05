// Port of src/server/region-manager.ts.
package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type RegionManager struct {
	onSleep  func(simulation.Entity)
	managed  *utilities.OrderedMap[int64, bool]
	sleeping *utilities.OrderedMap[int64, simulation.Entity]
	regions  *simulation.RegionManager
	catalog  definitions.Catalog
}

func NewRegionManager(seed uint32, catalog definitions.Catalog) *RegionManager {
	r := &RegionManager{managed: utilities.NewOrderedMap[int64, bool](), sleeping: utilities.NewOrderedMap[int64, simulation.Entity](), regions: simulation.NewRegionManager(seed, catalog), catalog: catalog}
	r.regions.PreGenerate(catalog.Simulation.PreGeneratedRadius)
	return r
}

func (r *RegionManager) View(position Vec.Vector, ranges *protocol.WorldRanges) protocol.RegionalView {
	return r.regions.Query(position, ranges)
}

func (r *RegionManager) Sync(world *simulation.World, positions []Vec.Vector) []protocol.RegionalView {
	world.Loading = true

	defer func() { world.Loading = false }()

	ranges := protocol.Ranges(r.catalog.Simulation.ServerRegionRanges)

	nearby := func(e simulation.Entity) bool {
		reach := ranges.Asteroid

		if e.Base().Kind == "station" {
			reach = ranges.StationPhysics
		}

		for _, p := range positions {
			if Vec.DistanceSquared(e.Base().Position, p) <= reach*reach {
				return true
			}
		}

		return false
	}

	r.sleeping.ForEach(func(e simulation.Entity, id int64) {
		if !nearby(e) {
			return
		}

		simulation.AddEntity(world, e)

		r.sleeping.Delete(id)
	})

	world.Entities.ForEach(func(e simulation.Entity, id int64) {
		if r.managed.Has(id) || e.Base().PlayerID != nil || nearby(e) {
			return
		}

		r.sleeping.Set(id, e)

		if r.onSleep != nil {
			r.onSleep(e)
		}

		world.Entities.Delete(id)
	})

	views := r.regions.QueryMany(positions, &ranges)
	wanted := map[int64]bool{}

	for _, view := range views {
		for _, d := range view.Asteroids {
			id := int64(d.ID)

			if wanted[id] {
				continue
			}

			wanted[id] = true

			if world.Entities.Has(id) || r.sleeping.Has(id) {
				continue
			}

			if r.managed.Has(id) {
				r.regions.Remove(d.ID)
				r.managed.Delete(id)
				continue
			}

			props := simulation.AsteroidProperties{ID: &id, Position: d.Position, Radius: &d.Radius, Rotation: d.Rotation, Spin: d.Spin, Resource: &d.Resource, Contents: d.Contents, PointCount: d.PointCount}

			if d.RadiusEven != 0 {
				props.RadiusEven = &d.RadiusEven
			}

			simulation.AddEntity(world, simulation.CreateAsteroid(world, props).LockGeometry())
			r.managed.Set(id, true)
		}

		for _, d := range view.Stations {
			id := int64(d.ID)

			if wanted[id] {
				continue
			}

			wanted[id] = true

			if world.Entities.Has(id) || r.sleeping.Has(id) {
				continue
			}

			if r.managed.Has(id) {
				r.regions.Remove(d.ID)
				r.managed.Delete(id)
				continue
			}

			station := objects.CreateStation(objects.Properties{World: world, ID: &id, Position: d.Position, Radius: &d.Radius, Spin: d.Spin}, r.catalog)
			simulation.AddEntity(world, station)
			r.managed.Set(id, true)
		}

		for _, d := range view.Wrecks {
			id := int64(d.ID)

			if wanted[id] {
				continue
			}

			wanted[id] = true

			if world.Entities.Has(id) || r.sleeping.Has(id) {
				continue
			}

			wreck := objects.CreateShip(world, objects.Properties{ID: &id, Position: d.Position})

			for _, resource := range d.CargoContents {
				id := simulation.EntityID(world)
				wreck.CargoContents = append(wreck.CargoContents, world.ItemTypes[resource](simulation.ObjectProperties{World: world, ID: &id}))
			}

			message := simulation.FieldMessage(d.ClueField.Position, d.ClueField.Resource)
			messageID := simulation.EntityID(world)
			wreck.CargoContents = append(wreck.CargoContents, objects.NewItem("message", simulation.ObjectProperties{World: world, ID: &messageID, Message: &message}, r.catalog))
			wreck.Paint = d.Paint
			wreck.HasPaint = true
			simulation.AddEntity(world, wreck)
			r.managed.Set(id, true)
		}
	}

	r.managed.ForEach(func(_ bool, id int64) {
		if wanted[id] {
			return
		}

		if e, ok := world.Entities.Get(id); ok {
			r.sleeping.Set(id, e)

			if r.onSleep != nil {
				r.onSleep(e)
			}
		}

		world.Entities.Delete(id)
	})

	return views
}
