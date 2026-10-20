package npc

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

type courseCollisions struct {
	*gameplay.GameCollisions
	shipID   int64
	touching bool
}

type courseField struct {
	seed     uint32
	resource int
}

func (c *courseCollisions) Step(entities *utilities.OrderedMap[int64, simulation.Entity], dt float64, events *[]protocol.SimulationEvent) []collision.Contact {
	contacts := c.GameCollisions.Step(entities, dt, events)

	for _, contact := range contacts {
		a := contact.Collider.Owner.(simulation.Entity).Base()
		b := contact.Other.Owner.(simulation.Entity).Base()

		if a.ID == c.shipID && b.Kind == "asteroid" || b.ID == c.shipID && a.Kind == "asteroid" {
			c.touching = true
		}
	}

	return contacts
}

/*
Use the normal sector, region and polygon generators, preserving asteroid spacing,
rotation and spin. No hand-built obstacles or collision-free ship updates.
*/
func generatedCourse(t *testing.T, field courseField) (*objects.Ship, []*simulation.Asteroid, Vec.Vector) {
	t.Helper()
	ship := flightShip(t)
	world := ship.World
	world.ItemTypes = objects.ItemTypes(world.Specification)
	sectors := simulation.GenerateSectorMap(field.seed, world.Specification)

	index := slices.IndexFunc(sectors.Sectors, func(sector simulation.Sector) bool { return sector.ID == world.Specification.StartingSectorID })

	generator := simulation.NewRegionGenerator(world.Specification, sectors.Sectors[index])
	fields := generator.GenerateFields(field.seed, Vec.Create(-40000, -40000), Vec.Create(40000, 40000))

	slices.SortFunc(fields, func(a, b protocol.FieldDescription) int {
		return int(Vec.LengthSquared(a.Position) - Vec.LengthSquared(b.Position))
	})

	index = slices.IndexFunc(fields, func(candidate protocol.FieldDescription) bool { return candidate.Resource == field.resource })

	if index < 0 {
		t.Fatalf("generated course has no field with resource %d", field.resource)
	}

	center := fields[index].Position
	size := world.Specification.Simulation.RegionSize
	rocks := []*simulation.Asteroid{}

	for x := math.Floor((center.X - 3500) / size); x <= math.Floor((center.X+3500)/size); x++ {
		for y := math.Floor((center.Y - 3500) / size); y <= math.Floor((center.Y+3500)/size); y++ {
			region := generator.GenerateRegion(field.seed, Vec.Create(x, y))

			for _, description := range region.Asteroids {
				if Vec.Distance(description.Position, center) > 4000 {
					continue
				}

				id := int64(description.ID)

				properties := simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{
					ID: &id, Position: description.Position, Radius: &description.Radius,
					Rotation: description.Rotation, Spin: description.Spin, Resource: &description.Resource,
				}, Contents: description.Contents, PointCount: description.PointCount}

				if description.RadiusEven != 0 {
					properties.RadiusEven = &description.RadiusEven
				}

				rock := simulation.CreateAsteroid(world, properties).LockGeometry()
				simulation.AddEntity(world, rock)
				rocks = append(rocks, rock)
			}
		}
	}

	if len(rocks) < 35 {
		t.Fatalf("course is not a dense generated field: %d asteroids", len(rocks))
	}

	world.Collisions = &courseCollisions{GameCollisions: gameplay.NewGameCollisions(world.Specification), shipID: ship.ID}
	return ship, rocks, center
}

/*
The moving point follows a repeatable, unobstructed route across the field.
Its course is independent of the pilot and never moves through an asteroid.
*/
func courseRoute(t *testing.T, rocks []*simulation.Asteroid, center Vec.Vector) []Vec.Vector {
	t.Helper()
	const width, step = 49, 120

	point := func(index int) Vec.Vector {
		return Vec.Add(center, Vec.Create(float64(index%width-width/2)*step, float64(index/width-width/2)*step))
	}

	clear := func(a, b Vec.Vector) bool {
		edge := Vec.Subtract(b, a)
		length := Vec.LengthSquared(edge)

		for _, rock := range rocks {
			along := 0.0

			if length > 0 {
				along = max(0, min(1, Vec.Dot(Vec.Subtract(rock.Position, a), edge)/length))
			}

			if Vec.Distance(Vec.AddScaled(a, edge, along), rock.Position) < rock.Radius+70 {
				return false
			}
		}

		return true
	}

	nearest := func(position Vec.Vector) int {
		best, distance := -1, math.Inf(1)

		for index := range width * width {
			candidate := point(index)

			if d := Vec.DistanceSquared(candidate, position); d < distance && clear(candidate, candidate) {
				best, distance = index, d
			}
		}

		return best
	}

	stops := []Vec.Vector{{X: -2100, Y: -1000}, {X: 2100, Y: 1000}, {X: -1700, Y: 1900}, {X: 1700, Y: -1900}, {X: -2100, Y: -1000}}
	route := []Vec.Vector{}

	for index := 1; index < len(stops); index++ {
		start := nearest(Vec.Add(center, stops[index-1]))
		end := nearest(Vec.Add(center, stops[index]))
		queue := []int{start}
		previous := make([]int, width*width)

		for i := range previous {
			previous[i] = -1
		}

		previous[start] = start

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
			t.Fatal("generated field has no traversable target route")
		}

		leg := []Vec.Vector{point(end)}

		for cursor := end; cursor != start; {
			cursor = previous[cursor]
			leg = append(leg, point(cursor))
		}

		slices.Reverse(leg)

		for cursor := 0; cursor < len(leg)-1; {
			route = append(route, leg[cursor])
			next := len(leg) - 1

			for !clear(leg[cursor], leg[next]) {
				next--
			}

			cursor = next
		}
	}

	return route
}

