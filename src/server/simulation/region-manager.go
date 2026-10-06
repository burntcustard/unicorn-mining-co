// Port of src/client/simulation/region-manager.ts.
package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

type queriedRegions struct {
	bounds, stationBounds []regionBounds
	asteroids             [][]protocol.AsteroidDescription
	wrecks                [][]protocol.WreckDescription
	stations              [][]protocol.StationDescription
}

type regionBounds struct{ from, to Vec.Vector }

type RegionManager struct {
	loaded                    *utilities.OrderedMap[Vec.Vector, *protocol.LoadedRegion]
	saved                     map[Vec.Vector]*protocol.RegionDescription
	worldSeed                 uint32
	removed                   map[uint32]bool
	descriptionOwners         map[uint32][]*protocol.RegionDescription
	stationLists              map[regionBounds][]protocol.StationDescription
	queryBounds, markerBounds []regionBounds
	queried                   *queriedRegions
	generator                 *RegionGenerator
	catalog                   specs.Catalog
}

func NewRegionManager(seed uint32, catalog specs.Catalog) *RegionManager {
	return &RegionManager{loaded: utilities.NewOrderedMap[Vec.Vector, *protocol.LoadedRegion](), saved: map[Vec.Vector]*protocol.RegionDescription{}, worldSeed: seed, removed: map[uint32]bool{}, descriptionOwners: map[uint32][]*protocol.RegionDescription{}, stationLists: map[regionBounds][]protocol.StationDescription{}, generator: NewRegionGenerator(catalog), catalog: catalog}
}

func (r *RegionManager) LoadedRegionCount() int { return r.loaded.Len() }

func (r *RegionManager) PreGenerate(radius float64) {
	size := r.catalog.Simulation.RegionSize
	reach := math.Ceil(radius / size)

	for x := -reach; x < reach; x++ {
		for y := -reach; y < reach; y++ {
			nx, ny := max(max(x, 0), -x-1)*size, max(max(y, 0), -y-1)*size
			region := Vec.Create(x, y)
			key := region

			if nx*nx+ny*ny >= radius*radius || r.loaded.Has(key) || r.saved[key] != nil {
				continue
			}

			r.Load(region)
			r.Unload(region)
		}
	}
}

func (r *RegionManager) Load(region Vec.Vector) *protocol.LoadedRegion {
	key := region

	if existing, ok := r.loaded.Get(key); ok {
		return existing
	}

	description := r.saved[key]

	if description == nil {
		d := r.generator.GenerateRegion(r.worldSeed, region)
		description = &d

		description.Asteroids = slices.DeleteFunc(description.Asteroids, func(d protocol.AsteroidDescription) bool { return r.removed[d.ID] })

		description.Stations = slices.DeleteFunc(description.Stations, func(d protocol.StationDescription) bool { return r.removed[d.ID] })

		description.Wrecks = slices.DeleteFunc(description.Wrecks, func(d protocol.WreckDescription) bool { return r.removed[d.ID] })

		addOwner := func(id uint32) {
			owners := r.descriptionOwners[id]

			if !slices.Contains(owners, description) {
				r.descriptionOwners[id] = append(owners, description)
			}
		}

		for _, d := range description.Asteroids {
			addOwner(d.ID)
		}

		for _, d := range description.Stations {
			addOwner(d.ID)
		}

		for _, d := range description.Wrecks {
			addOwner(d.ID)
		}
	}

	loaded := &protocol.LoadedRegion{Description: description, Seed: RegionSeed(r.worldSeed, region)}
	r.queried = nil
	delete(r.saved, key)
	r.loaded.Set(key, loaded)
	return loaded
}

func (r *RegionManager) Unload(region Vec.Vector) {
	key := region
	loaded, ok := r.loaded.Get(key)

	if !ok {
		return
	}

	r.queried = nil
	r.saved[key] = loaded.Description
	r.loaded.Delete(key)
}

func (r *RegionManager) Remove(id uint32) {
	r.removed[id] = true
	r.queried = nil
	clear(r.stationLists)

	for _, d := range r.descriptionOwners[id] {
		// Array replacement matters: an in-progress regional view still owns its old lists.
		a := make([]protocol.AsteroidDescription, 0, len(d.Asteroids))

		for _, v := range d.Asteroids {
			if v.ID != id {
				a = append(a, v)
			}
		}

		d.Asteroids = a
		s := make([]protocol.StationDescription, 0, len(d.Stations))

		for _, v := range d.Stations {
			if v.ID != id {
				s = append(s, v)
			}
		}

		d.Stations = s
		w := make([]protocol.WreckDescription, 0, len(d.Wrecks))

		for _, v := range d.Wrecks {
			if v.ID != id {
				w = append(w, v)
			}
		}

		d.Wrecks = w
	}

	delete(r.descriptionOwners, id)
}

