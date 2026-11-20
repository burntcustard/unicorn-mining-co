package objects

import (
	"encoding/json"
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server-go/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server-go/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server-go/vector"
)

func thrustBoosterFixture(t *testing.T, rampDuration ...float64) (*Ship, *simulation.World, []*simulation.Mount) {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	spec := catalog.ModuleSpecs["thrustBooster"]
	booster := *spec.Booster
	booster.Multiplier = 1.5
	booster.Duration = 2
	booster.Cooldown = 2
	booster.Charges = 3
	booster.Recharge = 6
	booster.RampDuration = 0

	if len(rampDuration) > 0 {
		booster.RampDuration = rampDuration[0]
	}

	spec.Booster = &booster
	catalog.ModuleSpecs["thrustBooster"] = spec
	shipSpec := specs.Ship{Name: "Booster fixture", Price: 100, FuelCapacity: 100, CargoSpace: 8, Drag: 100, HullMass: 1000, AngularThrust: 1000, Radius: 60, TurnRate: 3}

	for index, id := range []string{"thrusterSingleSm", "thrustBooster", "thrustBooster", "powerPlant1V"} {
		fits := []string{id}

		if index == 0 {
			fits = nil

			for candidate, module := range catalog.ModuleSpecs {
				if module.ForwardThrust != 0 {
					fits = append(fits, candidate)
				}
			}

			slices.Sort(fits)
		}

		x := float64(index * 12)

		shipSpec.HullSegments = append(shipSpec.HullSegments, specs.HullSegment{
			Core: index == 0, Health: new(100.0),
			Points: []specs.Point{{x - 6, -6}, {x + 6, -6}, {x + 6, 6}, {x - 6, 6}},
			Mounts: [][]specs.MountPoint{{{X: x, Fits: fits}}},
		})

		shipSpec.InitialLoadout = append(shipSpec.InitialLoadout, specs.InitialModule{Mount: index, Module: id})
	}

	catalog.ShipSpecs["boosterFixture"] = shipSpec

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "boosterFixture"})
	mounts := ship.Mounts()[1:3]

	return ship, world, mounts
}

func BoosterTestWorld(t *testing.T) *simulation.World {
	t.Helper()
	_, world, _ := thrustBoosterFixture(t)
	return world
}

func nearThrustBooster(t *testing.T, actual, expected float64) {
	t.Helper()

	if math.IsNaN(actual) || math.Abs(actual-expected) > 1e-8 {
		t.Fatalf("%g != %g", actual, expected)
	}
}

func pressThrustBooster(ship *Ship) {
	ship.TriggerThrustBoost(false)
	ship.TriggerThrustBoost(true)
}

func thrustBoosterMultiplier(mounts []*simulation.Mount) float64 {
	factor := 1.0

	for _, mount := range mounts {
		factor *= mount.Module.ModuleBase().Spec.Booster.Multiplier
	}

	return factor
}

func TestThrustBoosterRampsThrustAndSpeedTogether(t *testing.T) {
	for _, count := range []int{1, 2} {
		ship, world, mounts := thrustBoosterFixture(t, .2)
		speed, forward, rotation := ship.MaxSpeed(), ship.ForwardThrust(), ship.RotationalThrust()

		if count == 1 {
			mounts[0].Module.ModuleBase().ChargeCooldown = 18
		}

		pressThrustBooster(ship)
		nearThrustBooster(t, ship.thrustBoostFactor(), 1)
		nearThrustBooster(t, ship.MaxSpeed(), speed)

		for step := 1; step <= 4; step++ {
			ship.UpdateModules(.05)
			factor := 1.0

			for _, mount := range mounts[2-count:] {
				factor *= 1 + (mount.Module.ModuleBase().Spec.Booster.Multiplier-1)*float64(step)/4
			}

			nearThrustBooster(t, ship.thrustBoostFactor(), factor)
			nearThrustBooster(t, ship.thrustBoostSpeedFactor(), factor)
			nearThrustBooster(t, ship.ForwardThrust(), forward*factor)
			nearThrustBooster(t, ship.RotationalThrust(), rotation*factor)
			nearThrustBooster(t, ship.MaxSpeed(), speed*factor)

			if step == 2 {
				restored, err := RestoreShip(CaptureShip(ship), world, 1)

				if err != nil {
					t.Fatal(err)
				}

				nearThrustBooster(t, restored.thrustBoostFactor(), factor)
				nearThrustBooster(t, restored.MaxSpeed(), speed*factor)
			}
		}
	}
}

