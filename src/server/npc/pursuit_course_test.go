package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

type pursuitTrack struct {
	points     []Vec.Vector
	velocities []Vec.Vector
	times      []float64
}

func (p pursuitTrack) at(now float64) (Vec.Vector, Vec.Vector) {
	now = math.Mod(now, p.times[len(p.times)-1])
	index, _ := slices.BinarySearch(p.times, now)
	index = max(1, index)
	from, to := p.points[index-1], p.points[index]
	duration := p.times[index] - p.times[index-1]
	u := (now - p.times[index-1]) / duration
	a, b := p.velocities[index-1], p.velocities[index]
	position := Vec.Add(Vec.Add(Vec.Scale(from, 2*u*u*u-3*u*u+1), Vec.Scale(a, duration*(u*u*u-2*u*u+u))), Vec.Add(Vec.Scale(to, -2*u*u*u+3*u*u), Vec.Scale(b, duration*(u*u*u-u*u))))
	velocity := Vec.Scale(Vec.Add(Vec.Add(Vec.Scale(from, 6*u*u-6*u), Vec.Scale(a, duration*(3*u*u-4*u+1))), Vec.Add(Vec.Scale(to, -6*u*u+6*u), Vec.Scale(b, duration*(3*u*u-2*u)))), 1/duration)
	return position, velocity
}

