package npc

import (
	"encoding/json"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/query"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"os"
	"slices"
	"testing"
)

func TestCollectionContactBoundKeepsNativeCornerContacts(t *testing.T) {
	const slop = .5
	square := []Vec.Vector{{X: -1, Y: -1}, {X: 1, Y: -1}, {X: 1, Y: 1}, {X: -1, Y: 1}}
	item := shape.NewPolygon(square, new(0.0), slop)

	for _, scenario := range []struct {
		name     string
		margin   *float64
		distance float64
	}{
		{"large", new(10.0), 11.9},
		{"default", nil, 2.9},
		{"zero", new(0.0), 1.9},
	} {
		for _, rotation := range []float64{0, math.Pi / 7, math.Pi / 2} {
			t.Run(fmt.Sprintf("%s/rotation%g", scenario.name, rotation), func(t *testing.T) {
				hull := collectionHull{shape: shape.NewPolygon(square, scenario.margin, slop)}
				position := simulation.RotatePoint(Vec.Create(scenario.distance, scenario.distance), rotation)
				a := Vec.Transform(0, 0, rotation)
				b := Vec.Transform(position.X, position.Y, rotation)

				if _, touching := query.ContactShapes(hull.shape, item, a, b, slop); !touching {
					t.Fatal("fixture must produce a native polygon corner contact")
				}

				reach := collectionRadius(hull.shape) + collectionRadius(item) + slop

				if Vec.DistanceSquared(a.P, b.P) > reach*reach {
					t.Fatal("collection bound discarded a native polygon corner contact")
				}
			})
		}
	}
}

func TestCollectionContactBoundKeepsOffsetCircleContacts(t *testing.T) {
	const slop = .5
	hull := shape.NewCircle(Vec.Create(3, 4), 10)
	item := shape.NewCircle(Vec.Vector{}, .1)

	for _, rotation := range []float64{0, math.Pi / 7, math.Pi / 2} {
		t.Run(fmt.Sprintf("rotation%g", rotation), func(t *testing.T) {
			position := simulation.RotatePoint(Vec.Create(9, 12), rotation)
			a := Vec.Transform(0, 0, rotation)
			b := Vec.Transform(position.X, position.Y, rotation)

			if _, touching := query.ContactShapes(hull, item, a, b, slop); !touching {
				t.Fatal("fixture must produce a native circle contact")
			}

			reach := collectionRadius(hull) + collectionRadius(item) + slop

			if Vec.DistanceSquared(a.P, b.P) > reach*reach {
				t.Fatal("collection bound discarded a native circle contact")
			}
		})
	}
}

func collectionThroat(t *testing.T, ship *objects.Ship) (*simulation.Segment, *collision.Collider) {
	t.Helper()
	ship.SetModuleActive("cargoHatch", true)
	ship.UpdateModules(1)

	for _, collider := range ship.Hitbox() {
		if segment, ok := collider.Segment.(*simulation.Segment); ok && segment.Catches {
			return segment, collider
		}
	}

	t.Fatal("collection fixture has no cargo pickup throat")
	return nil, nil
}

/*
Keep real item shapes, hatch animation and physical contacts active throughout
the approach. The result measures simulation time rather than machine speed.
*/
func collectOneItem(t *testing.T, ship *objects.Ship, item *objects.Item, pilot *Pilot) (float64, float64) {
	t.Helper()
	thrust, turn, channelTime := 0.0, 0.0, 0.0
	step := ship.Catalog.Simulation.SimulationStep

	for tick := range int(45 / step) {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true})
		}

		local := simulation.RotatePoint(Vec.Subtract(item.Position, ship.Position), -ship.Rotation)

		if local.X > 0 && local.X < 40 && math.Abs(local.Y) < 8 && Vec.Length(Vec.Subtract(ship.Velocity, item.Velocity)) < 10 {
			channelTime += step
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
			return float64(tick+1) * step, channelTime
		}

		if item.Dead {
			t.Fatal("collection approach destroyed its target item")
		}
	}

	t.Fatalf("item was not collected: ship=%v item=%v speed=%g slow channel time=%g", ship.Position, item.Position, Vec.Length(ship.Velocity), channelTime)
	return 0, 0
}