func courseTarget(route []Vec.Vector, distance float64) (Vec.Vector, Vec.Vector) {
	for index := 0; ; index = (index + 1) % len(route) {
		start, end := route[index], route[(index+1)%len(route)]
		length := Vec.Distance(start, end)

		if distance <= length {
			direction := Vec.Normalize(Vec.Subtract(end, start))
			return Vec.AddScaled(start, direction, distance), direction
		}

		distance -= length
	}
}

func TestPilotChasesThroughGeneratedAsteroidFieldsForFiveMinutes(t *testing.T) {
	for _, scenario := range []struct {
		seed                  uint32
		resource              int
		speed, heading, start float64
	}{
		{25, 2, 110, 0, 0},
		{67, 2, 110, 0, 0},
		{501, 2, 110, 0, 0},
		{4, 1, 170, math.Pi / 2, 0},
		{5, 4, 170, math.Pi, 350},
		{18, 4, 170, 0, 700},
		{9, 4, 170, 0, 350},
	} {
		t.Run(fmt.Sprintf("seed%d/resource%d/speed%g", scenario.seed, scenario.resource, scenario.speed), func(t *testing.T) {
			ship, rocks, center := generatedCourse(t, courseField{seed: scenario.seed, resource: scenario.resource})
			route := courseRoute(t, rocks, center)
			start, direction := courseTarget(route, scenario.start)
			ship.Position = start
			ship.Face(math.Atan2(direction.Y, direction.X) + scenario.heading)
			pilot := &Pilot{}
			contacts := ship.World.Collisions.(*courseCollisions)
			thrust, turn := 0.0, 0.0
			lastContact, clearTicks, episodes := -600, 30, 0
			stationary, longestStationary, inSight := 0, 0, 0
			totalSpeed, furthest := 0.0, 0.0
			checkPosition := ship.Position
			positions := [8]Vec.Vector{}
			leastProgress := math.Inf(1)

			for tick := range 30 * 300 {
				now := float64(tick) / 30
				target, direction := courseTarget(route, now*scenario.speed+scenario.start+350)
				velocity := Vec.Scale(direction, scenario.speed)

				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target, Velocity: velocity, PassDistance: 70, TargetID: 2})
				}

				ship.Fly(thrust, turn)
				contacts.touching = false
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				totalSpeed += Vec.Length(ship.Velocity)
				distance := Vec.Distance(ship.Position, target)
				furthest = max(furthest, distance)

				if distance < 1500 {
					inSight++
				}

				if contacts.touching {
					if clearTicks >= 15 {
						episodes++

						if tick-lastContact < 30*20 {
							t.Errorf("asteroid contacts less than 20 seconds apart: previous=%g now=%g", float64(lastContact)/30, now)
						}

						lastContact = tick
					}

					clearTicks = 0
				} else {
					clearTicks++
				}

				if tick%30 == 0 {
					second := tick / 30
					positions[second%len(positions)] = ship.Position

					if second >= 7 {
						low, high := ship.Position, ship.Position

						for _, position := range positions {
							low.X, low.Y = min(low.X, position.X), min(low.Y, position.Y)
							high.X, high.Y = max(high.X, position.X), max(high.Y, position.Y)
						}

						leastProgress = min(leastProgress, Vec.Distance(low, high))
					}

					if Vec.Distance(checkPosition, ship.Position) < 15 {
						stationary++
						longestStationary = max(longestStationary, stationary)
					} else {
						stationary = 0
					}

					checkPosition = ship.Position
				}

				if ship.Dead || ship.Stranded() {
					t.Fatalf("pilot crashed at %gs: dead=%v stranded=%v contacts=%d", now, ship.Dead, ship.Stranded(), episodes)
				}
			}

			average := totalSpeed / (30 * 300)
			t.Logf("asteroids=%d contacts=%d average speed=%.1f longest stationary=%ds minimum seven-second progress=%.1f in sight=%.1f%% furthest=%.1f", len(rocks), episodes, average, longestStationary, leastProgress, float64(inSight)/90, furthest)

			if episodes > 15 || longestStationary > 5 || leastProgress < 80 || average < ship.MaxSpeed()*.5 || inSight < 30*300*.9 {
				t.Fatal("pilot failed sustained high-speed pursuit through the generated field")
			}
		})
	}
}

