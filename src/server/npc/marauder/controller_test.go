package marauder

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/npc/testhost"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func fixture(t *testing.T) (*Manager, *testhost.Host, *testhost.Human) {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	host := testhost.New(25, catalog)
	player := host.AddPlayer()
	player.Craft.Position = Vec.Create(60000, 0)
	manager := New(host)
	host.Dispatch, host.Before = manager.Dispatch, manager.Update
	return manager, host, player
}

func ping(m *Manager) {
	m.World.Tick = m.CheckAt
	m.Dispatch()
}

func TestConsecutivePingsAndRepeatedSpawns(t *testing.T) {
	m, _, player := fixture(t)
	m.Dispatch()

	if len(m.Marauders) != 0 || len(m.Seen) != 0 {
		t.Fatal("first check must wait five minutes")
	}

	ping(m)

	if len(m.Marauders) != 0 {
		t.Fatal("one ping must not spawn a marauder")
	}

	player.Craft.Position = Vec.Create(36000, 48000)
	ping(m)

	if len(m.Marauders) != 1 {
		t.Fatal("two consecutive qualifying pings must spawn")
	}

	npc := m.Marauders[0]

	if npc.Destination != player.Craft.Position || npc.ship.Position != Vec.Create(39000, 52000) {
		t.Fatal("spawn must extend the second ping's radial line by 5000")
	}

	if npc.ship.DefinitionID != "crescent" || npc.ship.DockedTo != nil || npc.ship.Launching != 0 || !npc.ship.ModuleActive("flightMode") {
		t.Fatal("must spawn a flying crescent in space")
	}

	ping(m)

	if len(m.Marauders) != 2 {
		t.Fatal("existing marauders must not prevent another spawn")
	}

	player.Craft.Position = Vec.Create(30000, 40000)
	ping(m)
	player.Craft.Position.X++
	ping(m)

	if len(m.Marauders) != 2 {
		t.Fatal("a ping at exactly 50000 must break consecutive eligibility")
	}

	ping(m)

	if len(m.Marauders) != 3 {
		t.Fatal("two new outer pings must spawn again")
	}
}

func TestOnlyActiveHumansTriggerPings(t *testing.T) {
	for _, kind := range []string{"docked", "dead", "disconnected", "transiting", "unobserved", "absent"} {
		t.Run(kind, func(t *testing.T) {
			m, _, p := fixture(t)
			ping(m)

			switch kind {
			case "docked":
				id := int64(12)
				p.Craft.DockedTo = &id
			case "dead":
				p.Craft.Dead = true
			case "disconnected":
				p.Online = false
			case "transiting":
				p.Craft.TransitTime = -1
			case "unobserved":
				m.World.Players.Delete(p.ID)
			case "absent":
				m.World.Entities.Delete(p.Craft.ID)
			}

			ping(m)

			if len(m.Marauders) != 0 || len(m.Seen) != 0 {
				t.Fatal("inactive players must not qualify or retain a ping")
			}
		})
	}

	m, _, p := fixture(t)
	p.Online = false
	npc := m.spawn(p.Craft.Position)

	m.OtherShips = func(visit func(*objects.Ship)) { visit(npc.ship) }

	ping(m)
	ping(m)

	if len(m.Marauders) != 1 || len(m.Seen) != 0 {
		t.Fatal("NPCs must not cause spawns")
	}
}

func TestCombatPauseAndTargetLoss(t *testing.T) {
	m, _, p := fixture(t)
	npc := m.spawn(Vec.Create(60000, 0))
	npc.ship.Position = Vec.Create(60500, 0)
	npc.ship.Rotation = math.Pi
	npc.ship.Velocity = Vec.Create(-100, 10)
	m.World.Tick = 100
	input := m.inputFor(npc)

	if input.Thrust != 0 || input.Turn != 0 || input.Fire || !input.FlightMode || npc.State != "Preparing" {
		t.Fatal("combat must start with a coasting one-second pause in flight mode")
	}

	m.World.Tick = npc.CombatAt - 1
	input = m.inputFor(npc)

	if input.Thrust != 0 || input.Turn != 0 || input.Fire || !input.FlightMode {
		t.Fatal("pause must last the full second")
	}

	m.World.Tick++
	input = m.inputFor(npc)

	if input.FlightMode || !input.Fire || input.TargetID == nil || *input.TargetID != p.Craft.ID {
		t.Fatal("after the pause it must transform and attack the target")
	}

	var events []protocol.SimulationEvent
	npc.ship.Control(input, &events)

	if npc.ship.ModuleActive("flightMode") || !npc.ship.Firing {
		t.Fatal("combat input must operate the actual ship")
	}

	lastSeen := p.Craft.Position
	npc.Visited = true
	p.Craft.TransitTime = -1
	p.Craft.Position.X += 20000
	input = m.inputFor(npc)

	if !input.FlightMode || input.Fire || npc.TargetID != 0 || npc.CombatAt != 0 {
		t.Fatal("portal transit must lose the target and restore flight mode")
	}

	if npc.Search.Origin != lastSeen || npc.State != "Search" {
		t.Fatal("losing a target must search its last visible position, without tracking portal travel")
	}

	if npc.Destination != Vec.Create(60000, 0) {
		t.Fatal("combat must not overwrite the original destination")
	}
}