func TestCollectionRestartsAtTheHatchHinge(t *testing.T) {
	for _, heading := range []float64{0, math.Pi / 2, math.Pi, -math.Pi / 2} {
		t.Run(fmt.Sprintf("heading%g", heading), func(t *testing.T) {
			ship := arrivalShip(t, "courser")
			ship.Face(heading)
			segment, _ := collectionThroat(t, ship)
			item := objects.NewItem("diamond", simulation.ObjectProperties{World: ship.World, Position: Vec.Add(ship.Position, simulation.RotatePoint(segment.LocalPosition, heading)), Rotation: heading}, ship.Catalog)
			simulation.AddEntity(ship.World, item)
			simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

			if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
				t.Fatal("hinge fixture must begin outside the actual pickup throat")
			}

			pilot := &Pilot{}
			thrust, _ := pilot.Steer(ship, Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true})

			if thrust <= 0 {
				t.Fatal("ship stopped with the item at the hinge before it entered the pickup throat")
			}

			elapsed, slow := collectOneItem(t, ship, item, pilot)

			if elapsed > 1 {
				t.Fatalf("item waited at the hinge for %.3f seconds before collection", elapsed)
			}

			t.Logf("picked up hinge item in %.3f simulation seconds; slow channel time %.3f", elapsed, slow)
		})
	}
}

func TestCollectionApproachesTheActualHatchAcrossHeadings(t *testing.T) {
	for _, definition := range []string{"courser", "arrow"} {
		for _, position := range []Vec.Vector{{}, {X: 45000, Y: -45000}, {X: -45000, Y: 45000}} {
			for _, heading := range []float64{0, math.Pi / 2, math.Pi, -math.Pi / 2} {
				t.Run(fmt.Sprintf("%s/position%v/heading%g", definition, position, heading), func(t *testing.T) {
					ship := arrivalShip(t, definition)
					ship.Position = position
					ship.Face(heading)
					_, throat := collectionThroat(t, ship)
					item := objects.NewItem("diamond", simulation.ObjectProperties{World: ship.World, Position: Vec.Add(throat.Position, simulation.RotatePoint(Vec.Create(90, 0), heading)), Rotation: heading}, ship.Catalog)
					simulation.AddEntity(ship.World, item)
					elapsed, slow := collectOneItem(t, ship, item, &Pilot{})

					if elapsed > 3 {
						t.Fatalf("nearby item took %.3f seconds to enter the actual hatch", elapsed)
					}

					t.Logf("picked up item in %.3f simulation seconds; slow channel time %.3f", elapsed, slow)
				})
			}
		}
	}
}

func TestCollectionMovesThroughTheCourserChannel(t *testing.T) {
	for _, definition := range []string{"diamond", "gold", "amethyst", "opal"} {
		t.Run(definition, func(t *testing.T) {
			ship := arrivalShip(t, "courser")
			collectionThroat(t, ship)
			item := objects.NewItem(definition, simulation.ObjectProperties{World: ship.World, Position: Vec.Create(250, 0)}, ship.Catalog)
			simulation.AddEntity(ship.World, item)
			elapsed, slow := collectOneItem(t, ship, item, &Pilot{})

			if elapsed > 4 || slow > .5 {
				t.Fatalf("collection slowed before the item entered the hatch: elapsed=%.3f slow=%.3f", elapsed, slow)
			}

			t.Logf("picked up item in %.3f simulation seconds; slow channel time %.3f", elapsed, slow)
		})
	}
}