func TestThrustBoosterRecoveryTapersSpeedWhileDrawingChargingPower(t *testing.T) {
	ship, _, mounts := thrustBoosterFixture(t)
	normalCap, forward, rotational := ship.MaxSpeed(), ship.ForwardThrust(), ship.RotationalThrust()
	multiplier := thrustBoosterMultiplier(mounts)
	idleUsage := ship.PowerUsage()
	additionalChargingUsage := 0.0
	halfway := 1.0

	for _, mount := range mounts {
		spec := mount.Module.ModuleBase().Spec
		additionalChargingUsage += spec.PowerCharging - spec.Power
		halfway *= 1 + (spec.Booster.Multiplier-1)*.5
	}

	pressThrustBooster(ship)
	nearThrustBooster(t, ship.PowerUsage(), idleUsage+additionalChargingUsage)
	ship.UpdateModules(2)
	nearThrustBooster(t, ship.thrustBoostFactor(), 1)
	nearThrustBooster(t, ship.ForwardThrust(), forward)
	nearThrustBooster(t, ship.RotationalThrust(), rotational)
	nearThrustBooster(t, ship.thrustBoostSpeedFactor(), multiplier)
	nearThrustBooster(t, ship.MaxSpeed(), normalCap*multiplier)
	nearThrustBooster(t, ship.PowerUsage(), idleUsage+additionalChargingUsage)
	ship.UpdateModules(1)
	nearThrustBooster(t, ship.thrustBoostSpeedFactor(), halfway)
	nearThrustBooster(t, ship.MaxSpeed(), normalCap*halfway)
	ship.UpdateModules(1)
	nearThrustBooster(t, ship.thrustBoostSpeedFactor(), 1)
	nearThrustBooster(t, ship.MaxSpeed(), normalCap)

	for _, mount := range mounts {
		ship.Fit(nil, mount)
	}

	nearThrustBooster(t, ship.MaxSpeed(), normalCap)
}

func TestThrustBoosterRecoveryPreservesMomentumAndNormalCruisingSpeed(t *testing.T) {
	ship, _, mounts := thrustBoosterFixture(t)
	normal, _, _ := thrustBoosterFixture(t)
	normalCap := ship.MaxSpeed()
	pressThrustBooster(ship)
	ship.UpdateModules(2)
	ship.Velocity = Vec.Create(normalCap*thrustBoosterMultiplier(mounts), 0)
	normal.Velocity = Vec.Create(normalCap, 0)
	ship.Fly(1, 0)
	normal.Fly(1, 0)

	for frame := 1; frame <= 126; frame++ {
		for _, current := range []*Ship{ship, normal} {
			current.Fuel = current.FuelCapacity
			current.Update(1.0 / 60)
		}

		if frame == 30 && math.Hypot(ship.Velocity.X, ship.Velocity.Y) <= normalCap*1.1 {
			t.Fatal("boost momentum did not survive the first half-second of recovery")
		}
	}

	nearThrustBooster(t, math.Hypot(ship.Velocity.X, ship.Velocity.Y), normalCap)
	nearThrustBooster(t, math.Hypot(normal.Velocity.X, normal.Velocity.Y), normalCap)
}

func TestEmptyThrustBoosterDoesNotContributeRecoverySpeed(t *testing.T) {
	ship, _, mounts := thrustBoosterFixture(t)
	normalCap := ship.MaxSpeed()
	mounts[0].Module.ModuleBase().ChargeCooldown = 18
	pressThrustBooster(ship)
	ship.UpdateModules(3)
	expected := 1 + (mounts[1].Module.ModuleBase().Spec.Booster.Multiplier-1)*.5
	nearThrustBooster(t, ship.thrustBoostFactor(), 1)
	nearThrustBooster(t, ship.thrustBoostSpeedFactor(), expected)
	nearThrustBooster(t, ship.MaxSpeed(), normalCap*expected)
}

func TestThrustBoostersMultiplyThrusterOutputWithoutIncreasingFuel(t *testing.T) {
	ship, _, mounts := thrustBoosterFixture(t)
	normal, _, _ := thrustBoosterFixture(t)
	multiplier := thrustBoosterMultiplier(mounts)
	forward, rotation, speed, turn := ship.ForwardThrust(), ship.RotationalThrust(), ship.MaxSpeed(), ship.MaximumTurnRate()
	nearThrustBooster(t, ship.thrustBoostFactor(), 1)
	pressThrustBooster(ship)
	nearThrustBooster(t, ship.thrustBoostFactor(), multiplier)
	nearThrustBooster(t, ship.ForwardThrust(), forward*multiplier)
	nearThrustBooster(t, ship.RotationalThrust(), rotation*multiplier)
	nearThrustBooster(t, ship.MaxSpeed(), speed*multiplier)
	nearThrustBooster(t, ship.MaximumTurnRate(), turn*multiplier)

	for _, mount := range mounts {
		nearThrustBooster(t, mount.Module.ModuleBase().FireCooldown, 4)
		nearThrustBooster(t, mount.Module.ModuleBase().ChargeCooldown, 6)
	}

	ship.Fly(1, .5)
	normal.Fly(1, .5)
	ship.Update(1.0 / 60)
	normal.Update(1.0 / 60)

	if math.Abs(math.Hypot(ship.Velocity.X, ship.Velocity.Y)-math.Hypot(normal.Velocity.X, normal.Velocity.Y)*multiplier) > 1e-5 || math.Abs(ship.Spin-normal.Spin*multiplier) > 1e-5 {
		t.Fatal("boost did not increase actual acceleration and turning by the stacked multiplier")
	}

	nearThrustBooster(t, ship.Fuel, normal.Fuel)
}

