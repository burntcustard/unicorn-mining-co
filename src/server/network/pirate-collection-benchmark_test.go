package network

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type pirateCollectionCase struct {
	name            string
	seed            uint64
	spread, maximum float64
}

var pirateCollectionCases = []pirateCollectionCase{
	{"main", 25, 180, 23},
	{"compact", 67, 120, 35},
	{"wide", 123, 300, 42},
	{"heldout", 501, 180, 40},
}

type pirateCollectionResult struct {
	Seed        uint64       `json:"seed"`
	Spread      float64      `json:"spread"`
	Collected   int          `json:"collected"`
	Seconds     float64      `json:"seconds"`
	PickupTimes []float64    `json:"pickupTimes"`
	PickupOrder []int        `json:"pickupOrder"`
	Distance    float64      `json:"distance"`
	SlowSeconds float64      `json:"slowSeconds"`
	LongestGap  float64      `json:"longestGap"`
	Heading     float64      `json:"heading"`
	Items       [][3]float64 `json:"items"`
}

/*
Run the real pirate state machine, normal session ticks, movement, and cargo
contacts in a generated clear area. Eight loose gold items have seeded positions
and rotations, and the Courser starts at the center with a seeded heading. Its
unused ammunition is removed to leave all eight cargo spaces available. The
observer stays 1,200 units away with its hatch closed. Fuel and encounter duration
are extended so this measures collection rather than a failed robbery timeout.
*/
func runPirateCollection(t testing.TB, scenario pirateCollectionCase) pirateCollectionResult {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	catalog.PirateSpec.EncounterDuration = 1800
	s := NewGameSession(25, catalog)
	socket := &benchmarkSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	p.pirateAfter = math.MaxUint64
	p.ship.CargoContents = nil
	p.ship.DockedTo, p.ship.Launching = nil, 0
	ranges := protocol.Ranges(catalog.Simulation.ServerRegionRanges)
	ranges.Asteroid = 2500
	center, found := Vec.Vector{}, false

	for x := 5000.; x <= 45000 && !found; x += 5000 {
		for y := 5000.; y <= 45000 && !found; y += 5000 {
			candidate := Vec.Create(x, y)
			view := s.regions.View(candidate, &ranges)

			clear := !slices.ContainsFunc(view.Asteroids, func(rock protocol.AsteroidDescription) bool {
				return Vec.Distance(candidate, rock.Position) < 1800+max(rock.Radius, rock.RadiusEven)*(1+catalog.RegionGeneration.AsteroidVariance)
			})

			if clear && Vec.Distance(candidate, s.nearestStation(candidate).Position) > 2500 {
				center, found = candidate, true
			}
		}
	}

	if !found {
		t.Fatal("missing generated clear collection area")
	}

	p.ship.Position = Vec.Add(center, Vec.Create(0, 1200))
	npc := s.spawnPirate(p, s.nearestStation(center))
	npc.state, npc.cargoAccepted, npc.thinkAfter = pirateCollecting, true, 0
	npc.ship.Position = center
	npc.ship.DockedTo, npc.ship.Launching = nil, 0
	npc.ship.CargoContents = nil
	random := rand.New(rand.NewPCG(scenario.seed, 8))
	result := pirateCollectionResult{Seed: scenario.seed, Spread: scenario.spread, Heading: random.Float64() * 2 * math.Pi}
	npc.ship.Face(result.Heading)
	items := make([]*objects.Item, 0, 8)

	for range 8 {
		position := Vec.Vector{}

		for {
			position = Vec.Create((random.Float64()*2-1)*scenario.spread, (random.Float64()*2-1)*scenario.spread)

			if Vec.Length(position) >= 65 && !slices.ContainsFunc(items, func(item *objects.Item) bool {
				return Vec.Distance(Vec.Add(center, position), item.Position) < 35
			}) {
				break
			}
		}

		id := simulation.EntityID(s.World)
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id, Position: Vec.Add(center, position)}, catalog)
		item.Rotation, item.Mined = random.Float64()*2*math.Pi, true
		simulation.AddEntity(s.World, item)
		npc.loot = append(npc.loot, item)
		items = append(items, item)
		result.Items = append(result.Items, [3]float64{position.X, position.Y, item.Rotation})
	}

	s.regions.Sync(s.World, s.positions())
	collected := make([]bool, 8)
	step, lastPickup := catalog.Simulation.SimulationStep, 0.

	for tick := 0; tick < int(600/step) && result.Collected < len(items); tick++ {
		before := npc.ship.Position
		npc.ship.Fuel = npc.ship.FuelCapacity
		s.Receive(protocol.Control{Type: "snapshotAck", Sequence: socket.sequence}, socket)
		s.Tick(1)
		result.Seconds = float64(tick+1) * step
		result.Distance += Vec.Distance(before, npc.ship.Position)

		nearItem := slices.ContainsFunc(items, func(item *objects.Item) bool {
			return s.World.Entities.Has(item.ID) && Vec.Distance(npc.ship.Position, item.Position) < 80
		})

		if nearItem && Vec.Length(npc.ship.Velocity) < 10 {
			result.SlowSeconds += step
		}

		for index, item := range items {
			if !collected[index] && slices.Contains(npc.ship.CargoContents, simulation.Entity(item)) {
				collected[index] = true
				result.Collected++
				result.PickupTimes = append(result.PickupTimes, result.Seconds)
				result.PickupOrder = append(result.PickupOrder, index)
				result.LongestGap = max(result.LongestGap, result.Seconds-lastPickup)
				lastPickup = result.Seconds
			}
		}

		if npc.ship.Dead || npc.defeated || !s.World.Entities.Has(npc.ship.ID) {
			t.Fatalf("collection fixture lost its Courser at %.2fs", result.Seconds)
		}
	}

	result.LongestGap = max(result.LongestGap, result.Seconds-lastPickup)
	return result
}

