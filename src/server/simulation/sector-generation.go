package simulation

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/random"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"strings"
)

type SectorConnectionSite struct {
	ID       string     `json:"id"`
	Position Vec.Vector `json:"position"`
	Arrival  Vec.Vector `json:"arrival"`
	Radius   float64    `json:"radius"`
}

type Sector struct {
	ID            string                 `json:"id"`
	Name          string                 `json:"name"`
	Seed          uint32                 `json:"seed"`
	MapPosition   Vec.Vector             `json:"mapPosition"`
	RadiusX       float64                `json:"radiusX"`
	RadiusY       float64                `json:"radiusY"`
	Rotation      float64                `json:"rotation"`
	GateSites     []SectorConnectionSite `json:"gateSites"`
	WormholeSites []SectorConnectionSite `json:"wormholeSites"`
}

type SectorLink struct {
	ID       string    `json:"id"`
	Sectors  [2]string `json:"sectors"`
	Sites    [2]int    `json:"sites"`
	Rotation float64   `json:"rotation"`
}

type SectorMap struct {
	Sectors       []Sector     `json:"sectors"`
	Links         []SectorLink `json:"links"`
	WormholeLinks []SectorLink `json:"wormholeLinks"`
	Enabled       []string     `json:"enabled"`
}

func namedSeed(seed uint32, name string) uint32 {
	hash := uint32(0x811c9dc5)

	for _, c := range name {
		hash = (hash ^ uint32(c)) * 0x01000193
	}

	return mix(seed ^ hash)
}

func connectionSite(sector Sector, index int, wormhole bool, spec specs.SectorGeneration) SectorConnectionSite {
	kind, offset, radius := "gate", 0, spec.GateRadius
	minimum, spread := spec.GateDistance, spec.GateDistanceRange

	if wormhole {
		kind, offset, radius = "wormhole", 1, spec.WormholeRadius
		minimum, spread = spec.WormholeDistance, spec.WormholeDistanceRange
	}

	r := random.CreateRandom(float64(namedSeed(sector.Seed, fmt.Sprintf("%s:%d", kind, index))))
	rotation := random.CreateRandom(float64(namedSeed(sector.Seed, "connections"))).Next() * math.Pi * 2
	sin, cos := utilities.SinCos(sector.Rotation)
	as, ac := utilities.SinCos(rotation + float64([4]int{0, 2, 1, 3}[index]*2+offset)*math.Pi/4)
	x, y := ac*sector.RadiusX, as*sector.RadiusY
	axisLength := math.Sqrt(x*x + y*y)
	maximum := math.Min(minimum+spread, spec.MaxConnectionDistance/axisLength)
	inner := math.Min(minimum, maximum)
	sample := r.Next()
	distance := inner + sample*(maximum-inner)

	if wormhole {
		distance = math.Sqrt(inner*inner + sample*(maximum*maximum-inner*inner))
	}

	position := Vec.Create(roundInteger((x*cos-y*sin)*distance), roundInteger((x*sin+y*cos)*distance))
	length := Vec.Length(position)
	arrival := Vec.Create(roundInteger(position.X*(1-spec.GateArrivalDistance/length)), roundInteger(position.Y*(1-spec.GateArrivalDistance/length)))
	return SectorConnectionSite{ID: fmt.Sprintf("%s:%s:%d", sector.ID, kind, index), Position: position, Arrival: arrival, Radius: radius}
}

