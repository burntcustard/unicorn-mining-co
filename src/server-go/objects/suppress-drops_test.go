package objects

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server-go/simulation"
)

func TestSuppressDropsRemovesDestroyedCrescentWithoutLoot(t *testing.T) {
	ship, world := npcShipFixture("crescent")
	ship.SuppressDrops = true
	ship.CargoContents = append(ship.CargoContents, NewItem("gold", simulation.ObjectProperties{World: world}, world.Specification))
	before := len(world.Entities.Values())
	Damage(hullAt(ship, 1), 10000)
	ship.Update(0)

	if !ship.Dead || world.Entities.Has(ship.ID) || len(world.Entities.Values()) != before-1 || len(ship.CargoContents) != 0 {
		t.Fatal("destroyed no-drop ship must leave neither hull fragments, fitted modules nor carried cargo")
	}
}

func TestSuppressDropsDiscardsDetachedModulesAndHulls(t *testing.T) {
	ship, world := npcShipFixture("crescent")
	ship.SuppressDrops = true
	count := len(world.Entities.Values())
	mount := ship.Mounts()[0]
	ship.Detach(mount)

	if mount.Module != nil || len(world.Entities.Values()) != count || len(ship.CargoContents) != 0 {
		t.Fatal("damaged equipment must detach without spawning debris or becoming cargo")
	}

	if fragments := ship.Fracture([]*simulation.Segment{hullAt(ship, 1)}, true, true); len(fragments) != 0 || len(world.Entities.Values()) != count {
		t.Fatal("broken hull must not create fragments")
	}
}