/*
Build the reference route independently from Pilot, using asteroid radii and a
44-unit envelope containing the Courser's navigation circle plus clearance.
Static generated rocks isolate tight route following; normal spinning fields remain
covered by TestPilotChasesThroughGeneratedAsteroidFieldsForFiveMinutes.
The reference is a kinematic moving point: its force direction can change faster
than a forward-thrust ship can rotate, even with bounded speed and acceleration.
*/
func narrowPursuitTrack(t *testing.T, rocks []*simulation.Asteroid, center Vec.Vector, speed float64) pursuitTrack {
	t.Helper()
	const width, step = 61, 100

	point := func(index int) Vec.Vector {
		return Vec.Add(center, Vec.Create(float64(index%width-width/2)*step, float64(index/width-width/2)*step))
	}

	clear := func(from, to Vec.Vector) bool {
		edge := Vec.Subtract(to, from)
		length := Vec.LengthSquared(edge)

		for _, rock := range rocks {
			along := 0.

			if length > 0 {
				along = max(0, min(1, Vec.Dot(Vec.Subtract(rock.Position, from), edge)/length))
			}

			if Vec.DistanceSquared(Vec.AddScaled(from, edge, along), rock.Position) < (rock.Radius+pursuitEnvelope)*(rock.Radius+pursuitEnvelope) {
				return false
			}
		}

		return true
	}

	nearest := func(position Vec.Vector) int {
		best, distance := -1, math.Inf(1)

		for index := range width * width {
			candidate := point(index)

			if d := Vec.DistanceSquared(position, candidate); d < distance && clear(candidate, candidate) {
				best, distance = index, d
			}
		}

		return best
	}

	stops := []Vec.Vector{{X: -2100, Y: -1000}, {X: 2100, Y: 1000}, {X: -1700, Y: 1900}, {X: 1700, Y: -1900}, {X: -2100, Y: -1000}}
	route := []Vec.Vector{}

	for leg := 1; leg < len(stops); leg++ {
		start, end := nearest(Vec.Add(center, stops[leg-1])), nearest(Vec.Add(center, stops[leg]))
		previous := make([]int, width*width)

		for i := range previous {
			previous[i] = -1
		}

		previous[start] = start
		queue := []int{start}

		for head := 0; head < len(queue) && previous[end] < 0; head++ {
			current := queue[head]

			for _, next := range []int{current - 1, current + 1, current - width, current + width} {
				if next < 0 || next >= len(previous) || math.Abs(float64(next%width-current%width)) > 1 || previous[next] >= 0 || !clear(point(current), point(next)) {
					continue
				}

				previous[next] = current
				queue = append(queue, next)
			}
		}

		if previous[end] < 0 {
			t.Fatal("no connected narrow reference route")
		}

		points := []Vec.Vector{point(end)}

		for cursor := end; cursor != start; {
			cursor = previous[cursor]
			points = append(points, point(cursor))
		}

		slices.Reverse(points)

		for cursor := 0; cursor < len(points)-1; {
			route = append(route, points[cursor])
			next := len(points) - 1

			for !clear(points[cursor], points[next]) {
				next--
			}

			cursor = next
		}
	}

	points, directions := []Vec.Vector{}, []Vec.Vector{}
	curvatures := []float64{}

	appendPoint := func(position, direction Vec.Vector, curvature float64) {
		if len(points) > 0 && Vec.Distance(points[len(points)-1], position) < 1e-5 {
			return
		}

		points = append(points, position)
		directions = append(directions, direction)
		curvatures = append(curvatures, curvature)
	}

	appendLine := func(from, to Vec.Vector) {
		distance := Vec.Distance(from, to)
		steps := max(1, int(math.Ceil(distance/.8)))
		direction := Vec.Normalize(Vec.Subtract(to, from))

		for i := 1; i <= steps; i++ {
			appendPoint(Vec.AddScaled(from, Vec.Subtract(to, from), float64(i)/float64(steps)), direction, 0)
		}
	}

	for index, corner := range route {
		before, after := route[(index+len(route)-1)%len(route)], route[(index+1)%len(route)]
		distance := min(150, Vec.Distance(before, corner)*.3, Vec.Distance(corner, after)*.3)
		var from, to Vec.Vector
		incoming := Vec.Normalize(Vec.Subtract(corner, before))
		hairpin := Vec.Dot(incoming, Vec.Normalize(Vec.Subtract(after, corner))) < -1+1e-9

		curveAt := func(u float64) (Vec.Vector, Vec.Vector, Vec.Vector) {
			if hairpin {
				sine, cosine := math.Sincos(u * math.Pi)
				side := Vec.Create(-incoming.Y, incoming.X)
				position := Vec.Add(from, Vec.Add(Vec.Scale(incoming, distance*sine), Vec.Scale(side, distance*sine*sine*cosine)))
				derivative := Vec.Add(Vec.Scale(incoming, distance*math.Pi*cosine), Vec.Scale(side, distance*math.Pi*sine*(2-3*sine*sine)))
				second := Vec.Add(Vec.Scale(incoming, -distance*math.Pi*math.Pi*sine), Vec.Scale(side, distance*math.Pi*math.Pi*cosine*(2-9*sine*sine)))
				return position, derivative, second
			}

			position := Vec.Add(Vec.Add(Vec.Scale(from, (1-u)*(1-u)), Vec.Scale(corner, 2*(1-u)*u)), Vec.Scale(to, u*u))
			derivative := Vec.Add(Vec.Scale(Vec.Subtract(corner, from), 2*(1-u)), Vec.Scale(Vec.Subtract(to, corner), 2*u))
			second := Vec.Scale(Vec.Add(Vec.Subtract(to, Vec.Scale(corner, 2)), from), 2)
			return position, derivative, second
		}

		for {
			from = Vec.AddScaled(corner, Vec.Normalize(Vec.Subtract(before, corner)), distance)
			to = Vec.AddScaled(corner, Vec.Normalize(Vec.Subtract(after, corner)), distance)
			previous := from
			valid := true

			for i := 1; i <= 24; i++ {
				u := float64(i) / 24
				position, _, _ := curveAt(u)
				valid = valid && clear(previous, position)
				previous = position
			}

			if valid {
				break
			}

			distance *= .5

			if distance < 1 {
				t.Fatal("could not round reference route corner")
			}
		}

		if len(points) > 0 {
			appendLine(points[len(points)-1], from)
		}

		count := max(20, int(math.Ceil((Vec.Distance(from, corner)+Vec.Distance(corner, to))/.8)))

		for i := 0; i <= count; i++ {
			u := float64(i) / float64(count)
			position, derivative, second := curveAt(u)
			curvature := math.Abs(Vec.Cross(derivative, second)) / math.Pow(max(1e-9, Vec.Length(derivative)), 3)
			appendPoint(position, Vec.Normalize(derivative), curvature)
		}
	}

	appendLine(points[len(points)-1], points[0])
	limits := make([]float64, len(points))

	for index, curvature := range curvatures {
		limits[index] = min(speed, math.Sqrt(150/max(1e-9, curvature)), 1.5/max(1e-9, curvature))
	}

	for pass := range 6 {
		limits[0] = min(limits[0], limits[len(limits)-1])
		limits[len(limits)-1] = limits[0]

		for i := 1; i < len(points); i++ {
			index, previous := i, i-1

			if pass%2 == 1 {
				index, previous = len(points)-1-i, len(points)-i
			}

			limits[index] = min(limits[index], math.Sqrt(limits[previous]*limits[previous]+2*80*Vec.Distance(points[index], points[previous])))
		}
	}

	times := make([]float64, len(points))
	velocities := make([]Vec.Vector, len(points))

	for i := range points {
		velocities[i] = Vec.Scale(directions[i], limits[i])

		if i > 0 {
			times[i] = times[i-1] + 2*Vec.Distance(points[i-1], points[i])/max(.01, limits[i-1]+limits[i])
		}
	}

	velocities[len(points)-1] = velocities[0]
	return pursuitTrack{points: points, velocities: velocities, times: times}

}

