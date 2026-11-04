package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

func npcShipFixture(id string) (*Ship, *simulation.World) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(1, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: id})
	simulation.AddEntity(world, ship)
	return ship, world
}

func hullAt(ship *Ship, index int) *simulation.Segment {
	for _, segment := range ship.Segments {
		if segment.HullPlan == ship.HullSegments[index] {
			return segment
		}
	}

	return nil
}

func TestCrescentEssentialSides(t *testing.T) {
	for _, side := range []int{1, 2} {
		ship, _ := npcShipFixture("crescent")
		Damage(hullAt(ship, side), 10000)
		ship.Update(0)

		if !ship.Dead {
			t.Fatal("losing either side must destroy the crescent")
		}
	}
}

func TestFloatingHullConnections(t *testing.T) {
	ship, _ := npcShipFixture("crystal")
	Damage(hullAt(ship, 4), 10000)
	ship.Update(0)

	if ship.Dead || len(ship.HullHealth()) != 8 {
		t.Fatal("a floating side must detach without losing the core")
	}

	for _, index := range []int{0, 1, 2, 3, 5, 7} {
		if hullAt(ship, index) == nil {
			t.Fatal("unrelated floating pieces must stay attached")
		}
	}
}

func TestCrescentYellowCutouts(t *testing.T) {
	for _, index := range []int{3, 4, 5, 6} {
		ship, world := npcShipFixture("crescent")
		observer := CreatePlayerShip(world, Properties{})
		insert := hullAt(ship, index)
		center := Vec.Vector{}
		outline := insert.Points.Points

		for _, point := range outline {
			center = Vec.Add(center, Vec.Create(point[0]/float64(len(outline)), point[1]/float64(len(outline))))
		}

		end := Vec.Add(center, Vec.Create(0.1, 0))
		first, _ := observer.traceLaser(center, end)

		if first == nil || first.Segment != insert {
			t.Fatal("yellow pieces must occupy cutouts without underlying wing collisions")
		}

		Damage(insert, 10000)
		first, _ = observer.traceLaser(center, end)

		if first != nil {
			t.Fatal("removing a yellow piece must leave an open notch")
		}
	}
}

func TestCrescentColoredSections(t *testing.T) {
	for _, index := range []int{5, 6, 7, 8, 9, 10} {
		ship, _ := npcShipFixture("crescent")
		part := hullAt(ship, index)
		engines := len(ship.Engines())
		carriesEngine := len(part.Mounts) > 0
		Damage(part, 10000)
		ship.Update(0)

		if ship.Dead || hullAt(ship, index) != nil {
			t.Fatal("colored sections must detach independently without losing the main structure")
		}

		if carriesEngine {
			engines--
		}

		if len(ship.Engines()) != engines {
			t.Fatal("a broken engine section must lose only its own thruster")
		}
	}
}

func TestCrystalHullColliders(t *testing.T) {
	ship, _ := npcShipFixture("crystal")
	colliders := ship.Hitbox()

	for _, segment := range ship.Segments {
		if !segment.Hull || segment.HullPlan != ship.HullSegments[0] {
			continue
		}

		count := 0

		for _, collider := range colliders {
			if collider.Segment == segment {
				count++
			}
		}

		if count != 1 {
			t.Fatal("the main Crystal hull must use one regular collider")
		}
	}
}

func TestCrystalConvergenceDamage(t *testing.T) {
	for _, rotation := range []float64{0, math.Pi / 2, math.Pi} {
		for lost := 0; lost <= 2; lost++ {
			ship, world := npcShipFixture("crystal")
			ship.Rotation, ship.Firing = rotation, true

			for index := 0; index < lost; index++ {
				Damage(hullAt(ship, index+2), 10000)
			}

			health := 100.0
			target := NewItem("gold", simulation.ObjectProperties{World: world, Position: simulation.RotatePoint(Vec.Create(150, 0), rotation), Health: &health}, world.Specification)
			simulation.AddEntity(world, target)
			events := []protocol.SimulationEvent{}
			ship.ResolveLasers(1.0/30, &events)
			expected := ship.CrystalWeapon.Damage * (1 - float64(lost)*0.25)

			if math.Abs(100-target.Health-expected) > 1e-8 {
				t.Fatalf("lost %d: damage %g, want %g", lost, 100-target.Health, expected)
			}
		}
	}
}