func TestPirateCollectionSeeded(t *testing.T) {
	testPirateCollections(t, pirateCollectionCases)
}

/*
These additional seeds exposed moving cargo trapped against the cannons during
development. Keep their actual pickups and completion budgets in normal tests.
*/
func TestPirateCollectionValidation(t *testing.T) {
	testPirateCollections(t, []pirateCollectionCase{
		{"seed8", 8, 180, 48},
		{"seed42", 42, 180, 40},
		{"seed73", 73, 180, 35},
		{"seed211", 211, 240, 36},
		{"seed809", 809, 240, 35},
		{"seed977", 977, 240, 65},
		{"seed2026", 2026, 300, 65},
		{"seed20261021", 20261021, 120, 72},
	})
}

func testPirateCollections(t *testing.T, scenarios []pirateCollectionCase) {
	t.Helper()

	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			result := runPirateCollection(t, scenario)
			data, err := json.Marshal(result)

			if err != nil {
				t.Fatal(err)
			}

			t.Logf("collection=%s", data)

			if result.Collected != 8 {
				t.Fatalf("collected %d/8 items in %.2fs", result.Collected, result.Seconds)
			}

			if result.Seconds > scenario.maximum {
				t.Fatalf("eight pickups took %.2fs, exceeding %.2fs", result.Seconds, scenario.maximum)
			}
		})
	}
}

func BenchmarkPirateCollection(b *testing.B) {
	for _, scenario := range pirateCollectionCases {
		b.Run(scenario.name, func(b *testing.B) {
			seconds, distance, slow, gap := 0., 0., 0., 0.

			for b.Loop() {
				result := runPirateCollection(b, scenario)

				if result.Collected != 8 {
					b.Fatalf("collected %d/8 items in %.2fs", result.Collected, result.Seconds)
				}

				seconds += result.Seconds
				distance += result.Distance
				slow += result.SlowSeconds
				gap += result.LongestGap
			}

			b.ReportMetric(seconds/float64(b.N), "sim-s/8items")
			b.ReportMetric(distance/float64(b.N), "distance/8items")
			b.ReportMetric(slow/float64(b.N), "slow-s/8items")
			b.ReportMetric(gap/float64(b.N), "max-gap-s")
		})
	}
}
