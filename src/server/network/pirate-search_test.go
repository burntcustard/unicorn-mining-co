package network

import (
	"bytes"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func searchEncounter(t testing.TB) (*GameSession, *playerRecord, *soundSocket, *pirate) {
	t.Helper()
	s, p, socket := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	npc.ship.Launching = 0
	npc.ship.DockedTo = nil
	npc.ship.Position = Vec.Add(npc.destination, Vec.Create(-100, 0))
	npc.ship.Face(0)
	p.ship.Position = Vec.Add(npc.destination, Vec.Create(20000, 0))
	return s, p, socket, npc
}

func chatCount(socket *soundSocket, text string) int {
	count := 0

	for _, frame := range socket.frames {
		if bytes.HasSuffix(frame, []byte(text)) {
			count++
		}
	}

	return count
}

func TestPirateSearchStartsWithinTenUnitsOfTheReport(t *testing.T) {
	s, p, socket, npc := searchEncounter(t)
	report := npc.destination
	s.updatePirates()

	if npc.state != piratePursuing || npc.destination != report || npc.input.Thrust <= 0 {
		t.Fatal("pirate did not approach the unseen report without a standoff")
	}

	npc.ship.Position = Vec.Add(report, Vec.Create(-10.01, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != piratePursuing {
		t.Fatal("search began before reaching the reported area")
	}

	npc.ship.Position = Vec.Add(report, Vec.Create(-10, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != pirateSearch || npc.search.Origin != report || npc.victimVisible {
		t.Fatal("pirate did not search within ten units of the report")
	}

	p.ship.Position.X += 1000
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.destination != report || chatCount(socket, "I heard reports of mining in this area...") != 1 {
		t.Fatal("search tracked an unseen player or repeated its opening message")
	}
}

func TestPirateSearchRespectsAsteroidCover(t *testing.T) {
	s, p, _, npc := searchEncounter(t)
	npc.ship.Position = npc.destination
	p.ship.Position = Vec.Add(npc.destination, Vec.Create(1200, 0))
	rock := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: s.World, Position: Vec.Add(npc.destination, Vec.Create(600, 0)), Radius: new(100.0), Health: new(100.0)}, PointCount: 7}, s.World)
	simulation.AddEntity(s.World, rock)
	s.updatePirates()

	if npc.state != pirateSearch || npc.victimVisible {
		t.Fatal("pirate saw a distant player behind an asteroid")
	}

	p.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(1000, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != piratePursuing || !npc.victimVisible || npc.destination != p.ship.Position {
		t.Fatal("nearby sensors did not reacquire the player through cover")
	}
}

func TestPirateSearchRetainsHostilityWhenItReacquiresAPlayer(t *testing.T) {
	s, p, socket, npc := searchEncounter(t)
	npc.ship.Position = npc.destination
	npc.state = pirateFighting
	npc.aggressors[p.playerID] = true
	s.updatePirates()

	if npc.state != pirateSearch {
		t.Fatal("pirate did not search for its lost enemy")
	}

	p.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(1200, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != pirateFighting || npc.destination != p.ship.Position {
		t.Fatal("pirate did not resume pursuit of its visible enemy")
	}

	p.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(250, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != pirateFighting || !npc.input.Fire || chatCount(socket, "Give me all your cargo or I'll open fire.") != 0 {
		t.Fatal("reacquisition restarted the warning instead of resuming combat")
	}
}

func TestPirateSearchFindsAnotherPlayerAndKeepsCargoDemandPrivate(t *testing.T) {
	s, p, socket, npc := searchEncounter(t)
	npc.ship.Position = npc.destination
	s.updatePirates()

	if npc.state != pirateSearch {
		t.Fatal("fixture did not start searching")
	}

	// A nearby NPC observer is not a player character for search acquisition.
	decoy := objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(999)), Position: Vec.Add(npc.ship.Position, Vec.Create(100, 0))})
	simulation.AddEntity(s.World, decoy)
	simulation.AddPlayer(s.World, simulation.Player{ID: 999, ShipID: decoy.ID})
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != pirateSearch {
		t.Fatal("search acquired another NPC")
	}

	otherSocket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, otherSocket)
	other := s.playersBySocket[otherSocket]
	other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(500, 0))

	for range 3 {
		item := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, s.World.Specification)
		item.Mined = true
		other.ship.CargoContents = append(other.ship.CargoContents, item)
	}

	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != piratePursuing || npc.victim != other || npc.victimShipID != other.shipID || npc.destination != other.ship.Position {
		t.Fatal("search did not acquire another visible player")
	}

	other.ship.Position = Vec.Add(npc.ship.Position, Vec.Create(250, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.updatePirates()

	if npc.state != pirateWaiting {
		t.Fatal("pirate did not approach its new victim")
	}

	demand := func(socket *soundSocket) bool {
		id := npc.ship.ID
		packet, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &id}, s.World.Specification.Protocol)

		if err != nil {
			t.Fatal(err)
		}

		for _, frame := range socket.frames {
			if bytes.Equal(frame, packet) {
				return true
			}
		}

		return false
	}

	if !demand(otherSocket) || demand(socket) || p.pirateAfter <= s.World.Tick {
		t.Fatal("search reassignment did not update the private cargo demand and original dispatch cooldown")
	}
}

