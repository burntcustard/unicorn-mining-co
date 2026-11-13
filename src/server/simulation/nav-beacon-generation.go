package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/random"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type NavBeaconDescription struct {
	ID       uint32
	Position Vec.Vector
	Rotation float64
	Spin     float64
}

// GenerateNavBeacons uses its own random streams so adding beacons does not
// change existing procedural features. Gate sites must be active connections.
func (g *RegionGenerator) GenerateNavBeacons(worldSeed uint32, from, to Vec.Vector, gates []SectorConnectionSite) []NavBeaconDescription {
	if g.sector == nil {
		return nil
	}

	result := []NavBeaconDescription{}

	add := func(id uint32, p Vec.Vector) {
		if p.X >= from.X && p.X < to.X && p.Y >= from.Y && p.Y < to.Y {
			r := random.CreateRandom(float64(mix(id ^ 0x6e617662)))
			rotation := r.Next() * 2 * math.Pi
			spin := 0.0025 + r.Next()*0.005

			if r.Next() < 0.5 {
				spin = -spin
			}

			result = append(result, NavBeaconDescription{ID: id, Position: p, Rotation: rotation, Spin: spin})
		}
	}

	for _, gate := range gates {
		seed := namedSeed(g.sector.Seed, "nav-beacon:"+gate.ID)
		r := random.CreateRandom(float64(seed))
		angle := r.Next() * 2 * math.Pi
		distance := 880 + r.Next()*120
		position := Vec.Create(gate.Position.X+math.Cos(angle)*distance, gate.Position.Y+math.Sin(angle)*distance)

		// Keep the reserved arrival point clear, even when the sampled angle
		// points directly toward it.
		if Vec.Distance(position, gate.Arrival) < 250 {
			position = Vec.Create(gate.Position.X-math.Cos(angle)*distance, gate.Position.Y-math.Sin(angle)*distance)
		}

		add(descriptionID(seed, 17, 1), position)
	}

	settings := g.spec.Features[stationFeature]

	for x := math.Floor(from.X / settings.Size); x <= math.Floor(to.X/settings.Size); x++ {
		for y := math.Floor(from.Y / settings.Size); y <= math.Floor(to.Y/settings.Size); y++ {
			cell := Vec.Create(x, y)
			seed := descriptionID(RegionSeed(g.seed(worldSeed), cell), 17, 2)
			r := random.CreateRandom(float64(seed))
			chance := r.Next()
			position := randomPosition(r, cell, settings.Size)

			if chance >= settings.Chance*0.5*SectorDensity(g.sector, position, stationFeature, g.sectorSpec) {
				continue
			}

			blocked := false

			for _, site := range append(append([]SectorConnectionSite{}, g.sector.GateSites...), g.sector.WormholeSites...) {
				if Vec.Distance(position, site.Position) < g.sectorSpec.GateArrivalDistance+g.sectorSpec.GateClearance+48 {
					blocked = true
					break
				}
			}

			if blocked {
				continue
			}

			for _, station := range g.GenerateStations(worldSeed, Vec.Add(position, Vec.Create(-500, -500)), Vec.Add(position, Vec.Create(500, 500))) {
				if Vec.Distance(position, station.Position) < station.Radius+100 {
					blocked = true
					break
				}
			}

			if !blocked {
				add(descriptionID(seed, 17, 3), position)
			}
		}
	}

	return result
}

func (r *RegionManager) NavBeacons(from, to Vec.Vector, gates []SectorConnectionSite) []NavBeaconDescription {
	result := r.generator.GenerateNavBeacons(r.worldSeed, from, to, gates)
	filtered := result[:0]

	for _, beacon := range result {
		if !r.removed[beacon.ID] {
			filtered = append(filtered, beacon)
		}
	}

	return filtered
}
