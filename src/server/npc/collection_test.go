package npc

import (
	"encoding/json"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/gameplay"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"os"
	"slices"
	"testing"
)

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

/*
The station's forecast radius must not impose its docking speed on clear cargo
hundreds of units outside the hull. Keep the real station, hatches and contacts.
*/
func TestCollectionOutsideStationUsesFullEngine(t *testing.T) {
	for _, definition := range []string{"courser", "finch"} {
		t.Run(definition, func(t *testing.T) {
			ship := arrivalShip(t, definition)
			ship.Position = Vec.Create(850, 0)
			ship.Face(math.Pi / 2)
			collectionThroat(t, ship)
			station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.)}}, ship.Catalog)
			simulation.AddEntity(ship.World, station)
			contacts := &stationWallContacts{GameCollisions: gameplay.NewGameCollisions(ship.Catalog), ship: ship.ID, station: station.ID}
			ship.World.Collisions = contacts
			var centers [4]Vec.Vector
			center := collectionCenters(ship, centers[:0])[0]
			position := Vec.Add(ship.Position, simulation.RotatePoint(Vec.Add(center, Vec.Create(350, 0)), ship.Rotation))
			item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: position, Rotation: math.Pi / 2}, ship.Catalog)
			simulation.AddEntity(ship.World, item)
			pilot := &Pilot{}
			health := ship.HullHealthTotal()
			thrust, _ := pilot.Steer(ship, Movement{Position: item.Position, IgnoreID: item.ID, Collect: true})

			if thrust < .999 {
				t.Fatalf("clear aligned pickup limited the engine to %g", thrust)
			}

			elapsed, _ := collectOneItem(t, ship, item, pilot)

			if contacts.touches > 0 {
				t.Errorf("pickup touched station wall %d times, first point=%v", contacts.touches, contacts.first.Point)
			}

			if elapsed > 4 || ship.HullHealthTotal() != health {
				t.Fatalf("clear station pickup was slow or damaged its ship: seconds=%g health=%g/%g", elapsed, ship.HullHealthTotal(), health)
			}
		})
	}
}

/*
Cargo can settle inside the station's broad object radius while remaining
outside every wall. A reserved docking circle must not make it unreachable.
*/
func TestCollectionReachesCargoInsideBroadStationRadius(t *testing.T) {
	for _, definition := range []string{"courser", "finch"} {
		for _, rotation := range []float64{0, -.4, .4} {
			t.Run(fmt.Sprintf("%s/rotation%g", definition, rotation), func(t *testing.T) {
				ship := arrivalShip(t, definition)
				ship.Position = Vec.Create(550, 0)
				ship.Face(math.Pi)
				collectionThroat(t, ship)
				station := objects.CreateStation(objects.Properties{DefinitionID: "corral-5", ObjectProperties: simulation.ObjectProperties{World: ship.World, ID: new(int64(100)), Radius: new(400.), Rotation: rotation}}, ship.Catalog)
				simulation.AddEntity(ship.World, station)
				contacts := &stationWallContacts{GameCollisions: gameplay.NewGameCollisions(ship.Catalog), ship: ship.ID, station: station.ID}
				ship.World.Collisions = contacts
				item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(350, 0)}, ship.Catalog)
				simulation.AddEntity(ship.World, item)
				health := ship.HullHealthTotal()
				elapsed, _ := collectOneItem(t, ship, item, &Pilot{})

				if contacts.touches > 0 {
					t.Errorf("pickup touched station wall %d times, first point=%v", contacts.touches, contacts.first.Point)
				}

				if ship.HullHealthTotal() != health || ship.DockedTo != nil {
					t.Fatalf("cargo beside the physical hull was not reached safely: seconds=%g health=%g/%g docked=%v", elapsed, ship.HullHealthTotal(), health, ship.DockedTo)
				}

				t.Logf("collected cargo outside the station walls in %.2fs", elapsed)
			})
		}
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

func TestCollectionHatchOpensBeforePickupForecast(t *testing.T) {
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

			if !CollectionHatch(ship, inbound) {
				t.Fatal("pickup forecasts need unfolded hatches before the approach begins")
			}

			ship.Velocity = Vec.Create(300, 0)

			if !CollectionHatch(ship, inbound) {
				t.Fatal("fast approaches need time for hatch animation before arrival")
			}
		})
	}
}

func TestCollectionWigglesThenRetriesWithoutAnEscape(t *testing.T) {
	ship := arrivalShip(t, "courser")
	collectionThroat(t, ship)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(16, 0), Rotation: 2}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	pilot := &Pilot{}
	destination := Movement{Position: item.Position, IgnoreID: item.ID, Collect: true}
	pilot.Steer(ship, destination)
	turns := []float64{}

	for _, elapsed := range []float64{.7, 1.1} {
		ship.World.Tick = uint64(math.Ceil(elapsed / ship.Catalog.Simulation.SimulationStep))
		thrust, turn := pilot.Steer(ship, destination)

		if thrust != 0 || turn == 0 {
			t.Fatalf("jam recovery did not wiggle without an engine impulse: thrust=%g turn=%g", thrust, turn)
		}

		turns = append(turns, turn)
	}

	if turns[0]*turns[1] >= 0 {
		t.Fatal("jam recovery kept turning in one direction")
	}

	ship.World.Tick = uint64(math.Ceil(2.1 / ship.Catalog.Simulation.SimulationStep))
	thrust, _ := pilot.Steer(ship, destination)

	if thrust <= 0 {
		t.Fatal("jam recovery never retried the pickup")
	}
}

func TestCollectionWiggleDoesNotFlingMovingCargo(t *testing.T) {
	ship := arrivalShip(t, "courser")
	collectionThroat(t, ship)
	ship.Velocity = Vec.Create(180, 0)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: ship.World, Position: Vec.Create(16, 0), Velocity: Vec.Clone(ship.Velocity), Rotation: 2}, ship.Catalog)
	simulation.AddEntity(ship.World, item)
	pilot := &Pilot{collection: collectionProgress{itemID: item.ID}}
	step := ship.Catalog.Simulation.SimulationStep
	ship.World.Tick = uint64(math.Ceil(.6 / step))
	maximum := Vec.Length(item.Velocity)
	health := ship.HullHealthTotal()

	for range int(.8 / step) {
		turn, wiggling := pilot.collectionWiggle(ship, nil)

		if !wiggling {
			break
		}

		ship.Fly(0, turn)
		simulation.UpdateWorld(ship.World, simulation.UpdateWorldOptions{})
		maximum = max(maximum, Vec.Length(item.Velocity))

		if slices.Contains(ship.CargoContents, simulation.Entity(item)) {
			break
		}
	}

	if maximum > 200 || item.Dead || ship.HullHealthTotal() != health {
		t.Fatalf("wiggling struck or flung wedged cargo: maximum speed=%g item dead=%v hull=%g/%g", maximum, item.Dead, ship.HullHealthTotal(), health)
	}
}
