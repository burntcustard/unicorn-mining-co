package objects

import (
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func flightFixture(t *testing.T) (*Ship, *simulation.World) {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	catalog.ModuleIDs = append(catalog.ModuleIDs, "testFlightMode")
	wreckage := false
	catalog.ModuleSpecs["testFlightMode"] = specs.Module{Behavior: "flightMode", FlightBoost: 1.3, ActivationDuration: .6, Health: 25, Mass: 1, DisablePhysics: true, PowerGenerated: 100, PowerCapacity: 100, Model: []specs.ModelPart{{Wreckage: &wreckage}}}
	definition := catalog.ShipSpecs["mustang"]
	health := 100.0

	definition.HullSegments = []specs.HullSegment{
		{Health: &health, Core: true, Points: []specs.Point{{-4, -4}, {4, -4}, {4, 4}, {-4, 4}}, Mounts: [][]specs.MountPoint{{{Fits: []string{"testFlightMode"}}}}},
		{Health: &health, Connections: []int{0}, FlightOffset: &[2]float64{-8, 10}, Points: []specs.Point{{-8, -24}, {0, -24}, {0, -16}, {-8, -16}}},
		{Health: &health, Connections: []int{0}, FlightOffset: &[2]float64{-8, -10}, Points: []specs.Point{{-8, 16}, {0, 16}, {0, 24}, {-8, 24}}},
		{Health: &health, Connections: []int{1}, Points: []specs.Point{{-24, -24}, {-16, -24}, {-16, -16}, {-24, -16}}, CollisionParts: [][][]float64{{{-24, -24}, {-16, -24}, {-16, -16}}, {{-24, -24}, {-16, -16}, {-24, -16}}}, Mounts: [][]specs.MountPoint{{{X: -24, Y: -20, Fits: []string{"thrusterSingleSm"}}}}},
		{Health: &health, Connections: []int{2}, Points: []specs.Point{{-24, 16}, {-16, 16}, {-16, 24}, {-24, 24}}, Mounts: [][]specs.MountPoint{{{X: -24, Y: 20, Fits: []string{"thrusterSingleSm"}}}}},
	}

	definition.InitialLoadout = []specs.InitialModule{{Mount: 0, Module: "testFlightMode"}, {Mount: 1, Module: "thrusterSingleSm"}, {Mount: 2, Module: "thrusterSingleSm"}}
	catalog.ShipSpecs["testFlightModeShip"] = definition
	world := simulation.CreateWorld(25, catalog)
	return CreatePlayerShip(world, Properties{DefinitionID: "testFlightModeShip"}), world
}

func flightHull(ship *Ship, index int) *simulation.Segment {
	for _, segment := range ship.Segments {
		if segment.HullPlan == ship.HullSegments[index] {
			return segment
		}
	}

	return nil
}

func nearFlight(t *testing.T, actual, expected float64) {
	t.Helper()

	if math.Abs(actual-expected) > 1e-9 {
		t.Fatalf("%g != %g", actual, expected)
	}
}

func TestFlightModeMovesHullsMountsAndColliders(t *testing.T) {
	ship, _ := flightFixture(t)
	before := ship.HitboxColliding()
	positions := make([]Vec.Vector, len(before))

	for i, collider := range before {
		positions[i] = collider.Position
	}

	source := ship.GeometrySource()
	outline := flightHull(ship, 3).Points
	points := slices.Clone(outline.Points)
	ship.SetModuleActive("flightMode", true)
	ship.UpdateModules(.3)

	for _, index := range []int{1, 3} {
		if flightHull(ship, index).LocalPosition != Vec.Create(-4, 5) {
			t.Fatal("left root and descendant did not share the half-fold pose")
		}
	}

	for _, index := range []int{2, 4} {
		if flightHull(ship, index).LocalPosition != Vec.Create(-4, -5) {
			t.Fatal("right root and descendant did not share the mirrored half-fold pose")
		}
	}

	if flightHull(ship, 0).LocalPosition != (Vec.Vector{}) || ship.Mounts()[1].LocalPosition != Vec.Create(-28, -15) {
		t.Fatal("folding moved the center or lost the authored mount position")
	}

	for _, segment := range ship.SegmentsAtMount(ship.Mounts()[1]) {
		if segment.LocalPosition != ship.Mounts()[1].LocalPosition {
			t.Fatal("fitted thruster did not follow its moving mount")
		}
	}

	for index, collider := range ship.HitboxColliding() {
		segment := collider.Segment.(*simulation.Segment)
		nearFlight(t, collider.Position.X, positions[index].X+segment.LocalPosition.X)
		nearFlight(t, collider.Position.Y, positions[index].Y+segment.LocalPosition.Y)
	}

	if source == ship.GeometrySource() || flightHull(ship, 3).Points != outline || !slices.Equal(points, outline.Points) {
		t.Fatal("pose update did not invalidate fixtures or mutated authored hull geometry")
	}

	for range 3 {
		ship.SetModuleActive("flightMode", false)
		ship.UpdateModules(.6)

		if flightHull(ship, 3).LocalPosition != (Vec.Vector{}) || ship.Mounts()[1].LocalPosition != Vec.Create(-24, -20) {
			t.Fatal("reversing flight mode accumulated an offset")
		}

		ship.SetModuleActive("flightMode", true)
		ship.UpdateModules(.6)
	}
}

func TestFlightModeHydrationRepairAndFrozenFragments(t *testing.T) {
	ship, world := flightFixture(t)
	ship.SetModuleActive("flightMode", true)
	ship.UpdateModules(.3)
	states := ship.ModuleStates()
	restored := CreatePlayerShip(world, Properties{DefinitionID: "testFlightModeShip"})
	restored.SetModuleStates(states)

	if flightHull(restored, 3).LocalPosition != Vec.Create(-4, 5) || restored.Mounts()[1].LocalPosition != Vec.Create(-28, -15) {
		t.Fatal("module hydration did not immediately restore the moving hull and mount pose")
	}

	saved, err := RestoreShip(CaptureShip(ship), world, 7)

	if err != nil || flightHull(saved, 3).LocalPosition != Vec.Create(-4, 5) {
		t.Fatalf("persistent controller progress did not restore the pose: %v", err)
	}

	checkpoint, err := RestoreEntity(CaptureEntity(ship), world)

	if err != nil || flightHull(checkpoint.(*Ship), 3).LocalPosition != Vec.Create(-4, 5) {
		t.Fatalf("simulation checkpoint did not restore the pose: %v", err)
	}

	health := ship.HullHealth()
	broken := slices.Clone(health)
	broken[3] = 0
	ship.SetHullHealth(broken)
	ship.SetHullHealth(health)

	if flightHull(ship, 3).LocalPosition != Vec.Create(-4, 5) {
		t.Fatal("repair did not restore the current fold pose")
	}

	ship.Fit(modules.Create("thrusterSingleSm", simulation.ObjectProperties{World: world}, world.Specification), ship.Mounts()[1])

	if ship.SegmentsAtMount(ship.Mounts()[1])[0].LocalPosition != Vec.Create(-28, -15) {
		t.Fatal("refitting a repaired mount lost the active fold offset")
	}

	wing := flightHull(ship, 3)
	origin := centerOf([]*simulation.Segment{wing})
	fragment := ship.Spawn(origin, []*simulation.Segment{wing}, nil, nil, Vec.Vector{})
	position := fragment.Segments[0].LocalPosition
	fragment.UpdateModules(1)

	if fragment.HullSegments[0].FlightOffset != nil || fragment.Segments[0].LocalPosition != position {
		t.Fatal("detached hull fragments must freeze their current pose")
	}

	nearFlight(t, fragment.Position.X, ship.Position.X+origin.X)
	nearFlight(t, fragment.Position.Y, ship.Position.Y+origin.Y)
	ship.Mounts()[0].Health = 0
	ship.UpdateModules(0)

	if flightHull(ship, 3).LocalPosition != (Vec.Vector{}) || ship.flightBoostFactor() != 1 {
		t.Fatal("a destroyed flight controller still moved or boosted the ship")
	}
}

func TestFlightModeBoostsMovementWithoutIncreasingFuel(t *testing.T) {
	normal, _ := flightFixture(t)
	boosted, _ := flightFixture(t)
	boosted.SetModuleActive("flightMode", true)
	boosted.UpdateModules(.6)
	nearFlight(t, boosted.ForwardThrust(), normal.ForwardThrust()*1.3)
	nearFlight(t, boosted.RotationalThrust(), normal.RotationalThrust()*1.3)
	nearFlight(t, boosted.MaxSpeed(), normal.MaxSpeed()*1.3)
	nearFlight(t, boosted.MaximumTurnRate(), normal.MaximumTurnRate()*1.3)
	normal.Fly(1, 1)
	boosted.Fly(1, 1)
	normal.Update(1.0 / 60)
	boosted.Update(1.0 / 60)

	if math.Abs(math.Hypot(boosted.Velocity.X, boosted.Velocity.Y)-math.Hypot(normal.Velocity.X, normal.Velocity.Y)*1.3) > 1e-7 || math.Abs(boosted.Spin-normal.Spin*1.3) > 1e-7 {
		t.Fatal("flight mode did not increase actual acceleration and turning by its boost, within the motion rounding grid")
	}

	nearFlight(t, boosted.Fuel, normal.Fuel)
	var events []protocol.SimulationEvent
	normal.Control(protocol.Input{FlightMode: true}, &events)

	if !normal.ModuleActive("flightMode") {
		t.Fatal("flight-mode input did not activate its fitted controller")
	}

	normal.UpdateModules(.3)
	nearFlight(t, normal.flightBoostFactor(), 1.15)
	normal.Control(protocol.Input{}, &events)
	normal.UpdateModules(.15)
	nearFlight(t, normal.flightBoostFactor(), 1.075)
}

func TestFlightControllerDetachesWithoutInvisibleWreckage(t *testing.T) {
	ship, world := flightFixture(t)
	ship.SetModuleActive("flightMode", true)
	ship.UpdateModules(.6)
	before := world.Entities.Len()
	ship.Detach(ship.Mounts()[0])

	if world.Entities.Len() != before || ship.Mounts()[0].Module != nil || flightHull(ship, 3).LocalPosition != (Vec.Vector{}) {
		t.Fatal("detaching the state-only controller spawned phantom wreckage or retained its fold")
	}
}

func TestCannonBarrelsTelescopeWithShipOverride(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, id := range []string{"crescent", "courser"} {
		t.Run(id, func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			ship := CreatePlayerShip(world, Properties{DefinitionID: id})

			if id == "crescent" {
				for range 2 {
					ship.Fit(modules.Create("cannonSm", simulation.ObjectProperties{World: world}, catalog), nil)
				}
			}

			travel := *catalog.ShipSpecs[id].WeaponRetractionDistance

			check := func(progress float64) {
				t.Helper()
				count := 0

				for _, part := range ship.Segments {
					if part.Module == nil || part.Module.ModuleBase().Type != "cannonSm" {
						continue
					}

					count++
					nearFlight(t, part.ActivationProgress, progress)
					outline := part.Outline().Points
					nearFlight(t, outline[0][0], 0)
					nearFlight(t, outline[1][0], 26-travel*(1-progress))

					if id == "crescent" && progress == 0 {
						for _, point := range outline {
							if math.Abs(point[0]+part.LocalPosition.X)+math.Abs(point[1]+part.LocalPosition.Y) > 16 {
								t.Fatal("retracted cannon protrudes from the center square")
							}
						}
					}
				}

				if count != 2 {
					t.Fatalf("expected two cannon barrels, got %d", count)
				}
			}

			check(0)
			duration := catalog.ModuleSpecs["cannonSm"].ActivationDuration
			ship.SetModuleActive("cannonSm", true)
			ship.UpdateModules(duration / 2)
			check(.5)
			ship.SetModuleActive("cannonSm", false)
			ship.UpdateModules(duration / 2)
			check(0)
			ship.SetModuleActive("cannonSm", true)
			ship.UpdateModules(duration)
			check(1)
			ship.SetModuleActive("cannonSm", false)
			ship.UpdateModules(duration)
			check(0)
		})
	}
}