func TestCollectionRecoveryLeavesCargoMovingWithTheShip(t *testing.T) {
	ship := arrivalShip(t, "courser")
	collectionThroat(t, ship)
	ship.Velocity = Vec.Create(180, 0)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(16, 0), Velocity: Vec.Clone(ship.Velocity), Rotation: 2}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	approach := collectionApproach{}
	destination := Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true}
	approach.movement(ship, destination, nil)
	ship.World.Tick += uint64(math.Ceil(2.1 / ship.Catalog.Simulation.SimulationStep))
	first := approach.movement(ship, destination, nil)

	if first.Collect {
		t.Fatal("wedged cargo never triggered another approach")
	}

	// A blocked item can travel with the ship while neither closes the gap.
	// Recovery must leave that moving pair rather than chasing its own offset.
	ship.Position = Vec.Add(ship.Position, Vec.Create(180, 0))
	item.Position = Vec.Add(item.Position, Vec.Create(180, 0))
	ship.World.Tick++
	destination.Position = item.Position
	next := approach.movement(ship, destination, nil)

	if next.Collect || next.Position != first.Position || Vec.LengthSquared(next.Velocity) != 0 {
		t.Fatalf("recovery followed the moving cargo: first=%v next=%v velocity=%v", first.Position, next.Position, next.Velocity)
	}
}

func TestCollectionEscapesCargoPushedAcrossTheChannel(t *testing.T) {
	ship := arrivalShip(t, "courser")
	collectionThroat(t, ship)
	ship.Velocity = Vec.Create(180, 0)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(16, 0), Velocity: Vec.Clone(ship.Velocity), Rotation: 2}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	elapsed, slow := collectOneItem(t, ship, item, &Pilot{})

	if elapsed > 25 {
		t.Fatalf("ship kept pushing blocked cargo for %.3f seconds", elapsed)
	}

	t.Logf("collected cargo moving with the ship in %.3f simulation seconds; slow channel time %.3f", elapsed, slow)
}

func TestCollectionRoutesAroundAnObstacleAfterPlanningAPickup(t *testing.T) {
	ship := arrivalShip(t, "courser")
	collectionThroat(t, ship)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(350, 0)}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	pilot := &Pilot{}
	pilot.Steer(ship, Movement{Position: item.Position, IgnoreID: item.ID, Collect: true})

	// New obstacles must replace the open pickup approach with a safe route.
	rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{
		ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(150, 0), Radius: new(40.0)},
		PointCount:       8,
	})

	simulation.AddEntity(ship.World, rock.LockGeometry())
	health := ship.HullHealthTotal()
	elapsed, _ := collectOneItem(t, ship, item, pilot)

	if ship.HullHealthTotal() != health {
		t.Fatalf("collection crossed the blocking asteroid: hull health before=%g after=%g", health, ship.HullHealthTotal())
	}

	t.Logf("collected cargo around the new obstacle in %.3f simulation seconds", elapsed)
}

func TestFinchCollectsThroughEitherSideHatch(t *testing.T) {
	for _, definition := range []string{"diamond", "gold", "amethyst", "opal", "autogunAmmo"} {
		for _, heading := range []float64{0, math.Pi / 2, math.Pi, -math.Pi / 2} {
			for _, side := range []float64{-1, 1} {
				t.Run(fmt.Sprintf("%s/heading%g/side%g", definition, heading, side), func(t *testing.T) {
					ship := arrivalShip(t, "finch")
					ship.Face(heading)
					collectionThroat(t, ship)
					item := objects.NewItem(definition, simulation.ObjectProperties{World: ship.World, Position: simulation.RotatePoint(Vec.Create(160, 100*side), heading), Rotation: heading + .7}, ship.Catalog)
					simulation.AddEntity(ship.World, item)
					elapsed, _ := collectOneItem(t, ship, item, &Pilot{})

					if elapsed > 3 {
						t.Fatalf("nearby item took %.3f seconds to reach a side hatch", elapsed)
					}

					t.Logf("picked up item in %.3f simulation seconds", elapsed)
				})
			}
		}
	}
}

