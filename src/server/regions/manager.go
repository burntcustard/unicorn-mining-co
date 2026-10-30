// Package regions streams procedural entities around human and NPC observers.
package regions

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type Manager struct {
	IDOffset   int64
	OnSleep    func(simulation.Entity)
	Managed    *utilities.OrderedMap[int64, bool]
	Sleeping   *utilities.OrderedMap[int64, simulation.Entity]
	wanted     map[int64]bool
	views      []protocol.RegionalView
	Procedural *simulation.RegionManager
	catalog    specs.Catalog
}

func New(seed uint32, catalog specs.Catalog, sectors ...simulation.Sector) *Manager {
	r := &Manager{Managed: utilities.NewOrderedMap[int64, bool](), Sleeping: utilities.NewOrderedMap[int64, simulation.Entity](), wanted: map[int64]bool{}, Procedural: simulation.NewRegionManager(seed, catalog, sectors...), catalog: catalog}

	if len(sectors) == 0 {
		r.Procedural.PreGenerate(catalog.Simulation.PreGeneratedRadius)
	}

	return r
}

func (r *Manager) View(position Vec.Vector, ranges *protocol.WorldRanges) protocol.RegionalView {
	return r.Procedural.Query(position, ranges)
}

func (r *Manager) Sync(world *simulation.World, positions []Vec.Vector) {
	world.Loading = true

	defer func() { world.Loading = false }()

	var limits []float64

	world.Players.ForEach(func(player simulation.Player, _ int64) {
		if player.ObserverRange <= 0 {
			return
		}

		if ship, ok := world.Entities.Get(player.ShipID); ok && !ship.Base().Dead {
			if limits == nil {
				limits = make([]float64, len(positions))
			}

			positions = append(positions, ship.Base().Position)
			limits = append(limits, player.ObserverRange)
		}
	})

	ranges := protocol.Ranges(r.catalog.Simulation.ServerRegionRanges)

	nearby := func(e simulation.Entity) bool {
		reach := ranges.Asteroid

		if e.Base().Kind == "station" {
			reach = ranges.StationPhysics
		}

		for i, p := range positions {
			reach := reach

			if i < len(limits) && limits[i] > 0 {
				reach = min(reach, limits[i])
			}

			if Vec.DistanceSquared(e.Base().Position, p) <= reach*reach {
				return true
			}
		}

		return false
	}

	r.Sleeping.ForEach(func(e simulation.Entity, id int64) {
		if !nearby(e) {
			return
		}

		simulation.AddEntity(world, e)

		r.Sleeping.Delete(id)
	})

	world.Entities.ForEach(func(e simulation.Entity, id int64) {
		if r.Managed.Has(id) || e.Base().PlayerID != nil || e.Base().Kind == "jumpGate" || e.Base().Kind == "wormhole" || nearby(e) {
			return
		}

		r.Sleeping.Set(id, e)

		if r.OnSleep != nil {
			r.OnSleep(e)
		}

		world.Entities.Delete(id)
	})

	r.views = r.Procedural.QueryManyInto(r.views, positions, &ranges, limits...)
	wanted := r.wanted
	clear(wanted)

	for _, view := range r.views {
		for _, d := range view.Asteroids {
			id := r.IDOffset + int64(d.ID)

			if wanted[id] {
				continue
			}

			wanted[id] = true

			if world.Entities.Has(id) || r.Sleeping.Has(id) {
				continue
			}

			if r.Managed.Has(id) {
				r.Procedural.Remove(d.ID)
				r.Managed.Delete(id)
				continue
			}

			props := simulation.AsteroidProperties{ID: &id, Position: d.Position, Radius: &d.Radius, Rotation: d.Rotation, Spin: d.Spin, Resource: &d.Resource, Contents: d.Contents, PointCount: d.PointCount}

			if d.RadiusEven != 0 {
				props.RadiusEven = &d.RadiusEven
			}

			simulation.AddEntity(world, simulation.CreateAsteroid(world, props).LockGeometry())
			r.Managed.Set(id, true)
		}

		for _, d := range view.Stations {
			id := r.IDOffset + int64(d.ID)

			if wanted[id] {
				continue
			}

			wanted[id] = true

			if world.Entities.Has(id) || r.Sleeping.Has(id) {
				continue
			}

			if r.Managed.Has(id) {
				r.Procedural.Remove(d.ID)
				r.Managed.Delete(id)
				continue
			}

			station := objects.CreateStation(objects.Properties{DefinitionID: d.DefinitionID, World: world, ID: &id, Position: d.Position, Radius: &d.Radius, Spin: d.Spin}, r.catalog)
			simulation.AddEntity(world, station)
			r.Managed.Set(id, true)
		}

		for _, d := range view.Wrecks {
			id := r.IDOffset + int64(d.ID)

			if wanted[id] {
				continue
			}

			wanted[id] = true

			if world.Entities.Has(id) || r.Sleeping.Has(id) {
				continue
			}

			wreck := objects.CreateShip(world, objects.Properties{ID: &id, Position: d.Position})

			for _, resource := range d.CargoContents {
				id := simulation.EntityID(world)
				wreck.CargoContents = append(wreck.CargoContents, world.ItemTypes[resource](simulation.ObjectProperties{World: world, ID: &id}))
			}

			if d.ClueField != nil {
				message := simulation.FieldMessage(d.ClueField.Position, d.ClueField.Resource)
				messageID := simulation.EntityID(world)
				wreck.CargoContents = append(wreck.CargoContents, objects.NewItem("message", simulation.ObjectProperties{World: world, ID: &messageID, Message: &message}, r.catalog))
			}

			wreck.Paint = d.Paint
			wreck.HasPaint = true
			simulation.AddEntity(world, wreck)
			r.Managed.Set(id, true)
		}
	}

	r.Managed.ForEach(func(_ bool, id int64) {
		if wanted[id] {
			return
		}

		if e, ok := world.Entities.Get(id); ok {
			r.Sleeping.Set(id, e)

			if r.OnSleep != nil {
				r.OnSleep(e)
			}
		}

		world.Entities.Delete(id)
	})
}

/*
NearestStation expands the marker query only when the current view is empty.
*/
func (r *Manager) NearestStation(position Vec.Vector) protocol.StationDescription {
	ranges := protocol.Ranges(r.catalog.Simulation.WorldRanges)
	stations := r.View(position, nil).StationMarkers

	for len(stations) == 0 && ranges.StationMarker < 200000 {
		ranges.StationMarker *= 2
		stations = r.View(position, &ranges).StationMarkers
	}

	var closest protocol.StationDescription
	best := math.Inf(1)

	for _, station := range stations {
		if distance := Vec.DistanceSquared(position, station.Position); distance < best {
			best, closest = distance, station
		}
	}

	return closest
}
