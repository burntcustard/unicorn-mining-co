package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"testing"
)

func TestMovementAcceleratesThroughBroadTurns(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)

	for _, angle := range []float64{-1, -0.6, 0, 0.6, 1} {
		thrust, turn := new(Pilot).Steer(ship, Movement{Position: Vec.Create(1000*math.Cos(angle), 1000*math.Sin(angle))})

		if thrust < 0.6 || angle*turn < 0 {
			t.Fatalf("broad turn %g stopped forward movement: thrust=%g turn=%g", angle, thrust, turn)
		}
	}
}

func TestCombatPassKeepsMovingAtCloseRange(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)
	thrust, turn := new(Pilot).Steer(ship, Movement{Position: Vec.Create(180, 0), PassDistance: 70})

	if thrust < 0.6 || turn <= 0 {
		t.Fatalf("combat ship parked instead of making a passing attack: thrust=%g turn=%g", thrust, turn)
	}
}

func TestNearestEnemySwitchesBetweenHostilePlayers(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	first := objects.CreatePlayerShip(world, objects.Properties{PlayerID: new(int64(2)), Position: Vec.Create(100, 0)})
	second := objects.CreatePlayerShip(world, objects.Properties{PlayerID: new(int64(3)), Position: Vec.Create(200, 0)})

	for _, other := range []*objects.Ship{ship, first, second} {
		simulation.AddEntity(world, other)
		simulation.AddPlayer(world, simulation.Player{ID: *other.PlayerID, ShipID: other.ID})
	}

	hostile := map[int64]bool{2: true, 3: true}

	if NearestEnemy(ship, hostile) != first {
		t.Fatal("did not choose the nearer hostile player")
	}

	second.Position.X = 50

	if NearestEnemy(ship, hostile) != second {
		t.Fatal("did not switch to a closer attacker")
	}

	first.Position.X = 25

	if NearestEnemy(ship, hostile) != first {
		t.Fatal("original victim was not compared with the attacker")
	}

	first.DockedTo = new(int64(99))

	if NearestEnemy(ship, hostile) != second {
		t.Fatal("docked player remained a combat target")
	}

	second.Position.X = 2000

	if NearestEnemy(ship, hostile) != nil || !hostile[3] {
		t.Fatal("an unseen enemy must retain hostility without revealing its position")
	}
}

func TestMovementAvoidsUncollectableCargo(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := objects.CreatePlayerShip(world, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)

	for range ship.CargoSpace {
		ship.CargoContents = append(ship.CargoContents, objects.NewItem("gold", simulation.ObjectProperties{World: world}, catalog))
	}

	item := objects.NewItem("gold", simulation.ObjectProperties{World: world, Position: Vec.Create(150, 0)}, catalog)
	simulation.AddEntity(world, item)
	_, turn := new(Pilot).Steer(ship, Movement{Position: Vec.Create(1000, 0)})

	if math.Abs(turn) < 0.1 {
		t.Fatal("full ship would drive through loose cargo")
	}
}