func runCurvingPursuit(ship *objects.Ship, track pursuitTrack, references ...*objects.Ship) pursuitResult {
	ship.Position, _ = track.at(0)
	targetStart := 220. / 180
	_, velocity := track.at(0)
	ship.Velocity = velocity
	ship.Face(math.Atan2(velocity.Y, velocity.X))
	var reference *objects.Ship

	if len(references) > 0 {
		reference = references[0]
	}

	return followPursuitCourse(ship, 300, func(now float64) (Vec.Vector, Vec.Vector) { return track.at(now + targetStart) }, reference)
}

/*
Record the same lag, contact, and progress measures for straight and curving
courses while retaining each course's independent target path and starting pose.
*/
func followPursuitCourse(ship *objects.Ship, duration float64, targetAt func(float64) (Vec.Vector, Vec.Vector), reference *objects.Ship) pursuitResult {
	pilot := Pilot{}
	thrust, turn := 0., 0.
	contacts := ship.World.Collisions.(*courseCollisions)
	lags := []float64{}
	result := pursuitResult{closest: math.Inf(1)}
	clearTicks, shipClearTicks, still := 30, 30, 0
	checkpoint := ship.Position

	for tick := range int(duration * 30) {
		now := float64(tick) / 30
		target, velocity := targetAt(now)
		targetID := int64(2)

		if reference != nil {
			// Keep the route independent from NPC steering while exercising ship avoidance and contacts.
			reference.Position, reference.Velocity = target, velocity
			reference.Face(math.Atan2(velocity.Y, velocity.X))
			reference.Spin = 0
			targetID = reference.ID
		}

		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: target, Velocity: velocity, PassDistance: 70, TargetID: targetID})
		}

		ship.Fly(thrust, turn)
		contacts.touching = false
		events := simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if reference != nil {
			touching := false

			for _, event := range events {
				if contact, ok := event.(protocol.CollisionEvent); ok && (contact.A == ship.ID && contact.B == targetID || contact.B == ship.ID && contact.A == targetID) {
					touching = true
				}
			}

			if touching {
				if shipClearTicks >= 15 {
					result.shipContacts++
				}

				shipClearTicks = 0
			} else {
				shipClearTicks++
			}
		}

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

func TestPursuitKeepsUpWithPhysicalPlayerShipsAroundNarrowCourses(t *testing.T) {
	// Bound lost engagement time while keeping the full-speed reference physically reachable.
	for _, scenario := range []struct {
		seed                                 uint32
		resource                             int
		speed, maximumExcess, maximumEscaped float64
	}{
		{5, 4, 170, 15057.99, 15.523},
		{9, 4, 180, 18147.86, 17.627},
		{4, 1, 190, 10651.72, 11.213},
	} {
		t.Run(fmt.Sprintf("seed%d/speed%g", scenario.seed, scenario.speed), func(t *testing.T) {
			ship, rocks, center := generatedCourse(t, courseField{seed: scenario.seed, resource: scenario.resource})

			for _, rock := range rocks {
				rock.Spin = 0
			}

			track := narrowPursuitTrack(t, rocks, center, scenario.speed)
			reference := objects.CreatePlayerShip(ship.World, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(2))})
			simulation.AddEntity(ship.World, reference)
			result := runCurvingPursuit(ship, track, reference)
			t.Logf("mean=%.1f p95=%.1f excess=%.1f escaped=%.2fs asteroids=%d ships=%d stationary=%ds closest=%.1f", result.mean, result.p95, result.excess, result.escaped, result.contacts, result.shipContacts, result.stationary, result.closest)

			if result.excess > scenario.maximumExcess || result.escaped > scenario.maximumEscaped || result.contacts > 15 || result.shipContacts > 15 || result.stationary > 5 || ship.Dead || ship.Stranded() || reference.Dead {
				t.Fatal("physical player avoidance interrupted pursuit")
			}
		})
	}
}