func GenerateSector(worldSeed uint32, name string, catalog specs.Catalog) Sector {
	spec := catalog.SectorGeneration
	id := strings.ToLower(name)
	seed := namedSeed(worldSeed, id)
	r := random.CreateRandom(float64(seed))
	size := r.Next()
	rx := roundInteger(spec.CruiseSpeed * 60 * (spec.CrossingMinutes + size*spec.CrossingMinutesRange) / 2)
	ry := roundInteger(rx * (spec.AspectRatio + r.Next()*spec.AspectRatioRange))
	rotation := roundInteger(r.Next()*360) * math.Pi / 180
	m := random.CreateRandom(float64(namedSeed(seed, "map")))
	ms, mc := utilities.SinCos(m.Next() * math.Pi * 2)
	mr := math.Sqrt(m.Next())
	mapPosition := Vec.Create(roundInteger(mr*mc*spec.MapRadiusX), roundInteger(mr*ms*spec.MapRadiusY))
	c := random.CreateRandom(float64(namedSeed(seed, "connection-counts")))
	countRange := 2 + size*float64(spec.MaxConnections-1)
	gateCount := int(math.Floor(c.Next() * countRange))
	wormholeCount := int(math.Floor(c.Next() * countRange))

	if gateCount == 0 && wormholeCount == 0 {
		if c.Next() < 0.5 {
			gateCount = 1
		} else {
			wormholeCount = 1
		}
	}

	geometry := Sector{ID: id, Seed: seed, RadiusX: rx, RadiusY: ry, Rotation: rotation}
	gateSites := []SectorConnectionSite{}
	wormholeSites := []SectorConnectionSite{}

	for i := range gateCount {
		gateSites = append(gateSites, connectionSite(geometry, i, false, spec))
	}

	for i := range wormholeCount {
		wormholeSites = append(wormholeSites, connectionSite(geometry, i, true, spec))
	}

	return Sector{ID: id, Name: name, Seed: seed, MapPosition: mapPosition, RadiusX: rx, RadiusY: ry, Rotation: rotation, GateSites: gateSites, WormholeSites: wormholeSites}
}