func TestFinchCollectsMovingItemsAcrossApproaches(t *testing.T) {
	for _, position := range []Vec.Vector{{X: 240}, {X: -240}, {Y: 240}, {Y: -240}, {X: 100, Y: 30}, {X: 100, Y: -30}} {
		for _, velocity := range []Vec.Vector{{}, {X: 35, Y: 15}, {X: -20, Y: -30}} {
			t.Run(fmt.Sprintf("position%v/velocity%v", position, velocity), func(t *testing.T) {
				ship := arrivalShip(t, "finch")
				collectionThroat(t, ship)
				item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: position, Velocity: velocity, Rotation: 1.2, Spin: .4}, ship.Catalog)
				simulation.AddEntity(ship.World, item)
				elapsed, _ := collectOneItem(t, ship, item, &Pilot{})

				if elapsed > 12 {
					t.Fatalf("nearby moving item took %.3f seconds to collect", elapsed)
				}

				t.Logf("picked up moving item in %.3f simulation seconds", elapsed)
			})
		}
	}
}

func TestFinchCollectsAcrossAnAsteroidField(t *testing.T) {
	ship := arrivalShip(t, "finch")
	collectionThroat(t, ship)

	for index, position := range []Vec.Vector{{X: 250}, {X: 420, Y: -120}, {X: 600, Y: 60}, {X: 820, Y: -100}} {
		rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{
			ObjectProperties: simulation.ObjectProperties{Position: position, Radius: new(50.0 + float64(index)*5)},
			PointCount:       8,
		})

		simulation.AddEntity(ship.World, rock.LockGeometry())
	}

	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(1050, 0), Rotation: .8}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	health := ship.HullHealthTotal()
	elapsed, _ := collectOneItem(t, ship, item, &Pilot{})

	if ship.HullHealthTotal() != health {
		t.Fatalf("collection damaged the Finch in the asteroid field: before=%g after=%g", health, ship.HullHealthTotal())
	}

	if elapsed > 20 {
		t.Fatalf("collection took %.3f seconds to cross a 1,050-meter field", elapsed)
	}

	t.Logf("collected cargo through an asteroid field in %.3f simulation seconds", elapsed)
}

func TestFinchCollectsBesideAsteroid(t *testing.T) {
	for _, angle := range []float64{0, math.Pi / 2, math.Pi, -math.Pi / 2} {
		t.Run(fmt.Sprint(angle), func(t *testing.T) {
			ship := arrivalShip(t, "finch")
			collectionThroat(t, ship)

			rock := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{
				ObjectProperties: simulation.ObjectProperties{
					Position: Vec.Create(350, 0), Radius: new(85.0),
					ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-60, -60}, {60, -60}, {60, 60}, {-60, 60}}},
				},
			})

			simulation.AddEntity(ship.World, rock.LockGeometry())
			item := objects.NewItem("diamond", simulation.ObjectProperties{World: ship.World, Position: Vec.Add(rock.Position, simulation.RotatePoint(Vec.Create(85, 0), angle)), Rotation: .8}, ship.Catalog)
			simulation.AddEntity(ship.World, item)
			health := ship.HullHealthTotal()
			elapsed, _ := collectOneItem(t, ship, item, &Pilot{})

			if ship.HullHealthTotal() != health {
				t.Fatalf("close pickup damaged the Finch: before=%g after=%g", health, ship.HullHealthTotal())
			}

			t.Logf("collected cargo beside asteroid in %.3f simulation seconds", elapsed)
		})
	}
}

