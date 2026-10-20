package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

/*
A circular reference has continuous velocity and force heading. Its centripetal
acceleration and drag remain within an ordinary Courser's engine limits, so a ship
can sustain the maneuver without the abrupt force changes of a waypoint track.
*/
func orbitPursuitTrack(radius, speed float64) pursuitTrack {
	const samples = 720
	track := pursuitTrack{}

	for index := 0; index <= samples; index++ {
		angle := float64(index) * 2 * math.Pi / samples
		sine, cosine := math.Sincos(angle)
		track.points = append(track.points, Vec.Create(radius*cosine, radius*sine))
		track.velocities = append(track.velocities, Vec.Create(-speed*sine, speed*cosine))
		track.times = append(track.times, angle*radius/speed)
	}

	return track
}

func TestPursuitMaintainsFastOrbitsAroundCircularAsteroidsForFiveMinutes(t *testing.T) {
	for _, scenario := range []struct{ radius, speed float64 }{{280, 170}, {320, 180}, {360, 190}} {
		t.Run(fmt.Sprintf("radius%g/speed%g", scenario.radius, scenario.speed), func(t *testing.T) {
			ship := flightShip(t)
			world := ship.World
			world.ItemTypes = objects.ItemTypes(world.Specification)
			world.Collisions = &courseCollisions{GameCollisions: gameplay.NewGameCollisions(world.Specification), shipID: ship.ID}
			rock := simulation.CreateAsteroid(world, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Radius: new(180.)}, PointCount: 32})
			simulation.AddEntity(world, rock.LockGeometry())
			track := orbitPursuitTrack(scenario.radius, scenario.speed)
			force := math.Hypot(scenario.speed*scenario.speed/scenario.radius, scenario.speed*ship.Drag)
			maximum := ship.Rules.Flight.ThrustScale * ship.ForwardThrust() / ship.Mass

			if force > maximum || scenario.speed/scenario.radius > ship.TurnRate*ship.RotationalThrust()/ship.Rules.Flight.SpinDivisor || !pursuitRouteClear(ship, []*simulation.Asteroid{rock}, track.at, track.times[len(track.times)-1]) {
				t.Fatal("orbit exceeds physical movement limits")
			}

			reference := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(2))})
			simulation.AddEntity(world, reference)
			result := runCurvingPursuit(ship, track, reference)
			t.Logf("force=%.1f/%.1f mean=%.1f p95=%.1f excess=%.1f escaped=%.2fs asteroids=%d ships=%d stationary=%ds closest=%.1f", force, maximum, result.mean, result.p95, result.excess, result.escaped, result.contacts, result.shipContacts, result.stationary, result.closest)

			if result.mean > 250 || result.p95 > 450 || result.excess > 5000 || result.escaped > 2 || result.contacts > 15 || result.shipContacts > 15 || result.stationary > 5 || ship.Dead || ship.Stranded() || reference.Dead {
				t.Fatal("pilot lost the physically sustainable orbit")
			}
		})
	}
}
