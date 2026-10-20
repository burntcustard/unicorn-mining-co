package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

type riskGap struct {
	path            pursuitPath
	center          Vec.Vector
	first, second   int64
	circleClearance float64
}

type riskPursuitResult struct {
	pursuitResult
	crossTrack, crossedAt float64
}

var riskScenarios = []struct {
	seed     uint32
	resource int
	speed    float64
}{{5, 2, 170}, {3, 4, 180}, {2, 1, 190}}

/*
Select a path solely from generated geometry. A 44-unit disk must fit through
the actual outline throughout the crossing, while even a smaller 36-unit disk
cannot follow the asteroid-radius approximation. No controller result selects
the path. The physical ship fixtures independently validate the final reference.
*/
func generatedRiskGap(t *testing.T, ship *objects.Ship, rocks []*simulation.Asteroid, field Vec.Vector, speed float64) riskGap {
	t.Helper()

	for i, a := range rocks {
		for _, b := range rocks[i+1:] {
			gap := Vec.Distance(a.Position, b.Position) - a.Radius - b.Radius

			if gap < -120 || gap > 100 {
				continue
			}

			across := Vec.Normalize(Vec.Subtract(b.Position, a.Position))
			direction := Vec.Create(-across.Y, across.X)
			midpoint := Vec.AddScaled(a.Position, across, a.Radius+gap/2)

			if Vec.Distance(midpoint, field) > 2200 {
				continue
			}

			for _, offset := range []float64{0, -15, 15, -30, 30, -45, 45} {
				center := Vec.AddScaled(midpoint, across, offset)
				circleClearance := min(Vec.Distance(center, a.Position)-a.Radius, Vec.Distance(center, b.Position)-b.Radius)

				if circleClearance >= 36 {
					continue
				}

				path := pursuitPath{origin: Vec.AddScaled(center, direction, -650), direction: direction, speed: speed, duration: 14}
				from := Vec.AddScaled(path.origin, direction, -220)
				to, _ := path.at(path.duration)
				length := Vec.Distance(from, to)
				steps := int(math.Ceil(length / 4))
				clear := true

				for step := 0; step <= steps && clear; step++ {
					position := Vec.AddScaled(from, Vec.Subtract(to, from), float64(step)/float64(steps))

					for _, rock := range rocks {
						if Vec.DistanceSquared(position, rock.Position) > (rock.Radius+pursuitEnvelope)*(rock.Radius+pursuitEnvelope) {
							continue
						}

						if _, _, touching := simulation.AsteroidContact(rock, position, pursuitEnvelope); touching {
							clear = false
							break
						}
					}
				}

				start := path
				start.origin, start.duration = from, 0

				if clear && pursuitPathClear(ship, rocks, start) && pursuitPathClear(ship, rocks, path) {
					return riskGap{path: path, center: center, first: a.ID, second: b.ID, circleClearance: circleClearance}
				}
			}
		}
	}

	t.Fatal("no polygon-clear, radius-blocked crossing in this generated field")
	return riskGap{}
}

func TestGeneratedRiskGapReferencesFitPhysicalShips(t *testing.T) {
	for _, scenario := range riskScenarios {
		t.Run(fmt.Sprintf("seed%d/resource%d/speed%g", scenario.seed, scenario.resource, scenario.speed), func(t *testing.T) {
			ship, rocks, center := generatedCourse(t, courseField{seed: scenario.seed, resource: scenario.resource})

			// Freeze only spin so the test isolates shape clearance; the field,
			// asteroid positions, radii, outlines and rotations remain generated.
			for _, rock := range rocks {
				rock.Spin = 0
			}

			gap := generatedRiskGap(t, ship, rocks, center, scenario.speed)
			t.Logf("rocks=%d pair=%d/%d circle clearance=%.2f reference envelope=%.1f path=%+v center=%v", len(rocks), gap.first, gap.second, gap.circleClearance, pursuitEnvelope, gap.path, gap.center)
		})
	}
}

func runRiskPursuit(ship *objects.Ship, gap riskGap) riskPursuitResult {
	path := gap.path
	ship.Position = Vec.AddScaled(path.origin, path.direction, -220)
	ship.Face(math.Atan2(path.direction.Y, path.direction.X))
	ship.Velocity = Vec.Scale(path.direction, path.speed)
	pilot := Pilot{}
	thrust, turn := 0., 0.
	contacts := ship.World.Collisions.(*courseCollisions)
	lags := []float64{}
	result := riskPursuitResult{pursuitResult: pursuitResult{closest: math.Inf(1)}, crossTrack: math.Inf(1), crossedAt: math.Inf(1)}
	clearTicks, still := 30, 0
	checkpoint := ship.Position

	for tick := range int(path.duration * 30) {
		now := float64(tick) / 30
		target, velocity := path.at(now)

		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: target, Velocity: velocity, PassDistance: 70, TargetID: 2})
		}

		previous := ship.Position
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

		before := Vec.Dot(Vec.Subtract(previous, gap.center), path.direction)
		after := Vec.Dot(Vec.Subtract(ship.Position, gap.center), path.direction)

		if math.IsInf(result.crossedAt, 1) && before < 0 && after >= 0 {
			fraction := -before / (after - before)
			crossing := Vec.AddScaled(previous, Vec.Subtract(ship.Position, previous), fraction)
			result.crossTrack = math.Abs(Vec.Cross(path.direction, Vec.Subtract(crossing, gap.center)))
			result.crossedAt = (float64(tick) + fraction) / 30
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

func TestPursuitUsesPhysicalGapsHiddenByAsteroidRadii(t *testing.T) {
	for _, scenario := range riskScenarios {
		t.Run(fmt.Sprintf("seed%d/resource%d/speed%g", scenario.seed, scenario.resource, scenario.speed), func(t *testing.T) {
			ship, rocks, center := generatedCourse(t, courseField{seed: scenario.seed, resource: scenario.resource})

			for _, rock := range rocks {
				rock.Spin = 0
			}

			gap := generatedRiskGap(t, ship, rocks, center, scenario.speed)
			result := runRiskPursuit(ship, gap)
			t.Logf("pair=%d/%d circle clearance=%.2f mean=%.1f p95=%.1f excess=%.1f escaped=%.2fs contacts=%d stationary=%ds crossing offset=%.1f at=%.2fs", gap.first, gap.second, gap.circleClearance, result.mean, result.p95, result.excess, result.escaped, result.contacts, result.stationary, result.crossTrack, result.crossedAt)

			if result.mean > 220 || result.p95 > 400 || result.excess > 300 || result.escaped > 2 || result.contacts > 3 || result.stationary > 5 || result.crossTrack > 50 || result.crossedAt > 950/scenario.speed+3 || ship.Dead || ship.Stranded() {
				t.Fatal("pilot avoided a physically usable gap or lost the fast reference")
			}
		})
	}
}
