package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

func arrivalShip(t *testing.T, definition string) *objects.Ship {
	t.Helper()
	ship := flightShip(t)
	world := ship.World

	if definition != ship.DefinitionID {
		world.Entities.Delete(ship.ID)
		ship = objects.CreatePlayerShip(world, objects.Properties{DefinitionID: definition, PlayerID: new(int64(1))})
		simulation.AddEntity(world, ship)
	}

	world.ItemTypes = objects.ItemTypes(world.Specification)
	world.Collisions = gameplay.NewGameCollisions(world.Specification)
	return ship
}

/*
Measure passive stopping through real movement substeps and the velocity cutoff.
Arrival tests use this independent behavior instead of repeating controller math.
*/
func measuredCoastDistance(t *testing.T, definition string, drag, speed float64) float64 {
	t.Helper()
	ship := arrivalShip(t, definition)
	ship.Drag, ship.Velocity = drag, Vec.Create(speed, 0)

	for range 30 * 40 {
		ship.Fly(0, 0)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if Vec.LengthSquared(ship.Velocity) == 0 {
			return ship.Position.X
		}
	}

	t.Fatal("coasting fixture never stopped")
	return 0
}

func TestArrivalCoastDependsOnActualMomentumAndDrag(t *testing.T) {
	for _, test := range []struct {
		ship        string
		drag, speed float64
	}{
		{"courser", .35, 120},
		{"courser", .9, 180},
		{"arrow", 5.0 / 9, 300},
	} {
		t.Run(fmt.Sprintf("%s/drag%g/speed%g", test.ship, test.drag, test.speed), func(t *testing.T) {
			coast := measuredCoastDistance(t, test.ship, test.drag, test.speed)
			ship := arrivalShip(t, test.ship)
			ship.Drag, ship.Velocity = test.drag, Vec.Create(test.speed, 0)
			spacing := ship.Catalog.PirateSpec.FollowDistance
			near := Movement{Position: Vec.Create(spacing+coast+2, 0), FollowDistance: spacing}
			thrust, _ := new(Pilot).Steer(ship, near)

			if thrust > .001 {
				t.Fatalf("ship kept powering inside its measured coasting approach: coast=%g thrust=%g", coast, thrust)
			}

			far := Movement{Position: Vec.Create(spacing+coast*2+test.speed, 0), FollowDistance: spacing}
			thrust, _ = new(Pilot).Steer(ship, far)

			if thrust < .999 {
				t.Fatalf("ship limited thrust far beyond its coasting approach: coast=%g thrust=%g", coast, thrust)
			}
		})
	}
}

func TestArrivalUsesFullEngineThenCoastsToPreferredSpacing(t *testing.T) {
	for _, definition := range []string{"courser", "arrow"} {
		t.Run(definition, func(t *testing.T) {
			ship := arrivalShip(t, definition)
			pilot := Pilot{}
			target := Vec.Create(2400, 0)
			spacing := ship.Catalog.PirateSpec.FollowDistance
			coast := measuredCoastDistance(t, definition, ship.Drag, ship.MaxSpeed())
			thrust, turn := 0.0, 0.0
			coasted, reachedSpeed := false, false
			closest, finalDistance := math.Inf(1), math.Inf(1)

			for tick := range 30 * 45 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target, FollowDistance: spacing})
					remaining := Vec.Distance(ship.Position, target) - spacing

					if remaining > coast+2*ship.MaxSpeed()*ship.Catalog.NPCMovement.DecisionInterval && thrust < .999 {
						t.Fatalf("far approach reduced thrust: distance=%g thrust=%g", remaining, thrust)
					}
				}

				coasted = coasted || thrust == 0 && Vec.Length(ship.Velocity) > ship.MaxSpeed()*.2
				reachedSpeed = reachedSpeed || Vec.Length(ship.Velocity) >= ship.MaxSpeed()*.98
				ship.Fly(thrust, turn)
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				finalDistance = Vec.Distance(ship.Position, target)
				closest = min(closest, finalDistance)

				if tick > 30*30 && (math.Abs(finalDistance-spacing) > 15 || Vec.Length(ship.Velocity) > 3) {
					t.Fatalf("arrival did not settle: distance=%g speed=%g", finalDistance, Vec.Length(ship.Velocity))
				}
			}

			if !coasted || !reachedSpeed || closest < spacing-20 || math.Abs(finalDistance-spacing) > 15 {
				t.Fatalf("arrival failed full-speed approach and coast: coasted=%v full speed=%v closest=%g final=%g", coasted, reachedSpeed, closest, finalDistance)
			}
		})
	}
}