func TestTargetsHumansPiratesAndCollectorsButNotMarauders(t *testing.T) {
	m, _, p := fixture(t)
	npc := m.spawn(p.Craft.Position)
	npc.ship.Position = Vec.Create(60200, 0)
	others := []*objects.Ship{}

	for _, name := range []string{"pirate", "collector"} {
		ship := objects.CreatePlayerShip(m.World, objects.Properties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(60100, 0), Name: &name}})
		simulation.AddEntity(m.World, ship)
		others = append(others, ship)
	}

	m.OtherShips = func(visit func(*objects.Ship)) {
		for _, ship := range others {
			visit(ship)
		}
	}

	if target := m.target(npc); target != others[0] {
		t.Fatal("must acquire the closest visible pirate")
	}

	npc.TargetID = p.Craft.ID

	if target := m.target(npc); target != p.Craft {
		t.Fatal("must retain its visible human target even when another ship is nearer")
	}

	p.Online = false
	others[0].Dead = true

	if target := m.target(npc); target != others[1] {
		t.Fatal("must acquire collectors when earlier targets become invalid")
	}

	others[1].Dead = true
	m.spawn(npc.ship.Position)

	if target := m.target(npc); target != nil {
		t.Fatal("marauders must not target each other")
	}
}

func TestDespawnRequiresOriginalVisitAndActiveHumanProximity(t *testing.T) {
	for _, kind := range []string{"outside", "docked", "dead", "disconnected", "transiting", "active"} {
		t.Run(kind, func(t *testing.T) {
			m, _, p := fixture(t)
			npc := m.spawn(Vec.Create(60000, 0))
			p.Craft.Position = Vec.Create(66000, 0)
			m.Update()

			if len(m.Marauders) != 1 {
				t.Fatal("must visit the saved location before despawning")
			}

			npc.ship.Position = npc.Destination
			p.Craft.Position = Vec.Create(65000, 0)

			switch kind {
			case "outside":
				p.Craft.Position.X++
			case "docked":
				id := int64(12)
				p.Craft.DockedTo = &id
			case "dead":
				p.Craft.Dead = true
			case "disconnected":
				p.Online = false
			case "transiting":
				p.Craft.TransitTime = 1
			}

			m.Update()

			if kind == "active" {
				if len(m.Marauders) != 1 || !npc.Visited {
					t.Fatal("active human exactly 5000 away must keep it alive")
				}
			} else if len(m.Marauders) != 0 || m.World.Entities.Has(npc.ship.ID) || m.World.Players.Has(*npc.ship.PlayerID) {
				t.Fatal("must remove the ship and observer when no active humans remain nearby")
			}
		})
	}
}

func TestArrivalSearchAndSavedDestination(t *testing.T) {
	m, _, p := fixture(t)
	npc := m.spawn(p.Craft.Position)
	p.Craft.Position = Vec.Create(64000, 0)
	npc.ship.Position = npc.Destination
	m.Update()

	if !npc.Visited || npc.State != "Search" {
		t.Fatal("must enter the shared expanding spiral after visiting the saved position")
	}

	if npc.Search.Origin != npc.Destination {
		t.Fatal("unseen player movement must not update the search origin")
	}

	if len(m.Environment.(*testhost.Host).Controls) != 0 {
		t.Fatal("marauders must not communicate")
	}
}

func TestControllerAndDispatchPersistence(t *testing.T) {
	m, host, p := fixture(t)
	ping(m)
	dispatch := m.CaptureDispatch()
	restored := New(host)

	if err := restored.RestoreDispatch(dispatch); err != nil {
		t.Fatal(err)
	}

	if restored.CheckAt != m.CheckAt || !restored.Seen[p.Account] {
		t.Fatal("dispatch clock and first ping must survive restoration")
	}

	ping(restored)

	if len(restored.Marauders) != 1 {
		t.Fatal("restored first ping must count toward spawning")
	}

	npc := restored.Marauders[0]
	npc.Visited = true
	npc.TargetID = p.Craft.ID
	npc.CombatAt = m.World.Tick + 30
	npc.Search.Angle = 15
	saved := restored.Capture()[0]
	next := New(host)
	npc.ship.SuppressDrops = false

	if err := next.Restore(npc.ship, saved.State); err != nil {
		t.Fatal(err)
	}

	got := next.Marauders[0]

	if got.Destination != npc.Destination || got.Search != npc.Search || got.CombatAt != npc.CombatAt || !got.Visited || got.TargetID != npc.TargetID || !got.ship.SuppressDrops {
		t.Fatal("restoration must preserve behavior, timers and no-drop policy")
	}
}

func TestFlightReachesReportAndBeginsSearch(t *testing.T) {
	m, host, p := fixture(t)
	npc := m.spawn(Vec.Create(60000, 0))
	p.Craft.Position = Vec.Create(56000, 0)

	for range 3000 {
		host.Tick(1)

		if len(m.Marauders) == 0 {
			t.Fatal("marauder disappeared before reaching a report with a nearby human")
		}

		if npc.Visited {
			if npc.State != "Search" {
				t.Fatalf("expected search after arrival, got %s", npc.State)
			}

			return
		}
	}

	t.Fatalf("marauder did not reach the report using ordinary flight physics: position=%v state=%s", npc.ship.Position, npc.State)
}
