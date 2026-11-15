package objects

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestShipMassChangesHandlingAndSurvivesRestore(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{})

	near := func(got, want float64) bool { return math.Abs(got-want) < 1e-7 }

	stockMass := ship.Mass
	stockAcceleration := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / stockMass

	stockTurn, stockDrag, stockMaxSpeed := ship.MaximumTurnRate(), ship.Drag, ship.MaxSpeed()
	plant := modules.Create("powerPlant2H", simulation.ObjectProperties{World: world}, catalog)
	ship.Fit(plant, ship.Mounts()[3])
	wantMass := stockMass - catalog.ModuleSpecs["powerPlant2V"].Mass + catalog.ModuleSpecs["powerPlant2H"].Mass

	if !near(ship.Mass, wantMass) {
		t.Fatalf("swapped mass = %g, want %g", ship.Mass, wantMass)
	}

	ratio := stockMass / wantMass

	if !near(ship.Rules.Flight.ThrustScale*ship.ForwardThrust()/ship.Mass, stockAcceleration*ratio) || !near(ship.MaximumTurnRate(), stockTurn*ratio) || !near(ship.Drag, stockDrag*ratio) || !near(ship.MaxSpeed(), stockMaxSpeed) {
		t.Fatal("mass did not proportionally affect acceleration, turning, and drag while preserving speed cap")
	}

	ship.Fly(0, 0)
	ship.Velocity = Vec.Create(100, 0)
	ship.Update(1.0 / 60)
	wantCoast := 100 * math.Exp(-ship.Drag/60)

	if !near(ship.Velocity.X, wantCoast) {
		t.Fatalf("coast speed = %g, want %g", ship.Velocity.X, wantCoast)
	}

	restored, err := RestoreShip(CaptureShip(ship), world, 1)

	if err != nil {
		t.Fatal(err)
	}

	if !near(restored.Mass, wantMass) || !near(restored.Drag, ship.Drag) {
		t.Fatalf("restored mass/drag = %g/%g", restored.Mass, restored.Drag)
	}

	light := modules.Create("powerPlant2L", simulation.ObjectProperties{World: world}, catalog)
	ship.Fit(light, ship.Mounts()[3])
	lightMass := stockMass - catalog.ModuleSpecs["powerPlant2V"].Mass + catalog.ModuleSpecs["powerPlant2L"].Mass

	if !near(ship.Mass, lightMass) || ship.Mass >= stockMass || ship.MaximumTurnRate() <= stockTurn || ship.Drag <= stockDrag {
		t.Fatalf("light plant did not increase handling: mass %g, turn %g, drag %g", ship.Mass, ship.MaximumTurnRate(), ship.Drag)
	}
}

func TestShipActualCruisingSpeedUnaffectedByMass(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	stock := CreatePlayerShip(world, Properties{})
	heavy := CreatePlayerShip(world, Properties{})
	heavy.Fit(modules.Create("powerPlant2H", simulation.ObjectProperties{World: world}, catalog), heavy.Mounts()[3])

	for _, ship := range []*Ship{stock, heavy} {
		// Isolate handling from differences in power plant output and fuel use.
		for _, module := range ship.Modules() {
			module.ModuleBase().Spec.Power = 0
			module.ModuleBase().Spec.PowerActivated = 0
		}

		ship.Fly(1, 0)

		for range 18000 {
			ship.Fuel = ship.FuelCapacity
			ship.Update(1.0 / 60)
		}
	}

	if stock.Velocity.X < 200 || heavy.Velocity.X < 200 || math.Abs(stock.Velocity.X-heavy.Velocity.X) > .1 {
		t.Fatalf("stock/heavy sustained speeds = %g/%g", stock.Velocity.X, heavy.Velocity.X)
	}
}