/*
These rotating fragments and concave parent hulls come from the real mining
checkpoint. Different initial headings must all reach the physical side hatch.
*/
func TestFinchCollectsGoldBetweenMinedAsteroids(t *testing.T) {
	data, err := os.ReadFile("testdata/mined-gold.json")

	if err != nil {
		t.Fatal(err)
	}

	var cases []struct {
		Name               string
		Position, Velocity Vec.Vector
		ItemRotation       float64
		Rocks              []struct {
			Position               Vec.Vector
			Radius, Rotation, Spin float64
			Points                 []simulation.Point
		}
	}

	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}

	for _, scenario := range cases {
		for _, heading := range []float64{0, math.Pi / 2, math.Pi, -math.Pi / 2} {
			t.Run(fmt.Sprintf("%s/heading%g", scenario.Name, heading), func(t *testing.T) {
				ship := arrivalShip(t, "finch")
				collectionThroat(t, ship)
				ship.Position, ship.Velocity = scenario.Position, scenario.Velocity
				ship.Face(heading)

				for _, rock := range scenario.Rocks {
					asteroid := simulation.CreateAsteroid(ship.World, simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{Position: rock.Position, Radius: new(rock.Radius), Rotation: rock.Rotation, Spin: rock.Spin, ShapeOutline: &simulation.ShapeOutline{Points: rock.Points}}}).LockGeometry()
					simulation.AddEntity(ship.World, asteroid)
				}

				item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Rotation: scenario.ItemRotation}, ship.Catalog)
				simulation.AddEntity(ship.World, item)
				health := ship.HullHealthTotal()
				modules := map[*simulation.Mount]float64{}

				for _, segment := range ship.Segments {
					for _, mount := range segment.Mounts {
						if mount.Module != nil {
							modules[mount] = mount.Health
						}
					}
				}

				elapsed := collectMinedItem(t, ship, item)

				if ship.HullHealthTotal() != health {
					t.Fatalf("pickup damaged hull: %g/%g", ship.HullHealthTotal(), health)
				}

				for mount, health := range modules {
					if mount.Module == nil || mount.Health != health {
						t.Fatalf("pickup damaged an installed module: %g/%g", mount.Health, health)
					}
				}

				t.Logf("collected mined gold in %.3f simulation seconds", elapsed)
			})
		}
	}
}

/*
Retain the normal decision cadence, visible physics substeps, and actual contacts
for a difficult pickup. The deadline remains below the five-minute trip timeout.
*/
func collectMinedItem(t *testing.T, ship *objects.Ship, item *objects.Item) float64 {
	t.Helper()
	pilot := &Pilot{}
	step := ship.Catalog.Simulation.SimulationStep
	thrust, turn := 0.0, 0.0

	for tick := range int(240 / step) {
		if tick%steeringIntervalTicks(ship) == 0 {
			thrust, turn = pilot.Steer(ship, Movement{Position: item.Position, Velocity: item.Velocity, IgnoreID: item.ID, Collect: true})
		}

		ship.Fly(thrust, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})

		if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
			return float64(tick+1) * step
		}

		if item.Dead {
			t.Fatal("pickup destroyed its target")
		}
	}

	t.Fatalf("pickup stalled: ship=%v item=%v speed=%g", ship.Position, item.Position, Vec.Length(ship.Velocity))
	return 0
}

func TestCollectionHatchOnlyOpensNearCargo(t *testing.T) {
	base := flightShip(t)

	for _, definition := range []string{"courser", "finch"} {
		t.Run(definition, func(t *testing.T) {
			ship := objects.CreatePlayerShip(base.World, objects.Properties{DefinitionID: definition})
			near := Vec.Add(ship.Position, Vec.Create(ship.Radius+50, 0))
			far := Vec.Add(ship.Position, Vec.Create(1000, 0))

			if !CollectionHatch(ship, near) || CollectionHatch(ship, far) {
				t.Fatal("doors must close during travel and open beside cargo")
			}

			inbound := Vec.Add(ship.Position, Vec.Create(ship.Radius+325, 0))

			if CollectionHatch(ship, inbound) {
				t.Fatal("stationary ships should keep their hatches closed away from cargo")
			}

			ship.Velocity = Vec.Create(300, 0)

			if !CollectionHatch(ship, inbound) {
				t.Fatal("fast approaches need time for hatch animation before arrival")
			}
		})
	}
}