func TestPirateSearchTimesOutAfterOneHundredSecondsAndReturnsHome(t *testing.T) {
	s, _, socket, npc := searchEncounter(t)
	npc.ship.Position = npc.destination
	s.updatePirates()
	home := npc.homeID

	for range 30*100 - 1 {
		advanceEncounter(s, socket)
	}

	if npc.state != pirateSearch || chatCount(socket, "I guess they left") != 0 {
		t.Fatal("pirate abandoned its search early")
	}

	advanceEncounter(s, socket)
	// updatePirates sees the tick before physics advances it.
	advanceEncounter(s, socket)

	if npc.state != pirateReturning || chatCount(socket, "I guess they left") != 1 {
		t.Fatalf("search did not end at 100 seconds: state=%d tick=%d", npc.state, s.World.Tick)
	}

	docked := false

	for range 30 * 180 {
		advanceEncounter(s, socket)
		docked = docked || npc.ship.DockedTo != nil && *npc.ship.DockedTo == home

		if len(s.sectors[s.currentSector].pirates) == 0 {
			break
		}
	}

	if !docked || len(s.sectors[s.currentSector].pirates) != 0 || chatCount(socket, "I heard reports of mining in this area...") != 1 || chatCount(socket, "I guess they left") != 1 {
		t.Fatalf("unsuccessful search did not return home once: state=%d position=%v home=%v", npc.state, npc.ship.Position, npc.home.Position)
	}
}

func TestPirateLateSearchKeepsItsFullSearchWindowAndReturnTrip(t *testing.T) {
	s, _, socket, npc := searchEncounter(t)
	npc.ship.Position = npc.destination
	s.World.Tick = 30 * 590
	s.updatePirates()
	s.World.Tick = 30 * 601
	s.updatePirates()

	if npc.state != pirateSearch || !s.World.Entities.Has(npc.ship.ID) {
		t.Fatal("the encounter lifetime cut its search short")
	}

	s.World.Tick = 30 * 690
	s.updatePirates()
	s.updatePirates()

	if npc.state != pirateReturning || !s.World.Entities.Has(npc.ship.ID) || chatCount(socket, "I guess they left") != 1 {
		t.Fatal("an older pirate did not finish searching and start its return trip")
	}
}

func TestMiningCanDispatchNewPiratesAfterEarlierEncounters(t *testing.T) {
	for _, scenario := range []struct {
		name            string
		surrender, move bool
	}{
		{name: "destroyed at the same station"},
		{name: "destroyed then another station", move: true},
		{name: "appeased then mining again", surrender: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			s, p, socket := pirateEncounter(t)
			s.dispatchPirates()
			first := s.sectors[s.currentSector].pirates[0]

			if scenario.surrender {
				for range 30 * 180 {
					if first.state == pirateWaiting {
						p.lastInput = protocol.Input{CargoRelease: true}
					}

					advanceEncounter(s, socket)

					if len(s.sectors[s.currentSector].pirates) == 0 {
						break
					}
				}

				if first.ship.Dead || len(p.ship.CargoContents) != 0 || first.state != pirateDocked {
					t.Fatal("first encounter was not appeased")
				}
			} else {
				objects.Damage(first.ship.Cockpit, 10000)
				first.ship.Update(0)
				s.updatePirates()
			}

			if len(s.sectors[s.currentSector].pirates) != 0 {
				t.Fatal("first encounter was not cleaned up")
			}

			p.lastInput = protocol.Input{}
			p.ship.CargoContents = nil
			s.World.Tick = p.pirateAfter
			s.dispatchPirates()

			if len(s.sectors[s.currentSector].pirates) != 0 {
				t.Fatal("empty cargo attracted another pirate")
			}

			if scenario.move {
				p.ship.Position = Vec.Create(100000, -100000)
			}

			expected := s.nearestStation(p.ship.Position)

			for range 3 {
				item := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, s.World.Specification)
				item.Mined = true
				p.ship.CargoContents = append(p.ship.CargoContents, item)
			}

			s.World.Tick += 30
			s.dispatchPirates()
			pirates := s.sectors[s.currentSector].pirates

			if len(pirates) != 1 || pirates[0] == first || pirates[0].ship.ID == first.ship.ID || pirates[0].home.ID != expected.ID || pirates[0].destination != p.ship.Position {
				t.Fatal("newly mined cargo did not dispatch a separate pirate from the current nearest station")
			}

			if scenario.move && expected.ID == first.home.ID {
				t.Fatal("fixture did not move nearer another station")
			}

			if !scenario.move && expected.ID != first.home.ID {
				t.Fatal("fixture did not reuse the same station")
			}

			s.World.Tick += 30
			s.dispatchPirates()

			if len(s.sectors[s.currentSector].pirates) != 1 {
				t.Fatal("new encounter allowed duplicate dispatches")
			}
		})
	}
}