func TestPursuitKeepsUpAroundNarrowGeneratedCoursesForFiveMinutes(t *testing.T) {
	for _, scenario := range []struct {
		seed                                 uint32
		resource                             int
		speed, maximumExcess, maximumEscaped float64
	}{
		{5, 4, 170, 13083.63, 13.557},
		{9, 4, 180, 17832.12, 16.727},
		{4, 1, 190, 10850.01, 13.610},
	} {
		t.Run(fmt.Sprintf("seed%d/resource%d/speed%g", scenario.seed, scenario.resource, scenario.speed), func(t *testing.T) {
			ship, rocks, center := generatedCourse(t, courseField{seed: scenario.seed, resource: scenario.resource})

			for _, rock := range rocks {
				rock.Spin = 0
			}

			track := narrowPursuitTrack(t, rocks, center, scenario.speed)
			maximumSpeed, maximumYaw, maximumThrust, maximumForceYaw := 0., 0., 0., 0.
			_, previousVelocity := track.at(0)
			previousForce := Vec.Vector{}

			for now := 1. / 120; now < track.times[len(track.times)-1]; now += 1. / 120 {
				_, velocity := track.at(now)
				maximumSpeed = max(maximumSpeed, Vec.Length(velocity))
				maximumYaw = max(maximumYaw, math.Abs(math.Atan2(Vec.Cross(previousVelocity, velocity), Vec.Dot(previousVelocity, velocity)))*120)
				acceleration := Vec.Scale(Vec.Subtract(velocity, previousVelocity), 120)
				force := Vec.Add(acceleration, Vec.Scale(velocity, ship.Drag))
				maximumThrust = max(maximumThrust, Vec.Length(force))

				if Vec.Length(force) > 20 && Vec.Length(previousForce) > 20 {
					maximumForceYaw = max(maximumForceYaw, math.Abs(math.Atan2(Vec.Cross(previousForce, force), Vec.Dot(previousForce, force)))*120)
				}

				previousForce = force
				previousVelocity = velocity
			}

			t.Logf("reference maximum speed=%.1f yaw=%.2f thrust=%.1f force yaw=%.1f", maximumSpeed, maximumYaw, maximumThrust, maximumForceYaw)

			if maximumSpeed > ship.MaxSpeed() || maximumYaw > ship.TurnRate*ship.RotationalThrust()/ship.Rules.Flight.SpinDivisor || maximumThrust > ship.Rules.Flight.ThrustScale*ship.ForwardThrust()/ship.Mass {
				t.Fatal("reference target exceeds the ship's motion limits")
			}

			if !pursuitRouteClear(ship, rocks, track.at, 300) {
				t.Fatal("reference route intersects a physical ship hull")
			}

			result := runCurvingPursuit(ship, track)
			t.Logf("points=%d lap=%.1fs mean=%.1f p95=%.1f excess=%.1f escaped=%.2fs contacts=%d stationary=%ds closest=%.1f", len(track.points), track.times[len(track.times)-1], result.mean, result.p95, result.excess, result.escaped, result.contacts, result.stationary, result.closest)

			if result.excess > scenario.maximumExcess || result.escaped > scenario.maximumEscaped || result.contacts > 15 || result.stationary > 5 || ship.Dead || ship.Stranded() {
				t.Fatal("pursuit lost the fast target around narrow generated course")
			}
		})
	}
}

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
	return followPursuitCourse(ship, path.duration, path.at, nil)
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
