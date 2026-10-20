package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

const pursuitEnvelope = 44.

type pursuitPath struct {
	origin, direction Vec.Vector
	speed, duration   float64
}

func (p pursuitPath) at(now float64) (Vec.Vector, Vec.Vector) {
	return Vec.AddScaled(p.origin, p.direction, p.speed*now), Vec.Scale(p.direction, p.speed)
}

/*
Validate the target with the normal ship's physical segment polygons, independently
of the NPC planner and its clearance. Two extra units cover between-frame sweeps.
*/
func pursuitPathClear(ship *objects.Ship, rocks []*simulation.Asteroid, path pursuitPath) bool {
	return pursuitRouteClear(ship, rocks, path.at, path.duration)
}

func pursuitRouteClear(ship *objects.Ship, rocks []*simulation.Asteroid, at func(float64) (Vec.Vector, Vec.Vector), duration float64) bool {
	probe := objects.CreatePlayerShip(ship.World, objects.Properties{DefinitionID: "courser"})
	probe.Position = Vec.Vector{}
	probe.Face(0)
	hull := probe.Hitbox()

	for now := 0.; now <= duration; now += 1. / 60 {
		position, velocity := at(now)
		heading := math.Atan2(velocity.Y, velocity.X)

		for _, rock := range rocks {
			if Vec.Distance(position, rock.Position) > rock.Radius+ship.Radius+70 {
				continue
			}

			for _, a := range hull {
				if a.Physics != nil && !*a.Physics {
					continue
				}

				margin := 2.
				shape := query.ShapeData{Position: Vec.Add(position, simulation.RotatePoint(a.GetPosition(), heading)), Rotation: a.GetRotation() + heading, Radius: a.GetRadius(), Outline: a.ShapeOutline, CollisionMargin: &margin}

				for _, b := range rock.Hitbox() {
					if b.Physics != nil && !*b.Physics {
						continue
					}

					other := query.ShapeData{Position: b.GetPosition(), Rotation: b.GetRotation() + rock.Spin*now, Radius: b.GetRadius(), Outline: b.ShapeOutline, CollisionMargin: b.CollisionMargin}

					if _, touch := query.ContactBetween(shape, other, ship.Catalog.Simulation.LinearSlop); touch {
						return false
					}
				}
			}
		}
	}

	return true
}

/*
Find a straight crossing between neighboring generated asteroid circles, then
validate it against the physical hulls. The 44-unit envelope fits an ordinary ship
without depending on recesses between asteroid spikes.
*/
func generatedPursuitPath(t *testing.T, ship *objects.Ship, rocks []*simulation.Asteroid, speed float64) pursuitPath {
	t.Helper()

	for i, a := range rocks {
		for _, b := range rocks[i+1:] {
			gap := Vec.Distance(a.Position, b.Position) - a.Radius - b.Radius

			if gap < 2*pursuitEnvelope || gap > 115 {
				continue
			}

			across := Vec.Normalize(Vec.Subtract(b.Position, a.Position))
			direction := Vec.Create(-across.Y, across.X)
			center := Vec.AddScaled(a.Position, across, a.Radius+gap/2)

			for _, offset := range []float64{0, -20, 20, -40, 40} {
				path := pursuitPath{origin: Vec.AddScaled(Vec.AddScaled(center, across, offset), direction, -1100), direction: direction, speed: speed, duration: 35}
				from := Vec.AddScaled(path.origin, direction, -220)
				to, _ := path.at(path.duration)
				edge := Vec.Subtract(to, from)
				circleClear := true

				for _, rock := range rocks {
					along := max(0, min(1, Vec.Dot(Vec.Subtract(rock.Position, from), edge)/Vec.LengthSquared(edge)))

					if Vec.DistanceSquared(Vec.AddScaled(from, edge, along), rock.Position) < (rock.Radius+pursuitEnvelope)*(rock.Radius+pursuitEnvelope) {
						circleClear = false
						break
					}
				}

				if !circleClear {
					continue
				}

				start := path
				start.origin = Vec.AddScaled(path.origin, path.direction, -220)
				start.duration = 0

				if pursuitPathClear(ship, rocks, start) && pursuitPathClear(ship, rocks, path) {
					return path
				}
			}
		}
	}

	t.Fatal("no physically usable straight gap in generated field")
	return pursuitPath{}
}

type pursuitResult struct {
	mean, p95, excess, escaped, closest float64
	contacts, shipContacts, stationary  int
}

func runPursuit(ship *objects.Ship, path pursuitPath) pursuitResult {
	ship.Position = Vec.AddScaled(path.origin, path.direction, -220)
	ship.Face(math.Atan2(path.direction.Y, path.direction.X))
	ship.Velocity = Vec.Scale(path.direction, path.speed)
	pilot := Pilot{}
	thrust, turn := 0., 0.
	contacts := ship.World.Collisions.(*courseCollisions)
	lags := []float64{}
	result := pursuitResult{closest: math.Inf(1)}
	clearTicks, still := 30, 0
	checkpoint := ship.Position

	for tick := range int(path.duration * 30) {
		now := float64(tick) / 30
		target, velocity := path.at(now)

		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: target, Velocity: velocity, PassDistance: 70, TargetID: 2})
		}

		ship.Fly(thrust, turn)
		contacts.touching = false
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
		lag := Vec.Distance(ship.Position, target)
		lags = append(lags, lag)
		result.mean += lag
		result.excess += max(0, lag-300) / 30
		result.closest = min(result.closest, lag)

		if lag > 700 {
			result.escaped += 1. / 30
		}

		if contacts.touching {
			if clearTicks >= 15 {
				result.contacts++
			}

			clearTicks = 0
		} else {
			clearTicks++
		}

		if tick%30 == 0 {
			if Vec.Distance(checkpoint, ship.Position) < 15 {
				still++
				result.stationary = max(result.stationary, still)
			} else {
				still = 0
			}

			checkpoint = ship.Position
		}
	}

	slices.Sort(lags)
	result.mean /= float64(len(lags))
	result.p95 = lags[int(float64(len(lags))*.95)]
	return result
}

func TestPursuitKeepsUpThroughUsableGeneratedGaps(t *testing.T) {
	for _, scenario := range []struct {
		seed     uint32
		resource int
		speed    float64
	}{{501, 2, 170}, {5, 4, 180}, {7, 1, 190}} {
		t.Run(fmt.Sprintf("seed%d/resource%d/speed%g", scenario.seed, scenario.resource, scenario.speed), func(t *testing.T) {
			ship, rocks, _ := generatedCourse(t, courseField{seed: scenario.seed, resource: scenario.resource})
			path := generatedPursuitPath(t, ship, rocks, scenario.speed)
			result := runPursuit(ship, path)
			t.Logf("path=%+v mean=%.1f p95=%.1f excess=%.1f escaped=%.2fs contacts=%d stationary=%ds closest=%.1f", path, result.mean, result.p95, result.excess, result.escaped, result.contacts, result.stationary, result.closest)

			if result.mean > 220 || result.p95 > 400 || result.excess > 300 || result.escaped > 2 || result.contacts > 3 || result.stationary > 5 || ship.Dead || ship.Stranded() {
				t.Fatal("pursuit lost the fast target through a physically usable gap")
			}
		})
	}
}
