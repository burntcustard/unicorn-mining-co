// Port of src/shared/simulation/region-manager.ts.
package simulation

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"github.com/burntcustard/unicorn-mining-co/internal/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
	"slices"
	"strings"
)

type queriedRegions struct {
	bounds    string
	asteroids [][]protocol.AsteroidDescription
	wrecks    [][]protocol.WreckDescription
	stations  [][]protocol.StationDescription
}
type RegionManager struct {
	loaded            *utilities.OrderedMap[string, *protocol.LoadedRegion]
	saved             map[string]*protocol.RegionDescription
	worldSeed         uint32
	removed           map[uint32]bool
	descriptionOwners map[uint32][]*protocol.RegionDescription
	stationLists      map[string][]protocol.StationDescription
	queried           *queriedRegions
	generator         *RegionGenerator
	catalog           specification.Catalog
}

func NewRegionManager(seed uint32, catalog specification.Catalog) *RegionManager {
	return &RegionManager{loaded: utilities.NewOrderedMap[string, *protocol.LoadedRegion](), saved: map[string]*protocol.RegionDescription{}, worldSeed: seed, removed: map[uint32]bool{}, descriptionOwners: map[uint32][]*protocol.RegionDescription{}, stationLists: map[string][]protocol.StationDescription{}, generator: NewRegionGenerator(catalog), catalog: catalog}
}
func keyOf(region Vec.Vector) string            { return fmt.Sprintf("%g,%g", region.X, region.Y) }
func (r *RegionManager) LoadedRegionCount() int { return r.loaded.Len() }
func (r *RegionManager) PreGenerate(radius float64) {
	size := r.catalog.Simulation.RegionSize
	reach := math.Ceil(radius / size)
	for x := -reach; x < reach; x++ {
		for y := -reach; y < reach; y++ {
			nx, ny := math.Max(math.Max(x, 0), -x-1)*size, math.Max(math.Max(y, 0), -y-1)*size
			region := Vec.Create(x, y)
			key := keyOf(region)
			if nx*nx+ny*ny >= radius*radius || r.loaded.Has(key) || r.saved[key] != nil {
				continue
			}
			r.Load(region)
			r.Unload(region)
		}
	}
}
func (r *RegionManager) Load(region Vec.Vector) *protocol.LoadedRegion {
	key := keyOf(region)
	if existing, ok := r.loaded.Get(key); ok {
		return existing
	}
	description := r.saved[key]
	if description == nil {
		d := r.generator.GenerateRegion(r.worldSeed, region)
		description = &d
		clear(r.stationLists)
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
	key := keyOf(region)
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
	type bounds struct{ from, to Vec.Vector }
	boundsFor := func(reach float64) []bounds {
		out := make([]bounds, len(positions))
		for i, p := range positions {
			out[i] = bounds{Vec.Create(math.Floor((p.X-reach)/size), math.Floor((p.Y-reach)/size)), Vec.Create(math.Floor((p.X+reach)/size), math.Floor((p.Y+reach)/size))}
		}
		return out
	}
	boundsKey := func(b bounds) string { return fmt.Sprintf("%g,%g,%g,%g", b.from.X, b.from.Y, b.to.X, b.to.Y) }
	all, stationBounds := boundsFor(math.Max(ranges.Asteroid, ranges.Wreck)), boundsFor(math.Max(ranges.StationMarker, ranges.StationPhysics))
	keys := []string{}
	for _, b := range all {
		keys = append(keys, boundsKey(b))
	}
	for _, b := range stationBounds {
		keys = append(keys, boundsKey(b))
	}
	key := strings.Join(keys, ";")
	if r.queried == nil || r.queried.bounds != key {
		needed := map[string]bool{}
		descriptions := make([][]*protocol.RegionDescription, len(all))
		for i, b := range all {
			for x := b.from.X; x <= b.to.X; x++ {
				for y := b.from.Y; y <= b.to.Y; y++ {
					region := Vec.Create(x, y)
					needed[keyOf(region)] = true
					descriptions[i] = append(descriptions[i], r.Load(region).Description)
				}
			}
		}
		for _, loaded := range r.loaded.Values() {
			if !needed[keyOf(loaded.Description.Region)] {
				r.Unload(loaded.Description.Region)
			}
		}
		stations := make([][]protocol.StationDescription, len(stationBounds))
		for i, b := range stationBounds {
			listKey := boundsKey(b)
			if cached, ok := r.stationLists[listKey]; ok {
				stations[i] = cached
				continue
			}
			found := []protocol.StationDescription{}
			for x := b.from.X; x <= b.to.X; x++ {
				for y := b.from.Y; y <= b.to.Y; y++ {
					region := Vec.Create(x, y)
					key := keyOf(region)
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
		cached := &queriedRegions{bounds: key, asteroids: make([][]protocol.AsteroidDescription, len(all)), wrecks: make([][]protocol.WreckDescription, len(all)), stations: stations}
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