func TestFlightControllerHasNoDamageableBodyOrMass(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "crescent"})
	mount := ship.Mounts()[3]
	mass := ship.Mass

	if catalog.ModuleSpecs["flightMode"].Mass != 0 || catalog.ModuleSpecs["flightMode"].Health != 0 {
		t.Fatal("flight controller must have no mass or damageable body")
	}

	if Damage(ship.SegmentsAtMount(mount)[0], 100) != 0 {
		t.Fatal("inactive controller took damage")
	}

	Damage(mount.Hull, 1)
	ship.SetModuleActive("flightMode", true)
	ship.UpdateModules(1)

	if !ship.ModuleActive("flightMode") || ship.flightBoostFactor() != 1.3 || Damage(ship.SegmentsAtMount(mount)[0], 100) != 0 {
		t.Fatal("healthless controller must activate and remain immune to damage")
	}

	for _, oldHealth := range []float64{0, 25} {
		states := ship.ModuleStates()

		for i := range states {
			if states[i].Mount == 3 {
				states[i].Health = &oldHealth
			}
		}

		ship.SetModuleStates(states)

		if !ship.ModuleActive("flightMode") || Damage(ship.SegmentsAtMount(mount)[0], 100) != 0 {
			t.Fatal("old saved health must not make the controller damageable or disable it")
		}
	}

	ship.Fit(nil, mount)
	nearFlight(t, ship.Mass, mass)
}
