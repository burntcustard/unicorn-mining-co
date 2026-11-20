package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server-go/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server-go/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server-go/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server-go/vector"
	"slices"
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

func TestAlienShipPower(t *testing.T) {
	for _, id := range []string{"crescent"} {
		t.Run(id, func(t *testing.T) {
			ship, _ := npcShipFixture(id)
			ship.Fly(1, 1)
			ship.Firing = true

			if ship.PowerCapacity() <= 0 || ship.StoredPower != ship.PowerCapacity() {
				t.Fatal("alien ship must start with a charged power plant")
			}

			if ship.PowerGeneration() < ship.PowerUsage() {
				t.Fatal("power plant must support the ship's engines and weapon")
			}

			ship.StoredPower = 0
			ship.UpdatePower(1)

			if ship.ThrusterPower != 1 || ship.SystemsPower != 1 || ship.ForwardThrust() <= 0 {
				t.Fatal("alien ship must operate on its plant without stored power")
			}
		})
	}
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

func TestCrescentCurvedWreckage(t *testing.T) {
	ship, world := npcShipFixture("crescent")
	wing := hullAt(ship, 1)
	fragments := ship.Fracture([]*simulation.Segment{wing}, true, true)

	if len(fragments) != 1 {
		t.Fatal("a broken crescent wing must produce debris")
	}

	fragment := fragments[0]
	wreckage := fragment.Wreckage()

	if len(wreckage) != 1 || len(wreckage[0].ShapeOutline) <= 12 || !slices.Equal(wreckage[0].ShapeOutline, wing.Outline().Points) {
		t.Fatal("wing debris must retain the sampled curved outline")
	}

	restored := CreateWreckage(Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, wreckage, ship.Catalog)

	if len(fragment.Hitbox()) < 2 || len(restored.Hitbox()) != len(fragment.Hitbox()) {
		t.Fatal("wing debris must retain its compound collision geometry after restoration")
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

func TestOwnedCrescentControl(t *testing.T) {
	for _, id := range []string{"crescent"} {
		ship, _ := npcShipFixture(id)
		ship.PlayerID = new(int64(1))
		events := []protocol.SimulationEvent{}
		ship.Control(protocol.Input{Thrust: 1, Fire: true, FlightMode: true}, &events)

		if ship.Forward != 1 || !ship.Firing || id == "crescent" && !ship.ModuleActive("flightMode") {
			t.Fatal("owned ships must accept normal player controls", id)
		}

		credits := 1000.0

		if _, ok := ship.ApplyDockAction(protocol.DockAction{Action: "paint", Paint: 1}, &credits); !ok || !slices.Equal(ship.Shades, ship.Catalog.PaintColors[1]) {
			t.Fatal("owned ships must accept normal player customization", id)
		}
	}

}