func TestArrivalMatchesMovingTargetWithoutRepeatedFullThrottleBursts(t *testing.T) {
	for _, speed := range []float64{90, 170} {
		t.Run(fmt.Sprint(speed), func(t *testing.T) {
			ship := arrivalShip(t, "courser")
			world := ship.World
			target := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(700, 0), Velocity: Vec.Create(speed, 0), PlayerID: new(int64(2))}})
			simulation.AddEntity(world, target)
			pilot := Pilot{}
			spacing := ship.Catalog.PirateSpec.FollowDistance
			thrust, turn := 0.0, 0.0
			fullBursts, samples, totalError, totalVelocityError := 0, 0, 0.0, 0.0
			wasFull := false

			for tick := range 30 * 70 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target.Position, Velocity: target.Velocity, FollowDistance: spacing, TargetID: target.ID})

					if tick >= 30*30 && thrust > .99 && !wasFull {
						fullBursts++
					}

					wasFull = thrust > .99
				}

				target.Fly(targetFlight(target, speed, 0))
				ship.Fly(thrust, turn)
				simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})

				if tick >= 30*30 {
					samples++
					totalError += math.Abs(Vec.Distance(ship.Position, target.Position) - spacing)
					totalVelocityError += Vec.Length(Vec.Subtract(ship.Velocity, target.Velocity))
				}
			}

			if totalError/float64(samples) > 20 || totalVelocityError/float64(samples) > 5 || fullBursts > 8 {
				t.Fatalf("moving arrival kept oscillating: mean spacing error=%g mean velocity error=%g full bursts=%d", totalError/float64(samples), totalVelocityError/float64(samples), fullBursts)
			}
		})
	}
}

func TestCargoArrivalUsesFullThrustFarAwayAndCollectsThroughItsHatch(t *testing.T) {
	ship := arrivalShip(t, "courser")
	ship.SetModuleActive("cargoHatch", true)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(1500, 0)}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	pilot := Pilot{}
	thrust, turn := 0.0, 0.0
	farFull := false

	for tick := range 30 * 40 {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true})

			if Vec.Distance(ship.Position, item.Position) > 1000 {
				if thrust < .999 {
					t.Fatalf("distant cargo approach limited throttle: thrust=%g", thrust)
				}

				farFull = true
			}
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
			if !farFull {
				t.Fatal("cargo fixture did not exercise distant full-thrust approach")
			}

			return
		}
	}

	t.Fatal("coasting arrival never collected cargo through its open hatch")
}

func TestCargoArrivalCollectsBroadsideGold(t *testing.T) {
	ship := arrivalShip(t, "courser")
	ship.SetModuleActive("cargoHatch", true)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(100, 0), Rotation: math.Pi / 2}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	pilot := Pilot{}
	thrust, turn := 0.0, 0.0

	for tick := range 30 * 15 {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true})
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
			return
		}
	}

	t.Fatal("ship kept pushing blocked gold instead of collecting it from another angle")
}

func TestFollowArrivalKeepsSpaceAfterAnAsteroidDetour(t *testing.T) {
	for _, x := range []float64{750, 900} {
		for _, side := range []float64{-1, 1} {
			t.Run(fmt.Sprintf("rock%g/side%g", x, side), func(t *testing.T) {
				ship := arrivalShip(t, "courser")
				target := objects.CreatePlayerShip(ship.World, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(1000, 0), PlayerID: new(int64(2))}})
				simulation.AddEntity(ship.World, target)
				rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(x, side*100), Radius: new(90.0)}, PointCount: 8})
				simulation.AddEntity(ship.World, rock.LockGeometry())
				pilot := Pilot{}
				thrust, turn := 0.0, 0.0
				closest := math.Inf(1)
				spacing := ship.Catalog.PirateSpec.FollowDistance
				health := ship.HullHealthTotal() + target.HullHealthTotal()

				for tick := range 30 * 35 {
					if tick%steeringIntervalTicks(ship) == 0 {
						thrust, turn = pilot.Steer(ship, Movement{Position: target.Position, Velocity: target.Velocity, FollowDistance: spacing, TargetID: target.ID})
					}

					ship.Fly(thrust, turn)
					simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
					closest = min(closest, Vec.Distance(ship.Position, target.Position))
				}

				distance := Vec.Distance(ship.Position, target.Position)

				if closest < spacing-30 || math.Abs(distance-spacing) > 20 || Vec.Length(ship.Velocity) > 3 || ship.HullHealthTotal()+target.HullHealthTotal() != health {
					t.Fatalf("detour discarded the player's arrival space: closest=%g final=%g speed=%g", closest, distance, Vec.Length(ship.Velocity))
				}
			})
		}
	}
}

func TestArrivalUsesOpposingEngineToCancelExcessMomentum(t *testing.T) {
	for _, heading := range []float64{0, math.Pi / 2, math.Pi} {
		t.Run(fmt.Sprintf("heading%g", heading), func(t *testing.T) {
			ship := arrivalShip(t, "courser")
			ship.Velocity = Vec.Create(180, 0)
			ship.Face(heading)
			target := objects.CreatePlayerShip(ship.World, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(450, 0), PlayerID: new(int64(2))}})
			simulation.AddEntity(ship.World, target)
			pilot := Pilot{}
			thrust, turn := 0.0, 0.0
			closest := math.Inf(1)
			braked := false
			spacing := ship.Catalog.PirateSpec.FollowDistance

			for tick := range 30 * 35 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target.Position, FollowDistance: spacing, TargetID: target.ID})
				}

				forward := Vec.Create(math.Cos(ship.Rotation), math.Sin(ship.Rotation))
				braked = braked || thrust > .05 && Vec.Dot(forward, ship.Velocity) < -30
				ship.Fly(thrust, turn)
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				closest = min(closest, Vec.Distance(ship.Position, target.Position))
			}

			distance := Vec.Distance(ship.Position, target.Position)

			if !braked || closest < spacing-30 || math.Abs(distance-spacing) > 20 || Vec.Length(ship.Velocity) > 3 {
				t.Fatalf("arrival did not cancel momentum with the opposing engine: braked=%v closest=%g final=%g speed=%g", braked, closest, distance, Vec.Length(ship.Velocity))
			}

		})
	}
}