func TestPilotEscapesTouchingAsteroidCluster(t *testing.T) {
	for _, heading := range []float64{-.85, -math.Pi / 2, math.Pi} {
		t.Run(fmt.Sprint(heading), func(t *testing.T) {
			ship := flightShip(t)
			world := ship.World
			world.ItemTypes = objects.ItemTypes(world.Specification)
			world.Collisions = &courseCollisions{GameCollisions: gameplay.NewGameCollisions(world.Specification), shipID: ship.ID}

			large := simulation.CreateAsteroid(world, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{
				Radius: new(170.0), ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{0, -170}, {160, -60}, {100, 140}, {-100, 140}, {-160, -60}}},
			}})

			small := simulation.CreateAsteroid(world, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{
				Position: Vec.Create(-240, 210), Radius: new(75.0), ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-70, -25}, {-25, -70}, {65, -35}, {60, 50}, {-20, 70}}},
			}})

			simulation.AddEntity(world, large.LockGeometry())
			simulation.AddEntity(world, small.LockGeometry())
			ship.Position = Vec.Create(-100, 162)
			ship.Face(heading)
			pilot := &Pilot{}
			target := Vec.Create(320, -330)
			closest := math.Inf(1)
			thrust, turn := 0.0, 0.0
			lastMoved, checkpoint := 0, ship.Position

			for tick := range 30 * 35 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target})
				}

				ship.Fly(thrust, turn)
				simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})
				closest = min(closest, Vec.Distance(ship.Position, target))

				if Vec.Distance(ship.Position, checkpoint) > 80 {
					checkpoint, lastMoved = ship.Position, tick
				}

				if closest > 30 && tick-lastMoved > 30*7 {
					t.Fatalf("pilot remained pinned to cluster for 7 seconds: position=%v thrust=%g turn=%g", ship.Position, thrust, turn)
				}

				if ship.Dead || ship.Stranded() {
					t.Fatal("pilot destroyed itself trying to escape touching asteroids")
				}
			}

			if closest > 30 {
				t.Fatalf("pilot failed to navigate around touching cluster: closest=%g", closest)
			}
		})
	}
}

func TestPilotEscapesGeneratedAsteroidCluster(t *testing.T) {
	for _, angle := range []float64{2 * math.Pi / 3, 4 * math.Pi / 3} {
		t.Run(fmt.Sprint(angle), func(t *testing.T) {
			ship, rocks, _ := generatedCourse(t, courseField{seed: 501, resource: 2})
			rock := rocks[7]
			direction := Vec.Create(math.Cos(angle), math.Sin(angle))
			ship.Position = Vec.AddScaled(rock.Position, direction, rock.Radius+30)
			target := Vec.AddScaled(rock.Position, direction, -rock.Radius-400)
			offset := Vec.Subtract(target, ship.Position)
			ship.Face(math.Atan2(offset.Y, offset.X))
			pilot := &Pilot{}
			thrust, turn := 0.0, 0.0
			closest := math.Inf(1)
			checkpoint, lastMoved := ship.Position, 0

			for tick := range 30 * 35 {
				if tick%steeringIntervalTicks(ship) == 0 {
					thrust, turn = pilot.Steer(ship, Movement{Position: target})
				}

				ship.Fly(thrust, turn)
				simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
				closest = min(closest, Vec.Distance(ship.Position, target))

				if closest < 30 {
					return
				}

				if Vec.Distance(ship.Position, checkpoint) > 80 {
					checkpoint, lastMoved = ship.Position, tick
				}

				if tick-lastMoved > 30*7 {
					t.Fatalf("pilot pinned in generated cluster for 7 seconds: position=%v target=%v closest=%g", ship.Position, target, closest)
				}
			}

			t.Fatalf("pilot failed to escape generated cluster: closest=%g", closest)
		})
	}
}
