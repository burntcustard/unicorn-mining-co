package objects_test

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	testsupport "github.com/burntcustard/unicorn-mining-co/tests/support"
	"testing"
)

func TestIndividualHullRepair(t *testing.T) {
	catalog, err := testsupport.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := objects.NewShip("mustang", objects.Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
	health := ship.HullHealth()
	health[0], health[1] = 2.5, 10
	ship.SetHullHealth(health)
	credits := 100.0
	action := protocol.DockAction{Action: "repairHull", HullIndex: 0}

	if _, ok := ship.ApplyDockAction(action, &credits); !ok {
		t.Fatal("repair failed")
	}

	if credits != 94 || ship.HullHealth()[0] != 8 || ship.HullHealth()[1] != 10 {
		t.Fatal("repair changed wrong hull or charged wrong amount")
	}

	if _, ok := ship.ApplyDockAction(action, &credits); ok {
		t.Fatal("full-health repair accepted")
	}

	action.HullIndex = -1

	if _, ok := ship.ApplyDockAction(action, &credits); ok {
		t.Fatal("invalid hull accepted")
	}

	action.HullIndex, credits = 1, 0

	if _, ok := ship.ApplyDockAction(action, &credits); ok {
		t.Fatal("unaffordable repair accepted")
	}
}