func GenerateSectorMap(worldSeed uint32, catalog specs.Catalog) SectorMap {
	spec := catalog.SectorGeneration
	result := SectorMap{Sectors: []Sector{}, Links: []SectorLink{}, WormholeLinks: []SectorLink{}, Enabled: []string{}}
	degrees := map[string]int{}
	wormholeDegrees := map[string]int{}
	anchor := -1

	for _, name := range catalog.SectorNames {
		sector := GenerateSector(worldSeed, name, catalog)

		if _, exists := degrees[sector.ID]; exists {
			panic("duplicate sector ID")
		}

		degrees[sector.ID] = 0
		wormholeDegrees[sector.ID] = 0

		if sector.ID == spec.GraphAnchor {
			anchor = len(result.Sectors)
		}

		result.Sectors = append(result.Sectors, sector)
	}

	if anchor < 0 {
		panic("missing graph anchor")
	}

	ordered := []*Sector{&result.Sectors[anchor]}

	for i := range result.Sectors {
		if i != anchor {
			ordered = append(ordered, &result.Sectors[i])
		}
	}

	connected := []*Sector{ordered[0]}

	linkID := func(a, b *Sector) string {
		ids := []string{a.ID, b.ID}
		slices.Sort(ids)
		return strings.Join(ids, "/")
	}

	connect := func(a, b *Sector, target *[]SectorLink, counts map[string]int) {
		id := linkID(a, b)
		rotation := random.CreateRandom(float64(namedSeed(worldSeed, id))).Next() * math.Pi * 2
		*target = append(*target, SectorLink{ID: id, Sectors: [2]string{a.ID, b.ID}, Sites: [2]int{counts[a.ID], counts[b.ID]}, Rotation: rotation})
		counts[a.ID]++
		counts[b.ID]++
	}

	freeSites := func() int {
		free := 0

		for _, sector := range connected {
			free += len(sector.GateSites) - degrees[sector.ID] + len(sector.WormholeSites) - wormholeDegrees[sector.ID]
		}

		return free
	}

	fillSites := func(target *[]SectorLink, counts map[string]int, wormholes bool, reserve int) {
		capacity := func(sector *Sector) int {
			if wormholes {
				return len(sector.WormholeSites)
			}

			return len(sector.GateSites)
		}

		free := 0

		for _, a := range connected {
			free += capacity(a) - counts[a.ID]
		}

		existing := map[string]bool{}

		for _, link := range *target {
			existing[link.ID] = true
		}

		remaining := func(sector *Sector) int { return capacity(sector) - counts[sector.ID] }

		needed := func(sector *Sector) int { return max(0, min(3, capacity(sector))-counts[sector.ID]) }

		priority := func(a, b *Sector) int {
			if d := needed(b) - needed(a); d != 0 {
				return d
			}

			return remaining(b) - remaining(a)
		}

		for free >= reserve+2 {
			available := []*Sector{}

			for _, sector := range connected {
				if remaining(sector) > 0 {
					available = append(available, sector)
				}
			}

			slices.SortFunc(available, func(a, b *Sector) int {
				if p := priority(a, b); p != 0 {
					return p
				}

				return strings.Compare(a.ID, b.ID)
			})

			index := slices.IndexFunc(available, func(entry *Sector) bool {
				return slices.ContainsFunc(available, func(other *Sector) bool {
					return other.ID != entry.ID && !existing[linkID(entry, other)]
				})
			})

			if index < 0 {
				break
			}

			a := available[index]
			partners := []*Sector{}

			for _, entry := range available {
				if entry.ID != a.ID && !existing[linkID(a, entry)] {
					partners = append(partners, entry)
				}
			}

			slices.SortFunc(partners, func(b, c *Sector) int {
				if p := priority(b, c); p != 0 {
					return p
				}

				d := Vec.DistanceSquared(a.MapPosition, b.MapPosition) - Vec.DistanceSquared(a.MapPosition, c.MapPosition)

				if d < 0 {
					return -1
				}

				if d > 0 {
					return 1
				}

				return strings.Compare(b.ID, c.ID)
			})

			b := partners[0]
			connect(a, b, target, counts)
			existing[linkID(a, b)] = true
			free -= 2
		}
	}

	for start := 1; start < len(ordered); {
		end := start + 1

		for _, limit := range spec.GraphStages {
			if limit > start {
				end = min(len(ordered), limit)
				break
			}
		}

		pending := slices.Clone(ordered[start:end])
		expandable := map[*Sector]bool{}
		first := start

		if start == 1 {
			first = 0
		}

		for _, sector := range ordered[first:end] {
			expandable[sector] = true
		}

		type connection struct {
			other  *Sector
			counts map[string]int
			target *[]SectorLink
		}

		findConnection := func(entry *Sector) *connection {
			for _, wormholes := range []bool{false, true} {
				capacity := func(sector *Sector) int {
					if wormholes {
						return len(sector.WormholeSites)
					}

					return len(sector.GateSites)
				}

				if capacity(entry) == 0 {
					continue
				}

				counts, target := degrees, &result.Links

				if wormholes {
					counts, target = wormholeDegrees, &result.WormholeLinks
				}

				nearby := []*Sector{}

				for _, candidate := range connected {
					if counts[candidate.ID] < capacity(candidate) {
						nearby = append(nearby, candidate)
					}
				}

				slices.SortFunc(nearby, func(a, b *Sector) int {
					d := Vec.DistanceSquared(a.MapPosition, entry.MapPosition) - Vec.DistanceSquared(b.MapPosition, entry.MapPosition)

					if d < 0 {
						return -1
					}

					if d > 0 {
						return 1
					}

					return strings.Compare(a.ID, b.ID)
				})

				if len(nearby) > 0 {
					return &connection{nearby[0], counts, target}
				}
			}

			return nil
		}

		for len(pending) > 0 {
			free := freeSites()

			index := slices.IndexFunc(pending, func(entry *Sector) bool {
				return (free > 1 || len(entry.GateSites)+len(entry.WormholeSites) > 1 || len(pending) == 1) && findConnection(entry) != nil
			})

			if free == 0 || index < 0 {
				capacity := func(entry *Sector) int {
					return min(spec.MaxConnections, int(math.Floor(2+((entry.RadiusX*2/spec.CruiseSpeed/60-spec.CrossingMinutes)/spec.CrossingMinutesRange)*float64(spec.MaxConnections-1))))
				}

				type bridgeOption struct {
					a, b       *Sector
					wormholes  bool
					counts     map[string]int
					addA, addB int
					id         string
				}

				options := []bridgeOption{}

				for _, wormholes := range []bool{false, true} {
					kind, counts := "gateSites", degrees

					length := func(entry *Sector) int {
						if wormholes {
							return len(entry.WormholeSites)
						}

						return len(entry.GateSites)
					}

					if wormholes {
						kind, counts = "wormholeSites", wormholeDegrees
					}

					for _, a := range connected {
						for _, b := range pending {
							addA, addB := 0, 0

							if counts[a.ID] == length(a) {
								addA = 1
							}

							if length(b) == 0 {
								addB = 1
							}

							if (addA == 0 || expandable[a]) && length(a)+addA <= capacity(a) && length(b)+addB <= capacity(b) {
								options = append(options, bridgeOption{a, b, wormholes, counts, addA, addB, linkID(a, b) + "/" + kind})
							}
						}
					}
				}

				slices.SortFunc(options, func(a, b bridgeOption) int {
					if d := a.addA + a.addB - b.addA - b.addB; d != 0 {
						return d
					}

					d := b.a.RadiusX + b.b.RadiusX - a.a.RadiusX - a.b.RadiusX

					if d < 0 {
						return -1
					}

					if d > 0 {
						return 1
					}

					return strings.Compare(a.id, b.id)
				})

				if len(options) == 0 {
					panic("the sector catalog needs more connection capacity")
				}

				bridge := options[0]
				target := &result.Links

				if bridge.wormholes {
					target = &result.WormholeLinks
				}

				for i, entry := range []*Sector{bridge.a, bridge.b} {
					if [2]int{bridge.addA, bridge.addB}[i] == 0 {
						continue
					}

					sites := &entry.GateSites

					if bridge.wormholes {
						sites = &entry.WormholeSites
					}

					*sites = append(*sites, connectionSite(*entry, len(*sites), bridge.wormholes, spec))
				}

				connect(bridge.a, bridge.b, target, bridge.counts)
				connected = append(connected, bridge.b)
				index = slices.Index(pending, bridge.b)
				pending = slices.Delete(pending, index, index+1)
				continue
			}

			entry := pending[index]
			pending = slices.Delete(pending, index, index+1)
			link := findConnection(entry)
			connect(link.other, entry, link.target, link.counts)
			connected = append(connected, entry)
		}

		fillSites(&result.Links, degrees, false, spec.SpareGateSites)
		fillSites(&result.WormholeLinks, wormholeDegrees, true, spec.SpareWormholeSites)
		start = end
	}

	for _, sector := range connected[:max(1, min(len(connected), spec.EnabledCount))] {
		result.Enabled = append(result.Enabled, sector.ID)
	}

	return result
}

func SectorDensity(sector *Sector, position Vec.Vector, kind int, spec specs.SectorGeneration) float64 {
	f := spec.Density[kind]
	sin, cos := utilities.SinCos(sector.Rotation)
	x := (position.X*cos + position.Y*sin) / (sector.RadiusX * f.Scale)
	y := (-position.X*sin + position.Y*cos) / (sector.RadiusY * f.Scale)
	distance := x*x + y*y
	edge := 0.0

	if f.Cutoff != 0 {
		edge = math.Exp2(-(f.Cutoff * f.Cutoff))
	}

	density := math.Max(0, (math.Exp2(-distance)-edge)/(1-edge))
	return roundInteger((f.Floor+(f.Peak-f.Floor)*density)*1e9) / 1e9
}
