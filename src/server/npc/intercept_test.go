package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

func TestInterceptionLeadStopsBeforeTargetCrossesAnAsteroid(t *testing.T) {
	ship := flightShip(t)
	target := Movement{Position: Vec.Create(400, 0), Velocity: Vec.Create(180, 0), TargetID: 2}
	rock := obstacle{position: Vec.Create(600, 0), radius: 80}
	predicted := interceptPosition(ship, target, []obstacle{rock})

	if predicted.X <= target.Position.X || predicted.X > rock.position.X-rock.radius-ship.Radius || predicted.Y != 0 {
		t.Fatalf("lead left the target's reachable corridor: target=%v lead=%v", target.Position, predicted)
	}

	for i := 0; i <= 100; i++ {
		point := Vec.AddScaled(target.Position, Vec.Subtract(predicted, target.Position), float64(i)/100)

		if Vec.Distance(point, rock.position) < rock.radius+ship.Radius {
			t.Fatalf("lead crossed asteroid at %v", point)
		}
	}
}

func TestInterceptionLeadUpdatesImmediatelyWhenTargetTurns(t *testing.T) {
	ship := flightShip(t)
	target := Movement{Position: Vec.Create(500, 0), Velocity: Vec.Create(0, 170), TargetID: 2}
	first := interceptPosition(ship, target, nil)
	target.Position = Vec.Create(500, 20)
	target.Velocity = Vec.Create(0, -170)
	second := interceptPosition(ship, target, nil)

	if first.Y <= 0 || second.Y >= target.Position.Y || second.X != target.Position.X {
		t.Fatalf("interception retained a stale turn: first=%v second=%v actual=%v", first, second, target.Position)
	}
}

func TestInterceptionReturnsToActualPlayerSpacingAfterBraking(t *testing.T) {
	ship := arrivalShip(t, "courser")
	target := objects.CreatePlayerShip(ship.World, objects.Properties{DefinitionID: "courser", ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(1000, 0), Velocity: Vec.Create(150, 0), PlayerID: new(int64(2))}})
	simulation.AddEntity(ship.World, target)
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(750, 100), Radius: new(90.0)}, PointCount: 8})
	simulation.AddEntity(ship.World, rock.LockGeometry())
	pilot := Pilot{}
	thrust, turn := 0., 0.
	closest := math.Inf(1)
	spacing := ship.Catalog.PirateSpec.FollowDistance
	health := ship.HullHealthTotal() + target.HullHealthTotal()

	for tick := range 30 * 35 {
		if tick%steeringIntervalTicks(ship) == 0 {
			destination := Movement{Position: target.Position, Velocity: target.Velocity, TargetID: target.ID, FollowDistance: spacing}

			if tick < 30*6 {
				destination.PassDistance = 70
			}

			thrust, turn = pilot.Steer(ship, destination)
		}

		if tick < 30*6 {
			target.Fly(targetFlight(target, 150, 0))
		} else {
			target.Fly(0, 0)
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
		closest = min(closest, Vec.Distance(ship.Position, target.Position))
	}

	distance := Vec.Distance(ship.Position, target.Position)

	if closest < spacing-30 || math.Abs(distance-spacing) > 20 || Vec.Length(ship.Velocity) > 3 || ship.HullHealthTotal()+target.HullHealthTotal() != health {
		t.Fatalf("interception overran the actual braking player: closest=%g final=%g speed=%g", closest, distance, Vec.Length(ship.Velocity))
	}
}