func TestCrystalBlockedFeeder(t *testing.T) {
	ship, world := npcShipFixture("crystal")
	ship.Firing = true
	health := 100.0
	start := ship.CrystalWeapon.Emitters[1].Position
	junction := ship.CrystalWeapon.Junction
	position := Vec.Create((start[0]+junction[0])/2, (start[1]+junction[1])/2)
	target := NewItem("gold", simulation.ObjectProperties{World: world, Position: position, Health: &health}, world.Specification)
	simulation.AddEntity(world, target)
	beams := ship.crystalBeams()

	if beams[0].fraction != 0.75 || beams[1].first == nil || beams[1].first.Owner != target {
		t.Fatal("a blocked feeder must stop and stop strengthening the main beam")
	}

	events := []protocol.SimulationEvent{}
	ship.ResolveLasers(1.0/30, &events)

	if math.Abs(100-target.Health-ship.CrystalWeapon.Damage*0.25) > 1e-8 {
		t.Fatal("feeder damage must be one quarter")
	}
}

func TestMantaTailAndEngines(t *testing.T) {
	ship, world := npcShipFixture("manta")
	ship.Hitbox()
	tip := hullAt(ship, 6)
	before := tip.Collider.Position
	world.Tick = 13
	ship.Hitbox()

	if Vec.Distance(before, tip.Collider.Position) < 0.1 || len(tip.PartColliders) != 1 {
		t.Fatal("the tail's tapered rectangle must follow its animation")
	}

	if len(tip.Points.Points) != 4 || tip.VisualOutline == nil || len(tip.VisualOutline.Points) <= 4 {
		t.Fatal("rectangular collision and curved tail surfaces must be separate")
	}

	thrust := ship.ForwardThrust()
	engines := ship.Engines()

	if len(engines) != 2 {
		t.Fatal("manta must have two engines")
	}

	engines[0].ModuleBase().Mount.Health = 0

	if ship.ForwardThrust() != thrust/2 {
		t.Fatal("losing an engine must remove its thrust")
	}

	Damage(tip, 10000)
	ship.Update(0)

	if ship.Dead || hullAt(ship, 7) != nil {
		t.Fatal("a broken tail must detach its tip while leaving the manta alive")
	}

	curvedDebris := false

	world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		if craft, ok := entity.(*Craft); ok && craft.Decay > 0 {
			for _, segment := range craft.Segments {
				curvedDebris = curvedDebris || segment.Points != nil && len(segment.Points.Points) > 4
			}
		}
	})

	if !curvedDebris {
		t.Fatal("severed tail debris must retain its curved surface")
	}
}

func TestNPCOnlyControlAndCrystalPower(t *testing.T) {
	ship, _ := npcShipFixture("crystal")
	ship.PlayerID = new(int64(1))
	events := []protocol.SimulationEvent{}
	ship.Control(protocol.Input{Thrust: 1, Fire: true}, &events)

	if ship.Forward != 0 || ship.Firing {
		t.Fatal("player controls must not pilot NPC-only ships")
	}

	credits := 1000.0

	if _, ok := ship.ApplyDockAction(protocol.DockAction{Action: "paint"}, &credits); ok {
		t.Fatal("NPC-only ships must not accept player customization")
	}

	ship.Firing = true

	if ship.PowerUsage() <= 0 {
		t.Fatal("firing must consume power")
	}

	for _, mount := range ship.Mounts() {
		if mount.Module != nil && mount.Module.ModuleBase().Spec.PowerGenerated > 0 {
			mount.Health = 0
		}
	}

	ship.StoredPower = 0
	ship.UpdatePower(1.0 / 30)

	if len(ship.crystalBeams()) != 0 {
		t.Fatal("an unpowered crystal weapon must not fire")
	}
}

func TestMantaWingCutouts(t *testing.T) {
	ship, world := npcShipFixture("manta")
	observer := CreatePlayerShip(world, Properties{})
	insert := hullAt(ship, 8)
	outline := insert.CollisionParts[0]
	center := Vec.Vector{}

	for _, point := range outline {
		center = Vec.Add(center, Vec.Create(point[0]/float64(len(outline)), point[1]/float64(len(outline))))
	}

	end := Vec.Add(center, Vec.Create(0.1, 0))
	first, _ := observer.traceLaser(center, end)

	if first == nil || first.Segment != insert {
		t.Fatal("shots inside a cyan inset must hit the inset, not the wing")
	}

	Damage(insert, 10000)
	first, _ = observer.traceLaser(center, end)

	if first != nil {
		t.Fatal("destroying the inset must reveal a physical hole in the wing")
	}
}