func TestThrustBoosterBurstLockoutAndHeldInput(t *testing.T) {
	ship, _, mounts := thrustBoosterFixture(t)
	multiplier := thrustBoosterMultiplier(mounts)
	booster := mounts[0].Module.ModuleBase()
	pressThrustBooster(ship)
	ship.TriggerThrustBoost(true)
	nearThrustBooster(t, booster.ChargeCooldown, 6)
	ship.UpdateModules(1)
	nearThrustBooster(t, booster.FireCooldown, 3)
	nearThrustBooster(t, booster.ChargeCooldown, 6)
	nearThrustBooster(t, ship.thrustBoostFactor(), multiplier)
	pressThrustBooster(ship)
	nearThrustBooster(t, booster.FireCooldown, 3)
	nearThrustBooster(t, booster.ChargeCooldown, 6)
	ship.UpdateModules(1)
	nearThrustBooster(t, ship.thrustBoostFactor(), 1)
	pressThrustBooster(ship)
	nearThrustBooster(t, booster.FireCooldown, 2)
	nearThrustBooster(t, booster.ChargeCooldown, 6)
	ship.UpdateModules(2)
	ship.TriggerThrustBoost(true)
	nearThrustBooster(t, booster.FireCooldown, 0)
	nearThrustBooster(t, booster.ChargeCooldown, 4)
	pressThrustBooster(ship)
	nearThrustBooster(t, booster.FireCooldown, 4)
	nearThrustBooster(t, booster.ChargeCooldown, 10)
}

func TestThrustBoosterEmptyChargesRecoverOneAtATime(t *testing.T) {
	ship, _, mounts := thrustBoosterFixture(t)
	multiplier := thrustBoosterMultiplier(mounts)

	for _, mount := range mounts {
		mount.Module.ModuleBase().ChargeCooldown = 18
	}

	booster := mounts[0].Module.ModuleBase()
	pressThrustBooster(ship)
	nearThrustBooster(t, ship.thrustBoostFactor(), 1)
	nearThrustBooster(t, booster.FireCooldown, 0)
	ship.UpdateModules(5)
	pressThrustBooster(ship)
	nearThrustBooster(t, booster.ChargeCooldown, 13)
	nearThrustBooster(t, booster.FireCooldown, 0)
	ship.UpdateModules(1)
	pressThrustBooster(ship)
	nearThrustBooster(t, ship.thrustBoostFactor(), multiplier)
	nearThrustBooster(t, booster.ChargeCooldown, 18)
	ship.UpdateModules(30)
	nearThrustBooster(t, booster.ChargeCooldown, 0)
	nearThrustBooster(t, booster.FireCooldown, 0)
}

func TestThrustBoosterStartsWithThreeCharges(t *testing.T) {
	ship, _, mounts := thrustBoosterFixture(t)
	multiplier := thrustBoosterMultiplier(mounts)

	// Slow recharge isolates the three-charge pool from the shorter lockout.
	for _, mount := range mounts {
		data := mount.Module.ModuleBase()
		booster := *data.Spec.Booster
		booster.Recharge = 60
		data.Spec.Booster = &booster
	}

	for range 3 {
		pressThrustBooster(ship)
		nearThrustBooster(t, ship.thrustBoostFactor(), multiplier)
		ship.UpdateModules(4)
	}

	booster := mounts[0].Module.ModuleBase()
	debt := booster.ChargeCooldown
	pressThrustBooster(ship)
	nearThrustBooster(t, ship.thrustBoostFactor(), 1)
	nearThrustBooster(t, booster.FireCooldown, 0)
	nearThrustBooster(t, booster.ChargeCooldown, debt)
}

