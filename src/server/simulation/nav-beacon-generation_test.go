package simulation

import (
	"math"
	"reflect"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/random"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestNavBeaconGeneration(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	sector := GenerateSector(123, "Patroclus", catalog)
	g := NewRegionGenerator(catalog, sector)
	from, to := Vec.Create(-200000, -200000), Vec.Create(200000, 200000)
	gates := []SectorConnectionSite{{ID: "gate-a", Position: Vec.Create(1000, 2000), Arrival: Vec.Create(-100, 2000)}, {ID: "gate-b", Position: Vec.Create(-3000, 4000), Arrival: Vec.Create(-4100, 4000)}}
	all := g.GenerateNavBeacons(123, from, to, gates)

	if !reflect.DeepEqual(all, g.GenerateNavBeacons(123, from, to, gates)) {
		t.Fatal("beacons must be deterministic")
	}

	scattered := g.GenerateNavBeacons(123, from, to, nil)

	if len(scattered) == 0 {
		t.Fatal("expected scattered beacons")
	}

	if len(all) != len(scattered)+len(gates) {
		t.Fatalf("got %d beacons, expected %d gate beacons plus %d scattered", len(all), len(gates), len(scattered))
	}

	// Force the sampled direction toward the arrival point and exercise the
	// clearance fallback without depending on a particular generated sector.
	blocked := SectorConnectionSite{ID: "arrival-test", Position: Vec.Create(5000, 5000)}
	r := random.CreateRandom(float64(namedSeed(sector.Seed, "nav-beacon:"+blocked.ID)))
	angle := r.Next() * 2 * math.Pi
	blocked.Arrival = Vec.Add(blocked.Position, Vec.Create(math.Cos(angle)*1100, math.Sin(angle)*1100))
	clear := g.GenerateNavBeacons(123, Vec.Create(3900, 3900), Vec.Create(6100, 6100), []SectorConnectionSite{blocked})

	if len(clear) == 0 || Vec.Distance(clear[0].Position, blocked.Arrival) < 250 {
		t.Fatal("gate beacon must avoid the reserved arrival point")
	}

	clockwise, counterclockwise := false, false
	rotations := map[float64]bool{}

	for _, beacon := range all {
		if beacon.Rotation < 0 || beacon.Rotation >= 2*math.Pi {
			t.Fatalf("invalid rotation %v", beacon.Rotation)
		}

		if math.Abs(beacon.Spin) < 0.0025 || math.Abs(beacon.Spin) > 0.0075 {
			t.Fatalf("invalid spin %v", beacon.Spin)
		}

		clockwise = clockwise || beacon.Spin > 0
		counterclockwise = counterclockwise || beacon.Spin < 0
		rotations[beacon.Rotation] = true
	}

	if !clockwise || !counterclockwise || len(rotations) < 2 {
		t.Fatal("expected varied orientations and spin directions")
	}

	for i, gate := range gates {
		distance := Vec.Distance(gate.Position, all[i].Position)

		if Vec.Distance(gate.Arrival, all[i].Position) < 250 {
			t.Fatal("beacon obstructs the arrival point")
		}

		if distance < 880 || distance > 1000 {
			t.Fatalf("gate beacon distance %v", distance)
		}

		if i > 0 && math.Abs(distance-Vec.Distance(gates[0].Position, all[0].Position)) < 0.0001 {
			t.Fatal("gate distances should vary")
		}

		p := all[i].Position
		inSmallArea := g.GenerateNavBeacons(123, Vec.Add(p, Vec.Create(-1, -1)), Vec.Add(p, Vec.Create(1, 1)), gates)
		found := false

		for _, b := range inSmallArea {
			if b == all[i] {
				found = true
			}
		}

		if !found {
			t.Fatal("beacon must be independent of query bounds")
		}
	}

}
