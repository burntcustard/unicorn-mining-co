// Port of src/shared/simulation/region-generation.ts.
package simulation

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/internal/protocol"
	"github.com/burntcustard/unicorn-mining-co/internal/random"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"github.com/burntcustard/unicorn-mining-co/internal/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
	"slices"
	"strconv"
	"strings"
)

const (
	fieldFeature = iota
	stationFeature
	wreckFeature
)

type feature struct {
	ID            uint32
	Position      Vec.Vector
	Radius        float64
	Resource      int
	Spin          float64
	CargoContents []int
	Paint         int
	Type          string
}
type regionCandidates struct {
	Asteroids []*protocol.AsteroidDescription
	Region    Vec.Vector
	Stations  []protocol.StationDescription
	Wrecks    []protocol.WreckDescription
}
type candidateKey struct {
	WorldSeed uint32
	Region    Vec.Vector
}

// The TS module's bounded candidate cache is owned by its simulation in Go.
// Entries stay immutable and generated region descriptions are detached copies.
type RegionGenerator struct {
	spec             specification.RegionGeneration
	regionSize       float64
	candidateRegions map[candidateKey]*regionCandidates
	candidateOrder   []candidateKey
}

func NewRegionGenerator(spec specification.Catalog) *RegionGenerator {
	return &RegionGenerator{spec: spec.RegionGeneration, regionSize: spec.Simulation.RegionSize, candidateRegions: make(map[candidateKey]*regionCandidates)}
}
func mix(value uint32) uint32 {
	value = (value ^ (value >> 16)) * 0x7feb352d
	value = (value ^ (value >> 15)) * 0x846ca68b
	return value ^ (value >> 16)
}
func RegionSeed(worldSeed uint32, region Vec.Vector) uint32 {
	return mix(worldSeed ^ mix(uint32(int64(region.X))) ^ mix(uint32(int64(region.Y+0x9e3779b9))))
}
func descriptionID(seed, kind, index uint32) uint32 {
	id := mix(seed ^ kind*0x9e3779b9 ^ index)
	if id == 0 {
		return 1
	}
	return id
}
func randomPosition(r *random.Random, cell Vec.Vector, size float64) Vec.Vector {
	return Vec.Create(roundInteger((cell.X+r.Next())*size), roundInteger((cell.Y+r.Next())*size))
}
func roundInteger(value float64) float64 {
	lower := math.Floor(value)
	if value-lower >= 0.5 {
		lower++
	}
	if lower == 0 && math.Signbit(value) {
		return math.Copysign(0, -1)
	}
	return lower
}
func randomSpin(r *random.Random) float64 {
	direction := 1.0
	if r.Next() < 0.5 {
		direction = -1
	}
	return utilities.Round((direction * (1 + r.Next())) / 40)
}
func randomResource(r *random.Random) int { return 3 - int(math.Floor(math.Pow(r.Next(), 3)*4)) }
func (g *RegionGenerator) featureCandidate(worldSeed uint32, cell Vec.Vector, kind int) *feature {
	settings := g.spec.Features[kind]
	seed := RegionSeed(worldSeed, cell)
	stream := uint32(0)
	if kind == stationFeature {
		stream = g.spec.StationStream
	}
	r := random.CreateRandom(float64(descriptionID(seed, settings.Kind, stream)))
	if r.Next() >= settings.Chance {
		return nil
	}
	position := randomPosition(r, cell, settings.Size)
	id := descriptionID(seed, settings.Kind, 1)
	if kind == fieldFeature {
		roll := r.Next()
		resource := 4
		if roll < g.spec.RichFieldAmethystChance {
			resource = 1
		} else if roll < g.spec.RichFieldGoldChance {
			resource = 2
		}
		radius := (g.spec.FieldRadius + r.Next()*g.spec.FieldRadiusRange)
		if resource == 1 {
			radius /= 2
		}
		return &feature{ID: id, Position: position, Radius: radius, Resource: resource}
	}
	if kind == stationFeature {
		return &feature{ID: id, Position: position, Radius: g.spec.StationRadius, Spin: randomSpin(r), Type: "station"}
	}
	contents := make([]int, 2+int(math.Floor(r.Next()*3)))
	for i := range contents {
		contents[i] = int(math.Floor(r.Next() * 4))
	}
	paint := 1
	if r.Next() >= 2.0/3 {
		paint = []int{0, 2, 3, 4}[int(math.Floor(r.Next()*4))]
	}
	return &feature{CargoContents: contents, ID: id, Paint: paint, Position: position, Radius: g.spec.WreckRadius, Spin: randomSpin(r), Type: "wreck"}
}
func spacingRadius(f *feature, kind int) float64 {
	if kind == fieldFeature {
		return f.Radius * 0.7
	}
	return f.Radius
}
func (g *RegionGenerator) acceptedFeature(worldSeed uint32, cell Vec.Vector, kind int) *feature {
	candidate := g.featureCandidate(worldSeed, cell, kind)
	if candidate == nil {
		return nil
	}
	for y := -1; y <= 1; y++ {
		for x := -1; x <= 1; x++ {
			if x == 0 && y == 0 {
				continue
			}
			other := g.featureCandidate(worldSeed, Vec.Create(cell.X+float64(x), cell.Y+float64(y)), kind)
			if other != nil && other.ID < candidate.ID && Vec.Distance(other.Position, candidate.Position) < spacingRadius(other, kind)+spacingRadius(candidate, kind)+g.spec.Features[kind].Clearance {
				return nil
			}
		}
	}
	return candidate
}
func (g *RegionGenerator) featuresWithin(worldSeed uint32, from, to Vec.Vector, kind int) []*feature {
	size := g.spec.Features[kind].Size
	features := []*feature{}
	for x := math.Floor(from.X / size); x <= math.Floor(to.X/size); x++ {
		for y := math.Floor(from.Y / size); y <= math.Floor(to.Y/size); y++ {
			f := g.acceptedFeature(worldSeed, Vec.Create(x, y), kind)
			if f != nil && f.Position.X >= from.X && f.Position.X < to.X && f.Position.Y >= from.Y && f.Position.Y < to.Y {
				features = append(features, f)
			}
		}
	}
	return features
}
func (g *RegionGenerator) GenerateStations(worldSeed uint32, from, to Vec.Vector) []protocol.StationDescription {
	stations := []protocol.StationDescription{}
	for _, f := range g.featuresWithin(worldSeed, from, to, stationFeature) {
		stations = append(stations, protocol.StationDescription{ID: f.ID, Position: f.Position, Radius: f.Radius, Spin: f.Spin, Type: f.Type})
	}
	return stations
}
func (g *RegionGenerator) GenerateFields(worldSeed uint32, from, to Vec.Vector) []protocol.FieldDescription {
	fields := []protocol.FieldDescription{}
	for _, f := range g.featuresWithin(worldSeed, from, to, fieldFeature) {
		fields = append(fields, protocol.FieldDescription{ID: f.ID, Position: f.Position, Radius: f.Radius, Resource: f.Resource})
	}
	return fields
}
func FieldMessage(position Vec.Vector, resource int) string {
	label := "GOLD ORE"
	if resource == 1 {
		label = "AMETHYST CLUSTER"
	}
	return fmt.Sprintf("%s %s/%s", label, positionNumber(position.X), positionNumber(position.Y))
}
func (g *RegionGenerator) nearestRichField(worldSeed uint32, position Vec.Vector) protocol.FieldDescription {
	distance := g.spec.NearestFieldInitialRange
	for {
		fields := g.GenerateFields(worldSeed, Vec.Add(position, Vec.Create(-distance, -distance)), Vec.Add(position, Vec.Create(distance, distance)))
		var nearest *protocol.FieldDescription
		for i := range fields {
			field := &fields[i]
			if field.Resource < 3 && (nearest == nil || Vec.Distance(field.Position, position) < Vec.Distance(nearest.Position, position)) {
				nearest = field
			}
		}
		if nearest != nil && Vec.Distance(nearest.Position, position) <= distance {
			return *nearest
		}
		distance *= 2
	}
}
func (g *RegionGenerator) makeAsteroid(seed uint32, index int, r *random.Random, region Vec.Vector, resource int) *protocol.AsteroidDescription {
	spikes, gold := resource == 1, resource == 2
	var radius float64
	if spikes {
		radius = g.spec.AsteroidAmethystRadius + r.Next()*g.spec.AsteroidAmethystRange
	} else if gold {
		radius = g.spec.AsteroidGoldRadius + r.Next()*g.spec.AsteroidGoldRange
	} else {
		radius = g.spec.AsteroidMixedRadius + r.Next()*g.spec.AsteroidMixedRange
	}
	radius = utilities.Round(g.spec.AsteroidBaseRadius + radius)
	capacity := roundInteger(math.Pow(radius/50, 2))
	chance := capacity / (capacity + 1)
	if resource > 3 {
		chance = g.spec.MixedItemChance
	}
	itemCount := 0
	if r.Next() < chance {
		if spikes {
			itemCount = 1
		} else {
			itemCount = 1 + int(math.Floor(r.Next()*capacity))
		}
	}
	contents := make([]int, itemCount)
	for i := range contents {
		if resource > 3 {
			contents[i] = randomResource(r)
		} else {
			contents[i] = resource
		}
	}
	if resource > 3 {
		contents = contents[:min(len(contents), g.spec.MixedItemLimit)]
	}
	position := randomPosition(r, region, g.regionSize)
	a := &protocol.AsteroidDescription{Contents: contents, ID: descriptionID(seed, 1, uint32(index)), Position: position, Radius: radius, Resource: resource, Rotation: utilities.Round(r.Next() * math.Pi * 2), Spin: randomSpin(r), Type: "asteroid"}
	if spikes {
		a.PointCount = 6
		a.RadiusEven = utilities.Round(radius / 4)
	}
	return a
}
func (g *RegionGenerator) generateCandidates(worldSeed uint32, region Vec.Vector) *regionCandidates {
	key := candidateKey{worldSeed, region}
	if cached := g.candidateRegions[key]; cached != nil {
		return cached
	}
	from := Vec.Scale(region, g.regionSize)
	to := Vec.Add(from, Vec.Create(g.regionSize, g.regionSize))
	stations := g.GenerateStations(worldSeed, from, to)
	wrecks := []protocol.WreckDescription{}
	for _, f := range g.featuresWithin(worldSeed, from, to, wreckFeature) {
		wrecks = append(wrecks, protocol.WreckDescription{ID: f.ID, Position: f.Position, Radius: f.Radius, Spin: f.Spin, Type: f.Type, CargoContents: f.CargoContents, Paint: f.Paint})
	}
	margin := g.spec.FieldSearchMargin
	fields := g.GenerateFields(worldSeed, Vec.Add(from, Vec.Create(-margin, -margin)), Vec.Add(to, Vec.Create(margin, margin)))
	asteroids := []*protocol.AsteroidDescription{}
	for _, field := range fields {
		seed := mix(RegionSeed(worldSeed, region) ^ field.ID)
		r := random.CreateRandom(float64(seed))
		count := g.spec.AsteroidCounts["mixed"]
		if field.Resource == 1 {
			count = g.spec.AsteroidCounts["amethyst"]
		} else if field.Resource == 2 {
			count = g.spec.AsteroidCounts["gold"]
		}
		for index := 0; index < count; index++ {
			a := g.makeAsteroid(seed, index, r, region, field.Resource)
			if Vec.Distance(a.Position, field.Position) < field.Radius-a.Radius {
				asteroids = append(asteroids, a)
			}
		}
	}
	candidates := &regionCandidates{Asteroids: asteroids, Region: region, Stations: stations, Wrecks: wrecks}
	g.candidateRegions[key] = candidates
	g.candidateOrder = append(g.candidateOrder, key)
	if len(g.candidateRegions) > 1024 {
		delete(g.candidateRegions, g.candidateOrder[0])
		g.candidateOrder = g.candidateOrder[1:]
	}
	return candidates
}
func (g *RegionGenerator) GenerateRegion(worldSeed uint32, region Vec.Vector) protocol.RegionDescription {
	current := g.generateCandidates(worldSeed, region)
	nearby := []*regionCandidates{}
	for y := -1; y <= 1; y++ {
		for x := -1; x <= 1; x++ {
			if x != 0 || y != 0 {
				nearby = append(nearby, g.generateCandidates(worldSeed, Vec.Create(region.X+float64(x), region.Y+float64(y))))
			} else {
				nearby = append(nearby, current)
			}
		}
	}
	type obstacle struct {
		position Vec.Vector
		radius   float64
	}
	obstacles := []obstacle{}
	for _, region := range nearby {
		for _, s := range region.Stations {
			obstacles = append(obstacles, obstacle{s.Position, s.Radius})
		}
		for _, w := range region.Wrecks {
			obstacles = append(obstacles, obstacle{w.Position, w.Radius})
		}
	}
	overlaps := func(a *protocol.AsteroidDescription, position Vec.Vector, radius float64) bool {
		return Vec.Distance(a.Position, position) < a.Radius+radius+g.spec.AsteroidSpacing
	}
	candidates := []*protocol.AsteroidDescription{}
	candidateSet := map[*protocol.AsteroidDescription]bool{}
	maxRadius := 0.0
	for _, region := range nearby {
		for _, a := range region.Asteroids {
			blocked := false
			for _, other := range obstacles {
				if overlaps(a, other.position, other.radius) {
					blocked = true
					break
				}
			}
			if !blocked {
				candidates = append(candidates, a)
				candidateSet[a] = true
				maxRadius = math.Max(maxRadius, a.Radius)
			}
		}
	}
	cellSize := 2*maxRadius + g.spec.AsteroidSpacing
	cell := func(a *protocol.AsteroidDescription) Vec.Vector {
		return Vec.Create(math.Floor(a.Position.X/cellSize), math.Floor(a.Position.Y/cellSize))
	}
	buckets := map[Vec.Vector][]*protocol.AsteroidDescription{}
	for _, a := range candidates {
		key := cell(a)
		buckets[key] = append(buckets[key], a)
	}
	result := protocol.RegionDescription{Region: current.Region, Stations: slices.Clone(current.Stations), Wrecks: make([]protocol.WreckDescription, 0, len(current.Wrecks)), Asteroids: []protocol.AsteroidDescription{}}
	for _, wreck := range current.Wrecks {
		clueField := g.nearestRichField(worldSeed, wreck.Position)
		wreck.CargoContents = make([]int, len(wreck.CargoContents))
		for i := range wreck.CargoContents {
			wreck.CargoContents[i] = clueField.Resource
		}
		wreck.ClueField = clueField
		result.Wrecks = append(result.Wrecks, wreck)
	}
	for _, a := range current.Asteroids {
		if !candidateSet[a] {
			continue
		}
		at := cell(a)
		crowded := false
		for dy := -1; dy <= 1 && !crowded; dy++ {
			for dx := -1; dx <= 1 && !crowded; dx++ {
				for _, other := range buckets[Vec.Create(at.X+float64(dx), at.Y+float64(dy))] {
					if other.ID < a.ID && overlaps(a, other.Position, other.Radius) {
						crowded = true
						break
					}
				}
			}
		}
		if !crowded {
			copy := *a
			copy.Contents = slices.Clone(a.Contents)
			result.Asteroids = append(result.Asteroids, copy)
		}
	}
	return result
}

// Region coordinates are integer-valued JavaScript Numbers. Preserve their
// implicit string conversion, including the exponential threshold and -0.
func positionNumber(value float64) string {
	if value == 0 {
		return "0"
	}
	if math.Abs(value) < 1e21 {
		return strconv.FormatFloat(value, 'f', -1, 64)
	}
	return strings.ReplaceAll(strings.ReplaceAll(strconv.FormatFloat(value, 'e', -1, 64), "e+0", "e+"), "e-0", "e-")
}