func (r *RegionManager) Query(position Vec.Vector, ranges *protocol.WorldRanges) protocol.RegionalView {
	return r.QueryMany([]Vec.Vector{position}, ranges)[0]
}

func (r *RegionManager) QueryMany(positions []Vec.Vector, supplied *protocol.WorldRanges) []protocol.RegionalView {
	ranges := protocol.Ranges(r.catalog.Simulation.WorldRanges)

	if supplied != nil {
		ranges = *supplied
	}

	size := r.catalog.Simulation.RegionSize

	boundsFor := func(out []regionBounds, reach float64) []regionBounds {
		if cap(out) < len(positions) {
			out = make([]regionBounds, len(positions))
		}

		out = out[:len(positions)]

		for i, p := range positions {
			out[i] = regionBounds{Vec.Create(math.Floor((p.X-reach)/size), math.Floor((p.Y-reach)/size)), Vec.Create(math.Floor((p.X+reach)/size), math.Floor((p.Y+reach)/size))}
		}

		return out
	}

	r.queryBounds = boundsFor(r.queryBounds, max(ranges.Asteroid, ranges.Wreck))
	r.markerBounds = boundsFor(r.markerBounds, max(ranges.StationMarker, ranges.StationPhysics))
	all, stationBounds := r.queryBounds, r.markerBounds

	if r.queried == nil || !slices.Equal(r.queried.bounds, all) || !slices.Equal(r.queried.stationBounds, stationBounds) {
		needed := map[Vec.Vector]bool{}
		descriptions := make([][]*protocol.RegionDescription, len(all))

		for i, b := range all {
			for x := b.from.X; x <= b.to.X; x++ {
				for y := b.from.Y; y <= b.to.Y; y++ {
					region := Vec.Create(x, y)
					needed[region] = true
					descriptions[i] = append(descriptions[i], r.Load(region).Description)
				}
			}
		}

		for _, loaded := range r.loaded.Values() {
			if !needed[loaded.Description.Region] {
				r.Unload(loaded.Description.Region)
			}
		}

		stations := make([][]protocol.StationDescription, len(stationBounds))

		for i, b := range stationBounds {
			listKey := b

			if cached, ok := r.stationLists[listKey]; ok {
				stations[i] = cached
				continue
			}

			found := []protocol.StationDescription{}

			for x := b.from.X; x <= b.to.X; x++ {
				for y := b.from.Y; y <= b.to.Y; y++ {
					region := Vec.Create(x, y)
					key := region
					description := r.saved[key]

					if loaded, ok := r.loaded.Get(key); ok {
						description = loaded.Description
					}

					var candidates []protocol.StationDescription

					if description != nil {
						candidates = description.Stations
					} else {
						candidates = r.generator.GenerateStations(r.worldSeed, Vec.Scale(region, size), Vec.Scale(Vec.Add(region, Vec.Create(1, 1)), size))
					}

					for _, v := range candidates {
						if !r.removed[v.ID] {
							found = append(found, v)
						}
					}
				}
			}

			if len(r.stationLists) >= 64 {
				clear(r.stationLists)
			}

			r.stationLists[listKey] = found
			stations[i] = found
		}

		cached := &queriedRegions{bounds: slices.Clone(all), stationBounds: slices.Clone(stationBounds), asteroids: make([][]protocol.AsteroidDescription, len(all)), wrecks: make([][]protocol.WreckDescription, len(all)), stations: stations}

		for i, regions := range descriptions {
			for _, d := range regions {
				cached.asteroids[i] = append(cached.asteroids[i], d.Asteroids...)
				cached.wrecks[i] = append(cached.wrecks[i], d.Wrecks...)
			}
		}

		r.queried = cached
	}

	result := make([]protocol.RegionalView, len(positions))

	for i, p := range positions {
		view := protocol.RegionalView{Asteroids: []protocol.AsteroidDescription{}, StationMarkers: []protocol.StationDescription{}, Stations: []protocol.StationDescription{}, Wrecks: []protocol.WreckDescription{}}

		for _, a := range r.queried.asteroids[i] {
			if Vec.DistanceSquared(a.Position, p) <= ranges.Asteroid*ranges.Asteroid {
				view.Asteroids = append(view.Asteroids, a)
			}
		}

		for _, s := range r.queried.stations[i] {
			distance := Vec.DistanceSquared(s.Position, p)

			if distance <= ranges.StationMarker*ranges.StationMarker {
				view.StationMarkers = append(view.StationMarkers, s)
			}

			if distance <= ranges.StationPhysics*ranges.StationPhysics {
				view.Stations = append(view.Stations, s)
			}
		}

		for _, w := range r.queried.wrecks[i] {
			if Vec.DistanceSquared(w.Position, p) <= ranges.Wreck*ranges.Wreck {
				view.Wrecks = append(view.Wrecks, w)
			}
		}

		result[i] = view
	}

	return result
}