func TestThrustBoosterExcludesEmptyAndDestroyedModules(t *testing.T) {
	ship, _, mounts := thrustBoosterFixture(t)
	first, second := mounts[0].Module.ModuleBase(), mounts[1].Module.ModuleBase()
	first.ChargeCooldown = 12.5
	pressThrustBooster(ship)
	nearThrustBooster(t, ship.thrustBoostFactor(), second.Spec.Booster.Multiplier)
	nearThrustBooster(t, first.ChargeCooldown, 12.5)
	nearThrustBooster(t, second.ChargeCooldown, 6)
	ship.UpdateModules(1)
	pressThrustBooster(ship)
	nearThrustBooster(t, ship.thrustBoostFactor(), second.Spec.Booster.Multiplier)
	nearThrustBooster(t, first.ChargeCooldown, 11.5)
	mounts[1].Health = 0
	nearThrustBooster(t, ship.thrustBoostFactor(), 1)
	ship.UpdateModules(3)
	first.ChargeCooldown = 0
	destroyedCharge := second.ChargeCooldown
	pressThrustBooster(ship)
	nearThrustBooster(t, ship.thrustBoostFactor(), first.Spec.Booster.Multiplier)
	nearThrustBooster(t, second.ChargeCooldown, destroyedCharge)
	mounts[0].Hull.Health = 0
	nearThrustBooster(t, ship.thrustBoostFactor(), 1)
}

func TestThrustBoosterRequiresAnOperationalFlyingShip(t *testing.T) {
	for _, fixture := range []struct {
		name  string
		block func(*Ship)
	}{
		{"dead", func(ship *Ship) { ship.Dead = true }},
		{"docked", func(ship *Ship) { ship.DockedTo = new(int64(12)) }},
		{"transit", func(ship *Ship) { ship.TransitTime = -1 }},
		{"launching", func(ship *Ship) { ship.Launching = 1 }},
		{"no fuel", func(ship *Ship) { ship.Fuel = 0 }},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			ship, _, mounts := thrustBoosterFixture(t)
			fixture.block(ship)
			pressThrustBooster(ship)
			nearThrustBooster(t, ship.thrustBoostFactor(), 1)
			nearThrustBooster(t, mounts[0].Module.ModuleBase().FireCooldown, 0)
			nearThrustBooster(t, mounts[0].Module.ModuleBase().ChargeCooldown, 0)
		})
	}
}

func TestThrustBoosterChargesAndBurstSurviveHydrationAndSaves(t *testing.T) {
	checkThrustBoosterHydration(t, .5)
}

func TestThrustBoosterRecoverySurvivesHydrationAndSaves(t *testing.T) {
	checkThrustBoosterHydration(t, 3)
}

func checkThrustBoosterHydration(t *testing.T, elapsed float64) {
	t.Helper()
	ship, world, mounts := thrustBoosterFixture(t)
	pressThrustBooster(ship)
	ship.UpdateModules(elapsed)
	booster := mounts[0].Module.ModuleBase()
	nearThrustBooster(t, booster.ChargeCooldown, 6-math.Max(0, elapsed-2))
	thrustFactor, speedFactor, maxSpeed := ship.thrustBoostFactor(), ship.thrustBoostSpeedFactor(), ship.MaxSpeed()
	hydrated, _, _ := thrustBoosterFixture(t)
	hydrated.SetModuleStates(ship.ModuleStates())
	saved, err := json.Marshal(CaptureShip(ship))

	if err != nil {
		t.Fatal(err)
	}

	var decoded SavedShip

	if err := json.Unmarshal(saved, &decoded); err != nil {
		t.Fatal(err)
	}

	restored, err := RestoreShip(decoded, world, 7)

	if err != nil {
		t.Fatal(err)
	}

	checkpoint, err := RestoreEntity(CaptureEntity(ship), world)

	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range []struct {
		name string
		ship *Ship
	}{{"hydrated", hydrated}, {"compact save", restored}, {"checkpoint", checkpoint.(*Ship)}} {
		t.Run(fixture.name, func(t *testing.T) {
			nearThrustBooster(t, fixture.ship.thrustBoostFactor(), thrustFactor)
			nearThrustBooster(t, fixture.ship.thrustBoostSpeedFactor(), speedFactor)
			nearThrustBooster(t, fixture.ship.MaxSpeed(), maxSpeed)
			count := 0

			for _, module := range fixture.ship.Modules() {
				data := module.ModuleBase()

				if data.Type != "thrustBooster" {
					continue
				}

				count++
				nearThrustBooster(t, data.FireCooldown, booster.FireCooldown)
				nearThrustBooster(t, data.ChargeCooldown, booster.ChargeCooldown)
			}

			if count != 2 {
				t.Fatal("hydration lost a thrust booster")
			}
		})
	}
}
