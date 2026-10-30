package testhost

import (
	"math"
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type CollectionCase struct {
	Name            string
	Seed            uint64
	Spread, Maximum float64
}

var CollectionCases = []CollectionCase{
	{"main", 25, 180, 23},
	{"compact", 67, 120, 35},
	{"wide", 123, 300, 42},
	{"heldout", 501, 180, 40},
}

type CollectionResult struct {
	Ship        string       `json:"ship"`
	Seed        uint64       `json:"seed"`
	Spread      float64      `json:"spread"`
	Expected    int          `json:"expected"`
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
Exercise the shared pilot with real hatch animation, contacts, and cargo transfer.
Both hulls receive the same seeded heading and item sequence: the Courser takes
all eight items, while the Finch takes the first six to fit its ordinary capacity.
Target selection retains the nearest item until pickup; there is no role state
machine, generated terrain, or encounter timeout in this collection fixture.
*/
func RunCollection(t testing.TB, definition string, scenario CollectionCase) CollectionResult {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	world.ItemTypes = objects.ItemTypes(catalog)
	world.Collisions = gameplay.NewGameCollisions(catalog)
	// Preserve the original clear-area origin as well as its seeded offsets.
	center := Vec.Create(5000, 5000)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: definition, PlayerID: new(int64(1)), Position: center})
	simulation.AddEntity(world, ship)
	simulation.AddPlayer(world, simulation.Player{ID: *ship.PlayerID, ShipID: ship.ID})
	random := rand.New(rand.NewPCG(scenario.Seed, 8))
	result := CollectionResult{Ship: definition, Seed: scenario.Seed, Spread: scenario.Spread, Expected: min(8, ship.CargoSpace), Heading: random.Float64() * 2 * math.Pi}

	if result.Expected == 0 {
		t.Fatal("collection fixture requires usable cargo capacity")
	}

	ship.Face(result.Heading)
	items := make([]*objects.Item, 0, result.Expected)

	for range result.Expected {
		position := Vec.Vector{}

		for {
			position = Vec.Create((random.Float64()*2-1)*scenario.Spread, (random.Float64()*2-1)*scenario.Spread)

			if Vec.Length(position) >= 65 && !slices.ContainsFunc(items, func(item *objects.Item) bool { return Vec.Distance(Vec.Add(center, position), item.Position) < 35 }) {
				break
			}
		}

		item := objects.NewItem("gold", simulation.ObjectProperties{World: world, ID: new(simulation.EntityID(world)), Position: Vec.Add(center, position)}, catalog)
		item.Rotation, item.Mined = random.Float64()*2*math.Pi, true
		simulation.AddEntity(world, item)
		items = append(items, item)
		result.Items = append(result.Items, [3]float64{position.X, position.Y, item.Rotation})
	}

	pilot := &npc.Pilot{}
	var target *objects.Item
	input := protocol.Input{CargoHatch: true}
	inputs := map[int64]protocol.InputFrame{}
	collected := make([]bool, len(items))
	step, lastPickup := catalog.Simulation.SimulationStep, 0.
	health := ship.HullHealthTotal()
	decisionTicks := max(1, int(math.Ceil((catalog.NPCMovement.DecisionInterval-1e-9)/step)))

	for tick := 0; tick < int(600/step) && result.Collected < len(items); tick++ {
		if tick%decisionTicks == 0 {
			if target == nil || !world.Entities.Has(target.ID) {
				target = nil
				distance := math.Inf(1)

				for _, item := range items {
					if world.Entities.Has(item.ID) {
						if d := Vec.DistanceSquared(ship.Position, item.Position); d < distance {
							target, distance = item, d
						}
					}
				}
			}

			if target != nil {
				input.CargoHatch = npc.CollectionHatch(ship, target.Position)
				input.Thrust, input.Turn = pilot.Steer(ship, npc.Movement{Position: target.Position, Velocity: target.Velocity, IgnoreID: target.ID, Collect: true})
			}
		}

		before := ship.Position
		ship.Fuel = ship.FuelCapacity
		inputs[*ship.PlayerID] = protocol.InputFrame{Input: input}
		simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Inputs: inputs})
		result.Seconds = float64(tick+1) * step
		result.Distance += Vec.Distance(before, ship.Position)

		nearItem := slices.ContainsFunc(items, func(item *objects.Item) bool {
			return world.Entities.Has(item.ID) && Vec.Distance(ship.Position, item.Position) < 80
		})

		if nearItem && Vec.Length(ship.Velocity) < 10 {
			result.SlowSeconds += step
		}

		for index, item := range items {
			if !collected[index] && slices.Contains(ship.CargoContents, simulation.Entity(item)) {
				collected[index] = true
				result.Collected++
				result.PickupTimes = append(result.PickupTimes, result.Seconds)
				result.PickupOrder = append(result.PickupOrder, index)
				result.LongestGap = max(result.LongestGap, result.Seconds-lastPickup)
				lastPickup = result.Seconds
			}

			if item.Dead && !collected[index] {
				t.Fatalf("%s destroyed target %d at %.2fs", definition, index, result.Seconds)
			}
		}

		if ship.Dead || ship.HullHealthTotal() != health || !world.Entities.Has(ship.ID) {
			t.Fatalf("collection damaged or lost its %s at %.2fs", definition, result.Seconds)
		}
	}

	result.LongestGap = max(result.LongestGap, result.Seconds-lastPickup)
	return result
}
