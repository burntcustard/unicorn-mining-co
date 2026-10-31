package pirate

import (
	"bytes"
	"github.com/burntcustard/unicorn-mining-co/src/server/npc/testhost"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"strconv"
	"strings"
	"testing"
)

/*
A pirate must allow for its remaining drift before entering the cargo-demand
range. Waiting then faces the player without thrust and cannot fix an overshoot.
*/
func TestPirateCoastsIntoItsCargoDemandDistance(t *testing.T) {
	s, p := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(1000, 0))
	npc.ship.Face(math.Pi)
	startingHealth := npc.ship.HullHealthTotal() + p.Craft.HullHealthTotal()
	coasted, warned := false, false

	for range 30 * 45 {
		s.Tick(1)
		distance := Vec.Distance(npc.ship.Position, p.Craft.Position)

		if distance < 100 || npc.ship.Dead || p.Craft.Dead {
			t.Fatal("pirate approached too quickly to wait safely")
		}

		if npc.State == pursuing && distance > 300 && npc.Input.Thrust == 0 && Vec.Length(npc.ship.Velocity) > 10 {
			coasted = true
		}

		if npc.State == waiting {
			warned = true
			elapsed := float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep - npc.WarnedAt

			if npc.Input.Thrust != 0 || npc.Following {
				t.Fatalf("pirate needed to chase the stationary player after demanding cargo: distance=%g speed=%g elapsed=%g thrust=%g following=%v", distance, Vec.Length(npc.ship.Velocity), elapsed, npc.Input.Thrust, npc.Following)
			}

			if elapsed >= 10 {
				if !coasted || distance < 200 || distance > 240 || Vec.Length(npc.ship.Velocity) > 3 {
					t.Fatalf("pirate failed to coast to a sensible stop: coasted=%v distance=%g speed=%g", coasted, distance, Vec.Length(npc.ship.Velocity))
				}

				if npc.ship.HullHealthTotal()+p.Craft.HullHealthTotal() != startingHealth {
					t.Fatal("arrival damaged one of the ships")
				}

				return
			}
		}
	}

	t.Fatalf("pirate did not finish its approach: warned=%v state=%d distance=%g", warned, npc.State, Vec.Distance(npc.ship.Position, p.Craft.Position))
}

func TestWaitingPirateMaintainsItsDistanceFromAMovingPlayer(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	const speed = 120.0
	p.Craft.Velocity = Vec.Create(speed, 0)
	maximum := p.Craft.Rules.Flight.ThrustScale * p.Craft.ForwardThrust() / p.Craft.Mass
	p.Input = protocol.Input{Thrust: speed * p.Craft.Drag / maximum}
	followed := false
	totalError, samples := 0.0, 0

	for tick := range 30 * 19 {
		s.Tick(1)

		if npc.State != waiting || npc.ship.Firing {
			t.Fatal("moving player interrupted the original cargo demand")
		}

		if npc.Following {
			followed = true
		}

		if tick >= 30*10 {
			distance := Vec.Distance(npc.ship.Position, p.Craft.Position)

			if !npc.Following || distance < 180 || distance > 300 {
				t.Fatalf("pirate stopped maintaining pursuit of a moving player: following=%v distance=%g own speed=%g player speed=%g", npc.Following, distance, Vec.Length(npc.ship.Velocity), Vec.Length(p.Craft.Velocity))
			}

			totalError += math.Abs(distance - s.World.Specification.PirateSpec.FollowDistance)
			samples++
		}
	}

	if !followed || totalError/float64(samples) > 20 {
		t.Fatalf("moving player did not retain steady following: followed=%v mean spacing error=%g", followed, totalError/float64(samples))
	}
}

func waitingEncounter(t *testing.T) (*fixture, *testhost.Human, *pirate) {
	t.Helper()
	s, p := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(-250, 0))
	npc.ship.Face(0)
	p.Craft.Face(0)
	p.Controls = nil
	s.Tick(1)

	if npc.State != waiting || npc.Following || npc.ship.Forward != 0 {
		t.Fatal("pirate did not begin by waiting at its normal standoff")
	}

	return s, p, npc
}

func TestWaitingPirateFollowsWithoutRestartingItsDemand(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	warnedAt := npc.WarnedAt
	startingPosition := npc.ship.Position
	followed := false
	settled := false

	for tick := 0; tick < 30*23; tick++ {
		if tick < 30*4 {
			p.Input = protocol.Input{Thrust: .35}
		} else {
			p.Input = protocol.Input{}
		}

		s.Tick(1)
		elapsed := float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep - warnedAt

		if elapsed < 23 && npc.State != waiting {
			t.Fatalf("following interrupted the warning: elapsed=%g state=%d", elapsed, npc.State)
		}

		if npc.WarnedAt != warnedAt {
			t.Fatal("following restarted the demand timer")
		}

		if elapsed < 23 && npc.ship.Firing {
			t.Fatal("following pirate fired before its warning expired")
		}

		if npc.Following && npc.Input.Thrust > .05 {
			followed = true
		}

		if elapsed > 12 && elapsed < 23 && !npc.Following {
			distance := Vec.Distance(npc.ship.Position, p.Craft.Position)

			if distance < 200 || distance > 230 || npc.Input.Thrust != 0 {
				t.Fatalf("pirate stopped at an unreasonable distance: distance=%g thrust=%g", distance, npc.Input.Thrust)
			}

			offset := Vec.Subtract(p.Craft.Position, npc.ship.Position)
			angle := math.Remainder(math.Atan2(offset.Y, offset.X)-npc.ship.Rotation, 2*math.Pi)

			if math.Abs(angle) < .03 {
				settled = true
			}
		}
	}

	if !followed || !settled || Vec.Distance(startingPosition, npc.ship.Position) < 200 {
		t.Fatalf("waiting pirate failed to follow and settle: followed=%v settled=%v travel=%g distance=%g", followed, settled, Vec.Distance(startingPosition, npc.ship.Position), Vec.Distance(npc.ship.Position, p.Craft.Position))
	}

	if npc.State != fighting || !npc.aggressors[p.ID] {
		t.Fatal("pirate did not attack when the original warning expired")
	}

	demands := 0

	for _, frame := range frames(p) {
		if len(frame) > 3 && frame[1] == 0x43 && frame[3] == byte(s.World.Specification.Protocol.ControlMessageIDs["chat"]) && slices.ContainsFunc(s.World.Specification.PirateDialog.CargoDemand, func(line string) bool { return bytes.HasSuffix(frame, []byte(line)) }) {
			demands++
		}
	}

	if demands != 1 {
		t.Fatalf("following issued %d demands, want one", demands)
	}
}

func TestWaitingPirateResumesFollowingAfterSettling(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	warnedAt := npc.WarnedAt
	followed, settled := [2]bool{}, [2]bool{}

	for tick := 0; tick < 30*19; tick++ {
		cycle := 0

		if tick >= 30*9 {
			cycle = 1
		}

		if tick < 30 || tick >= 30*9 && tick < 30*10 {
			p.Input = protocol.Input{Thrust: .25}
		} else {
			p.Input = protocol.Input{}
		}

		s.Tick(1)

		if npc.State != waiting || npc.WarnedAt != warnedAt || npc.ship.Firing {
			t.Fatal("resuming pursuit interrupted the original waiting state")
		}

		if npc.Following {
			followed[cycle] = true
		} else if followed[cycle] {
			settled[cycle] = true
		}
	}

	if followed != [2]bool{true, true} || settled != [2]bool{true, true} {
		t.Fatalf("pirate did not follow and settle on both moves: followed=%v settled=%v distance=%g", followed, settled, Vec.Distance(npc.ship.Position, p.Craft.Position))
	}
}

func TestFollowingPirateAcceptsSurrenderAndDocking(t *testing.T) {
	for _, ending := range []string{"surrender", "docking"} {
		t.Run(ending, func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			p.Input = protocol.Input{Thrust: .35}

			for range 30 * 2 {
				s.Tick(1)
			}

			if npc.State != waiting || !npc.Following {
				t.Fatal("fixture did not make the waiting pirate follow its victim")
			}

			expected := waiting
			p.Input = protocol.Input{}

			if ending == "surrender" {
				p.Craft.CargoRelease()
			} else {
				expected = returning
				p.Craft.DockedTo = &npc.HomeID
			}

			s.Tick(1)

			if npc.State != expected || npc.ship.Firing || npc.Input.Fire || npc.aggressors[p.ID] {
				t.Fatalf("following prevented %s: state=%d firing=%v", ending, npc.State, npc.ship.Firing)
			}

			for range 30 * 22 {
				s.Tick(1)

				if npc.State == fighting || npc.Input.Fire || npc.aggressors[p.ID] {
					t.Fatalf("warning restarted combat after %s", ending)
				}
			}
		})
	}
}

func searchEncounter(t testing.TB) (*fixture, *testhost.Human, *pirate) {
	t.Helper()
	s, p := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	npc.ship.Launching = 0
	npc.ship.DockedTo = nil
	npc.ship.Position = Vec.Add(npc.Destination, Vec.Create(-100, 0))
	npc.ship.Face(0)
	p.Craft.Position = Vec.Add(npc.Destination, Vec.Create(20000, 0))
	return s, p, npc
}

func chatCount(socket *testhost.Human, text string) int {
	count := 0

	for _, frame := range frames(socket) {
		if bytes.HasSuffix(frame, []byte(text)) {
			count++
		}
	}

	return count
}

func TestPirateSearchStartsWithinTenUnitsOfTheReport(t *testing.T) {
	s, p, npc := searchEncounter(t)
	report := npc.Destination
	s.Update()

	if npc.State != pursuing || npc.Destination != report || npc.Input.Thrust <= 0 {
		t.Fatal("pirate did not approach the unseen report without a standoff")
	}

	npc.ship.Position = Vec.Add(report, Vec.Create(-10.01, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != pursuing {
		t.Fatal("search began before reaching the reported area")
	}

	npc.ship.Position = Vec.Add(report, Vec.Create(-10, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != search || npc.Search.Origin != report || npc.VictimVisible {
		t.Fatal("pirate did not search within ten units of the report")
	}

	p.Craft.Position.X += 1000
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.Destination != report || chatCount(p, "I heard reports of mining in this area...") != 1 || chatCount(p, "Where did you go?") != 0 {
		t.Fatal("search tracked an unseen player or repeated its opening message")
	}
}

func TestPirateSearchRespectsAsteroidCover(t *testing.T) {
	s, p, npc := searchEncounter(t)
	npc.ship.Position = npc.Destination
	p.Craft.Position = Vec.Add(npc.Destination, Vec.Create(1200, 0))
	rock := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: s.World, Position: Vec.Add(npc.Destination, Vec.Create(600, 0)), Radius: new(100.0), Health: new(100.0)}, PointCount: 7}, s.World)
	simulation.AddEntity(s.World, rock)
	s.Update()

	if npc.State != search || npc.VictimVisible {
		t.Fatal("pirate saw a distant player behind an asteroid")
	}

	p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(1000, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != pursuing || !npc.VictimVisible || npc.Destination != p.Craft.Position {
		t.Fatal("nearby sensors did not reacquire the player through cover")
	}
}

func TestPirateLosingASeenPlayerDoesNotRepeatMiningReports(t *testing.T) {
	s, p, npc := searchEncounter(t)
	p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(500, 0))
	s.Update()

	if !npc.VictimVisible || !npc.PlayerSeen {
		t.Fatal("pirate did not encounter the player")
	}

	lastSeen := p.Craft.Position
	p.Craft.Position.X += 20000
	npc.ship.Position = lastSeen
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != search || chatCount(p, "I heard reports of mining in this area...") != 0 || chatCount(p, "Where did you go?") != 1 || chatCount(p, "I guess they left") != 0 {
		t.Fatal("searching for a known player did not announce losing them")
	}

	searchTicks := uint64(s.World.Specification.PirateSpec.SearchDuration / s.World.Specification.Simulation.SimulationStep)
	s.World.Tick += searchTicks - pirateDecisionTicks(s)
	s.Update()

	if npc.State != search || chatCount(p, "I guess they left") != 0 || chatCount(p, "Where did you go?") != 1 {
		t.Fatal("searching repeated its opening or announced expiration too early")
	}

	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != returning || chatCount(p, "I guess they left") != 1 {
		t.Fatal("search expiration did not announce the lost player exactly once")
	}

	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if chatCount(p, "I guess they left") != 1 || chatCount(p, "Where did you go?") != 1 {
		t.Fatal("returning home repeated a search message")
	}
}

func TestPirateSearchRetainsHostilityWhenItReacquiresAPlayer(t *testing.T) {
	s, p, npc := searchEncounter(t)
	npc.ship.Position = npc.Destination
	npc.State = fighting
	npc.aggressors[p.ID] = true
	s.Update()

	if npc.State != search {
		t.Fatal("pirate did not search for its lost enemy")
	}

	p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(1200, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != fighting || npc.Destination != p.Craft.Position {
		t.Fatal("pirate did not resume pursuit of its visible enemy")
	}

	p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(250, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != fighting || !npc.Input.Fire || chatCount(p, "Give me all your cargo or I'll open fire.") != 0 {
		t.Fatal("reacquisition restarted the warning instead of resuming combat")
	}
}

func TestPirateSearchFindsAnotherPlayerAndKeepsCargoDemandPrivate(t *testing.T) {
	s, p, npc := searchEncounter(t)
	npc.ship.Position = npc.Destination
	s.Update()

	if npc.State != search {
		t.Fatal("fixture did not start searching")
	}

	// A nearby NPC observer is not a player character for search acquisition.
	decoy := objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: "courser", PlayerID: new(int64(999)), Position: Vec.Add(npc.ship.Position, Vec.Create(100, 0))})
	simulation.AddEntity(s.World, decoy)
	simulation.AddPlayer(s.World, simulation.Player{ID: 999, ShipID: decoy.ID})
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != search {
		t.Fatal("search acquired another NPC")
	}

	otherSocket := s.AddPlayer()
	other := otherSocket
	other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(500, 0))

	for range 3 {
		item := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, s.World.Specification)
		item.Mined = true
		other.Craft.CargoContents = append(other.Craft.CargoContents, item)
	}

	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != pursuing || npc.victim != other || npc.VictimShipID != other.Craft.ID || npc.Destination != other.Craft.Position {
		t.Fatal("search did not acquire another visible player")
	}

	other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(250, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != waiting {
		t.Fatal("pirate did not approach its new victim")
	}

	demand := func(socket *testhost.Human) bool {
		id := npc.ship.ID
		packet, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &id}, s.World.Specification.Protocol)

		if err != nil {
			t.Fatal(err)
		}

		for _, frame := range frames(socket) {
			if bytes.Equal(frame, packet) {
				return true
			}
		}

		return false
	}

	if !demand(otherSocket) || demand(p) || p.Cooldown <= s.World.Tick {
		t.Fatal("search reassignment did not update the private cargo demand and original dispatch cooldown")
	}
}

func TestPirateSearchTimesOutAfterOneHundredSecondsAndReturnsHome(t *testing.T) {
	s, socket, npc := searchEncounter(t)
	npc.ship.Position = npc.Destination
	s.Update()
	home := npc.HomeID

	for range 30*100 - 1 {
		s.Tick(1)
	}

	if npc.State != search || chatCount(socket, "I guess they left") != 0 {
		t.Fatal("pirate abandoned its search early")
	}

	s.Tick(1)
	// Update sees the tick before physics advances it.
	s.Tick(1)

	if npc.State != returning || chatCount(socket, "I guess they left") != 1 {
		t.Fatalf("search did not end at 100 seconds: state=%d tick=%d", npc.State, s.World.Tick)
	}

	docked := false

	for range 30 * 180 {
		s.Tick(1)
		docked = docked || npc.ship.DockedTo != nil && *npc.ship.DockedTo == home

		if len(s.Pirates) == 0 {
			break
		}
	}

	if !docked || len(s.Pirates) != 0 || chatCount(socket, "I heard reports of mining in this area...") != 1 || chatCount(socket, "I guess they left") != 1 {
		t.Fatalf("unsuccessful search did not return home once: state=%d position=%v home=%v", npc.State, npc.ship.Position, npc.Home.Position)
	}
}

func TestPirateLateSearchKeepsItsFullSearchWindowAndReturnTrip(t *testing.T) {
	s, socket, npc := searchEncounter(t)
	npc.ship.Position = npc.Destination
	s.World.Tick = 30 * 590
	s.Update()
	s.World.Tick = 30 * 601
	s.Update()

	if npc.State != search || !s.World.Entities.Has(npc.ship.ID) {
		t.Fatal("the encounter lifetime cut its search short")
	}

	s.World.Tick = 30 * 690
	s.Update()
	s.Update()

	if npc.State != returning || !s.World.Entities.Has(npc.ship.ID) || chatCount(socket, "I guess they left") != 1 {
		t.Fatal("an older pirate did not finish searching and start its return trip")
	}
}

func TestPirateReacquiresItsPlayerAfterGivingUpSearch(t *testing.T) {
	for _, hostile := range []bool{false, true} {
		t.Run(strconv.FormatBool(hostile), func(t *testing.T) {
			s, p, npc := searchEncounter(t)
			npc.ship.Position = npc.Destination

			if hostile {
				npc.aggressors[p.ID] = true
			}

			s.Update()
			s.World.Tick += uint64(s.World.Specification.PirateSpec.SearchDuration / s.World.Specification.Simulation.SimulationStep)
			s.Update()

			if npc.State != returning {
				t.Fatal("fixture did not give up searching")
			}

			p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(500, 0))
			s.World.Tick += pirateDecisionTicks(s)
			s.Update()
			expected := pursuing

			if hostile {
				expected = fighting
			}

			if npc.State != expected || !npc.VictimVisible || npc.Destination != p.Craft.Position || npc.ship.NPCState != stateNames[expected] {
				t.Fatalf("returning pirate ignored the player: state=%d visible=%v", npc.State, npc.VictimVisible)
			}

			if chatCount(p, "I guess they left") != 1 {
				t.Fatal("reacquisition repeated the search expiration message")
			}
		})
	}
}

func TestPirateExpiredSearchCanFindAnotherPlayer(t *testing.T) {
	s, p, npc := searchEncounter(t)
	npc.ship.Position = npc.Destination
	s.Update()
	s.World.Tick += uint64(s.World.Specification.PirateSpec.SearchDuration / s.World.Specification.Simulation.SimulationStep)
	s.Update()
	otherSocket := s.AddPlayer()
	other := otherSocket
	other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(500, 0))

	for range 3 {
		item := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, s.World.Specification)
		item.Mined = true
		other.Craft.CargoContents = append(other.Craft.CargoContents, item)
	}

	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != pursuing || npc.victim != other || !npc.VictimVisible || npc.Destination != other.Craft.Position || p.Cooldown <= s.World.Tick {
		t.Fatal("returning pirate did not acquire the nearby player")
	}
}

func TestPirateReacquisitionAfterLateSearchStartsANewEncounterWindow(t *testing.T) {
	s, p, npc := searchEncounter(t)
	npc.ship.Position = npc.Destination
	s.World.Tick = uint64((s.World.Specification.PirateSpec.EncounterDuration - 10) / s.World.Specification.Simulation.SimulationStep)
	s.Update()
	s.World.Tick += uint64(s.World.Specification.PirateSpec.SearchDuration / s.World.Specification.Simulation.SimulationStep)
	s.Update()

	if npc.State != returning {
		t.Fatal("late search did not start returning home")
	}

	p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(500, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != pursuing || !s.World.Entities.Has(npc.ship.ID) || len(s.Pirates) != 1 {
		t.Fatal("old encounter timeout removed a pirate after it reacquired its player")
	}
}

func TestPirateReturningAfterSurrenderDoesNotRestartItsDemand(t *testing.T) {
	s, p, npc := searchEncounter(t)
	npc.State, npc.CargoAccepted = returning, true
	p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(250, 0))
	s.Update()

	if npc.State != returning || chatCount(p, "Give me all your cargo or I'll open fire.") != 0 {
		t.Fatal("returning pirate broke its cargo truce")
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
			s, p := pirateEncounter(t)
			s.Manager.Dispatch()
			first := s.Pirates[0]

			if scenario.surrender {
				for range 30 * 180 {
					if first.State == waiting {
						p.Input = protocol.Input{CargoRelease: true}
					}

					s.Tick(1)

					if len(s.Pirates) == 0 {
						break
					}
				}

				if first.ship.Dead || len(p.Craft.CargoContents) != 0 || first.State != docked {
					t.Fatal("first encounter was not appeased")
				}
			} else {
				objects.Damage(first.ship.Cockpit, 10000)
				first.ship.Update(0)
				s.Update()
			}

			if len(s.Pirates) != 0 {
				t.Fatal("first encounter was not cleaned up")
			}

			p.Input = protocol.Input{}
			p.Craft.CargoContents = nil
			s.World.Tick = p.Cooldown
			s.Manager.Dispatch()

			if len(s.Pirates) != 0 {
				t.Fatal("empty cargo attracted another pirate")
			}

			if scenario.move {
				p.Craft.Position = Vec.Create(100000, -100000)
			}

			expected := s.NearestStation(p.Craft.Position)

			for range 3 {
				item := objects.NewItem("diamond", simulation.ObjectProperties{World: s.World}, s.World.Specification)
				item.Mined = true
				p.Craft.CargoContents = append(p.Craft.CargoContents, item)
			}

			s.World.Tick += 30
			s.Manager.Dispatch()
			pirates := s.Pirates

			if len(pirates) != 1 || pirates[0] == first || pirates[0].ship.ID == first.ship.ID || pirates[0].Home.ID != expected.ID || pirates[0].Destination != p.Craft.Position {
				t.Fatal("newly mined cargo did not dispatch a separate pirate from the current nearest station")
			}

			if scenario.move && expected.ID == first.Home.ID {
				t.Fatal("fixture did not move nearer another station")
			}

			if !scenario.move && expected.ID != first.Home.ID {
				t.Fatal("fixture did not reuse the same station")
			}

			s.World.Tick += 30
			s.Manager.Dispatch()

			if len(s.Pirates) != 1 {
				t.Fatal("new encounter allowed duplicate dispatches")
			}
		})
	}
}

func pirateTaunts(s *fixture, socket *testhost.Human) [][]byte {
	return slices.DeleteFunc(slices.Clone(frames(socket)), func(frame []byte) bool {
		return len(frame) < 4 || frame[3] != byte(s.World.Specification.Protocol.ControlMessageIDs["chat"]) || !slices.ContainsFunc(s.World.Specification.PirateDialog.Taunt, func(text string) bool { return bytes.HasSuffix(frame, []byte(text)) })
	})
}

func TestPirateAttackAnnouncementPauseAlsoBlocksRetaliation(t *testing.T) {
	s, p, npc := waitingEncounter(t)

	for range 30 * 20 {
		s.Tick(1)
	}

	if npc.State != waiting || npc.Countdown != -1 || npc.AttackAfter == 0 {
		t.Fatal("pirate did not announce its pending attack")
	}

	otherSocket := s.AddPlayer()
	other := otherSocket
	other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(200, 0))
	other.Craft.DockedTo, other.Craft.Launching = nil, 0
	s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})

	if !npc.aggressors[other.ID] {
		t.Fatal("another player's attack did not register hostility")
	}

	for float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep+1e-9 < npc.AttackAfter {
		s.Tick(1)

		if npc.ship.Firing || npc.Input.Fire || npc.TauntAfter != 0 {
			t.Fatal("retaliation bypassed the announcement pause")
		}
	}

	s.Tick(1)

	if npc.State != fighting || !npc.aggressors[p.ID] || math.Abs(npc.TauntAfter-npc.AttackAfter-60) > 1e-8 {
		t.Fatalf("combat did not start after pause: tick=%d state=%d hostile=%v attackAfter=%g tauntAfter=%g", s.World.Tick, npc.State, npc.aggressors[p.ID], npc.AttackAfter, npc.TauntAfter)
	}
}

func TestPirateTauntsEveryMinuteAndBroadcastsOneVariant(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	otherSocket := s.AddPlayer()
	npc.State, npc.aggressors[p.ID] = fighting, true
	npc.ThinkAfter = 0
	s.Update()
	started := s.World.Tick

	for _, seconds := range []uint64{59, 60, 119, 120, 179, 180} {
		s.World.Tick = started + seconds*30
		s.Update()
		a, b := pirateTaunts(s, p), pirateTaunts(s, otherSocket)

		if len(a) != int(seconds/60) || len(b) != len(a) {
			t.Fatalf("at %ds, taunt counts=%d/%d", seconds, len(a), len(b))
		}

		for i := range a {
			if !bytes.Equal(a[i], b[i]) {
				t.Fatal("players received different random taunt variants")
			}
		}
	}
}

func TestPirateRetaliationDoesNotRestartItsAttackAnnouncement(t *testing.T) {
	s, socket, npc := waitingEncounter(t)
	otherSocket := s.AddPlayer()
	other := otherSocket
	other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
	other.Craft.DockedTo, other.Craft.Launching = nil, 0
	s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.Update()
	deadline := npc.TauntAfter
	announcements := pirateDialogCount(socket, s.World.Specification.PirateDialog.Attack)

	if npc.Input.Fire || npc.AttackAfter == 0 || deadline != 0 {
		t.Fatal("retaliation did not wait before starting combat")
	}

	s.World.Tick += uint64(math.Round(s.World.Specification.PirateSpec.AttackDelay / s.World.Specification.Simulation.SimulationStep))
	s.Update()
	deadline = npc.TauntAfter

	if !npc.Input.Fire || deadline == 0 {
		t.Fatal("retaliation did not begin after its delay")
	}

	s.World.Tick = 20 * 30
	s.Update()

	if !npc.Input.Fire || npc.TauntAfter != deadline {
		t.Fatal("the robbery timeout paused an existing fight")
	}

	if pirateDialogCount(socket, s.World.Specification.PirateDialog.Attack) != announcements {
		t.Fatal("the existing fight received a redundant attack announcement")
	}
}

func TestPirateTauntClockSurvivesPursuitAndTargetChanges(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	otherSocket := s.AddPlayer()
	other := otherSocket
	other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(300, 0))
	npc.State, npc.aggressors[p.ID] = fighting, true
	npc.ThinkAfter = 0
	s.Update()
	deadline := npc.TauntAfter
	started := s.World.Tick
	p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(2000, 0))
	s.World.Tick = started + 45*30
	s.Update()

	if npc.State != pursuing || npc.TauntAfter != deadline {
		t.Fatal("temporary loss of sight restarted the combat clock")
	}

	s.World.Tick = started + 65*30
	s.Update()

	if len(pirateTaunts(s, p)) != 0 || npc.TauntAfter != deadline {
		t.Fatal("pirate taunted an unseen target or lost its pending deadline")
	}

	s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.Update()

	if len(pirateTaunts(s, p)) != 1 {
		t.Fatal("pirate did not resume its combat dialog against the new attacker")
	}

	deadline = npc.TauntAfter
	p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(150, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.TauntAfter != deadline || len(pirateTaunts(s, p)) != 1 {
		t.Fatal("switching to a nearer hostile target restarted the taunt clock")
	}

	p.Craft.DockedTo = &npc.HomeID
	s.Update()

	if npc.TauntAfter != deadline || !npc.aggressors[other.ID] {
		t.Fatal("one player's escape interrupted combat against another")
	}

	other.Craft.DockedTo = &npc.HomeID
	s.Update()

	if npc.TauntAfter != 0 {
		t.Fatal("ending combat did not clear its taunt clock")
	}

	other.Craft.DockedTo = nil
	s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.Update()

	if npc.TauntAfter != 0 || npc.AttackAfter <= float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep {
		t.Fatal("a fresh attack after escaping bypassed its pause")
	}

	s.World.Tick += uint64(math.Round(s.World.Specification.PirateSpec.AttackDelay / s.World.Specification.Simulation.SimulationStep))
	s.Update()
	want := float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep + 60

	if math.Abs(npc.TauntAfter-want) > 1e-8 {
		t.Fatal("a fresh attack after escaping did not start a fresh taunt clock")
	}
}

func TestPirateTauntsEndOnSurrenderOrAbandonedSearch(t *testing.T) {
	for _, end := range []string{"surrender", "search expired"} {
		t.Run(end, func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			npc.State, npc.aggressors[p.ID] = fighting, true
			npc.ThinkAfter = 0
			s.Update()

			if end == "surrender" {
				p.Craft.CargoRelease()
			} else {
				p.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(2000, 0))
				npc.State = search
				npc.SearchStartedAt = -101
			}

			npc.ThinkAfter = 0
			s.Update()

			if npc.TauntAfter != 0 {
				t.Fatal("finished encounter kept its combat clock")
			}

			s.World.Tick += 60 * 30
			s.Update()

			if len(pirateTaunts(s, p)) != 0 {
				t.Fatal("finished encounter emitted a combat taunt")
			}
		})
	}
}

func TestPirateEndedDemandStartsAFreshRetaliationPause(t *testing.T) {
	for _, end := range []string{"surrender", "docking"} {
		t.Run(end, func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			s.World.Tick += 20 * 30
			s.Update()

			if npc.AttackAfter == 0 {
				t.Fatal("pirate did not announce its pending attack")
			}

			if end == "surrender" {
				p.Craft.CargoRelease()
			} else {
				p.Craft.DockedTo = &npc.HomeID
			}

			s.Update()

			if npc.AttackAfter != 0 || npc.TauntAfter != 0 {
				t.Fatal("ended demand kept its pending combat timers")
			}

			otherSocket := s.AddPlayer()
			other := otherSocket
			other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
			other.Craft.DockedTo, other.Craft.Launching = nil, 0
			s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
			s.Update()

			if npc.Input.Fire || npc.TauntAfter != 0 || math.Abs(npc.AttackAfter-float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep-s.World.Specification.PirateSpec.AttackDelay) > 1e-8 {
				t.Fatal("new retaliation did not start its own pause")
			}

		})
	}
}

func TestPiratePendingRetaliationKeepsPauseWhenVictimEscapes(t *testing.T) {
	for _, end := range []string{"surrender", "docking"} {
		t.Run(end, func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			s.World.Tick += 20 * 30
			s.Update()
			deadline := npc.AttackAfter
			otherSocket := s.AddPlayer()
			other := otherSocket
			other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
			other.Craft.DockedTo, other.Craft.Launching = nil, 0
			s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})

			if end == "surrender" {
				p.Craft.CargoRelease()
			} else {
				p.Craft.DockedTo = &npc.HomeID
			}

			s.Update()

			if npc.Input.Fire || npc.AttackAfter != deadline || npc.TauntAfter != 0 {
				t.Fatal("the victim's escape bypassed an existing retaliation pause")
			}

			s.World.Tick += 3 * 30
			s.Update()

			if !npc.Input.Fire || math.Abs(npc.TauntAfter-deadline-60) > 1e-8 {
				t.Fatal("pending retaliation did not begin after its original pause")
			}
		})
	}
}

func pirateDialogCount(socket *testhost.Human, lines []string) int {
	count := 0

	for _, line := range lines {
		count += chatCount(socket, line)
	}

	return count
}

func assertPiratePaused(t *testing.T, npc *pirate) {
	t.Helper()

	if npc.State != waiting || npc.ship.NPCState != "Waiting" || npc.Input.Fire || npc.ship.Firing {
		t.Fatalf("pirate did not wait peacefully: state=%d label=%q input=%+v firing=%v", npc.State, npc.ship.NPCState, npc.Input, npc.ship.Firing)
	}
}

func TestPirateSurrenderPausesBeforeCollectingReleasedItems(t *testing.T) {
	for _, delay := range []float64{3, 1.2} {
		t.Run(strconv.FormatFloat(delay, 'f', -1, 64), func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			s.World.Specification.PirateSpec.CollectDelay = delay

			for range 24 {
				s.Tick(1)
			}

			if npc.ship.ModuleActive("cargoHatch") {
				t.Fatal("waiting pirate exposed its cargo hatches")
			}

			p.Craft.CargoRelease()
			s.Update()
			started := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep
			deadline := npc.CollectAfter

			if math.Abs(deadline-started-delay) > 1e-8 {
				t.Fatalf("collection deadline=%g, want %g", deadline, started+delay)
			}

			assertPiratePaused(t, npc)

			for float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep+1e-9 < deadline {
				s.Tick(1)
				assertPiratePaused(t, npc)

				if npc.CollectAfter != deadline || len(npc.ship.CargoContents) != 1 {
					t.Fatal("continued ejection restarted the pause or collected cargo early")
				}

				for _, collider := range npc.ship.HitboxColliding() {
					if segment, ok := collider.Segment.(*simulation.Segment); ok && segment.Catches {
						t.Fatal("collection pause left a passive cargo pickup collider active")
					}
				}
			}

			if len(p.Craft.CargoContents) == 7 {
				t.Fatal("the physical cargo release did not begin during the pause")
			}

			s.Update()

			if npc.State != collecting || npc.ship.NPCState != "Collecting" || npc.Input.Fire {
				t.Fatalf("collection did not begin at its deadline: state=%d label=%q", npc.State, npc.ship.NPCState)
			}
		})
	}
}

func TestLastAttackerLeavingCancelsPendingPirateCombat(t *testing.T) {
	for _, scenario := range []struct{ accepted, dead bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		t.Run("cargoAccepted"+strconv.FormatBool(scenario.accepted)+"/dead"+strconv.FormatBool(scenario.dead), func(t *testing.T) {
			accepted := scenario.accepted
			s, p, npc := waitingEncounter(t)
			warnedAt := npc.WarnedAt
			otherSocket := s.AddPlayer()
			other := otherSocket
			other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
			other.Craft.DockedTo, other.Craft.Launching = nil, 0

			if accepted {
				p.Craft.CargoRelease()
				s.Tick(1)
			}

			s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
			s.Update()
			deadline := npc.AttackAfter
			assertPiratePaused(t, npc)
			s.World.Tick += 30

			if scenario.dead {
				other.Craft.Remove()
			} else {
				other.Craft.DockedTo = &npc.HomeID
			}

			s.Update()
			now := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep

			if len(npc.aggressors) != 0 || npc.AttackAfter != 0 || npc.TauntAfter != 0 || npc.Input.Fire {
				t.Fatal("the last attacker's escape retained pending combat")
			}

			if accepted {
				assertPiratePaused(t, npc)

				if math.Abs(npc.CollectAfter-now-s.World.Specification.PirateSpec.CollectDelay) > 1e-8 {
					t.Fatal("escaping attacker did not restart collection's pause")
				}
			} else {
				if npc.State == pursuing {
					s.World.Tick += pirateDecisionTicks(s)
					s.Update()
				}

				if npc.State != waiting || npc.WarnedAt <= warnedAt || npc.Countdown <= 0 || npc.CollectAfter != 0 {
					t.Fatal("escaping attacker did not resume a fresh cargo demand")
				}
			}

			s.World.Tick = uint64(math.Round(deadline/s.World.Specification.Simulation.SimulationStep)) + 1
			s.Update()

			if npc.State == fighting || npc.Input.Fire || len(npc.aggressors) != 0 {
				t.Fatal("the canceled deadline started combat without an enemy")
			}
		})
	}
}

func TestPirateAttackPauseDoesNotTrackAnUnseenVictim(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: p.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.Update()
	remembered := npc.Destination

	for _, offset := range []Vec.Vector{Vec.Create(2000, 0), Vec.Create(2400, 300)} {
		p.Craft.Position = Vec.Add(npc.ship.Position, offset)
		s.World.Tick += pirateDecisionTicks(s)
		s.Update()

		if npc.VictimVisible || npc.Destination != remembered || npc.Input.Fire {
			t.Fatal("the attack pause tracked an unseen player's live position")
		}
	}
}

func TestFriendlyVictimDockingDoesNotAbandonDefendedLoot(t *testing.T) {
	for _, active := range []bool{false, true} {
		t.Run("fighting"+strconv.FormatBool(active), func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			// Finish this fixture's release within the pirate's collection delay.
			p.Craft.CargoContents = p.Craft.CargoContents[:4]
			p.Craft.CargoRelease()

			for tick := 0; tick < 150 && npc.State != collecting; tick++ {
				s.Tick(1)
			}

			if npc.State != collecting || !npc.CargoAccepted || len(npc.loot) == 0 || p.Craft.MinedCargoValue() != 0 {
				t.Fatal("fixture did not accept and eject the original victim's cargo")
			}

			otherSocket := s.AddPlayer()
			other := otherSocket
			other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
			other.Craft.DockedTo, other.Craft.Launching = nil, 0
			s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
			s.Update()

			if active {
				s.World.Tick += uint64(math.Round(s.World.Specification.PirateSpec.AttackDelay / s.World.Specification.Simulation.SimulationStep))
				s.Update()
			}

			loot := slices.Clone(npc.loot)
			state := npc.State
			p.Craft.DockedTo = &npc.HomeID
			s.Update()

			if !npc.CargoAccepted || !slices.Equal(npc.loot, loot) || !npc.aggressors[other.ID] || npc.aggressors[p.ID] || npc.State != state {
				t.Fatal("the friendly victim's docking abandoned loot or interrupted its defender")
			}

			for _, line := range s.World.Specification.PirateDialog.Escaped {
				if chatCount(p, strings.ReplaceAll(line, "{player}", p.Craft.Name)) != 0 {
					t.Fatal("the pirate called off combat against a friendly original victim")
				}
			}

			other.Craft.DockedTo = &npc.HomeID
			s.Update()

			if !npc.CargoAccepted || !slices.Equal(npc.loot, loot) || npc.CollectAfter == 0 || len(npc.aggressors) != 0 {
				t.Fatal("loot could not resume collection after both players docked")
			}
		})
	}
}

func TestPiratePursuesAndSearchesForItsLostThirdPartyAttacker(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	otherSocket := s.AddPlayer()
	other := otherSocket
	other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(0, 400))
	other.Craft.DockedTo, other.Craft.Launching = nil, 0
	npc.ship.Face(math.Pi / 2)
	s.Hits([]protocol.SimulationEvent{protocol.CollisionEvent{By: other.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}})
	s.Update()
	remembered := other.Craft.Position

	if npc.Destination != remembered {
		t.Fatal("the retaliation pause did not remember the visible attacker's position")
	}

	s.World.Tick += uint64(math.Round(s.World.Specification.PirateSpec.AttackDelay / s.World.Specification.Simulation.SimulationStep))
	s.Update()
	other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(2000, 0))
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != pursuing || npc.ship.NPCState != "Pursuing" || npc.Destination != remembered || npc.Input.Fire || npc.Input.Thrust <= 0 || npc.aggressors[p.ID] {
		t.Fatalf("lost attacker was not pursued independently of the friendly victim: state=%d destination=%v input=%+v", npc.State, npc.Destination, npc.Input)
	}

	npc.ship.Position = remembered
	s.World.Tick += pirateDecisionTicks(s)
	s.Update()

	if npc.State != search || !npc.aggressors[other.ID] || npc.aggressors[p.ID] || pirateDialogCount(p, s.World.Specification.PirateDialog.CargoDemand) != 1 {
		t.Fatal("search replaced the lost hostile attacker with the visible friendly victim")
	}
}

func TestFreshPirateRetaliationAlwaysPausesBeforeFighting(t *testing.T) {
	for _, state := range []int{pursuing, waiting, search, returning} {
		t.Run(stateNames[state], func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			s.World.Specification.PirateSpec.AttackDelay = 1.4
			npc.State = state
			npc.ship.Face(0)
			hit := []protocol.SimulationEvent{protocol.CollisionEvent{By: p.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}}
			s.Hits(hit)
			s.Update()
			started := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep
			deadline := npc.AttackAfter

			if !npc.aggressors[p.ID] || math.Abs(deadline-started-1.4) > 1e-8 {
				t.Fatalf("retaliation did not use its spec delay: hostile=%v deadline=%g", npc.aggressors, deadline)
			}

			assertPiratePaused(t, npc)
			s.World.Tick += 41
			s.Hits(hit)
			s.Update()
			assertPiratePaused(t, npc)

			if npc.AttackAfter != deadline {
				t.Fatal("repeated damage extended the retaliation pause")
			}

			s.World.Tick++
			s.Update()

			if npc.State != fighting || npc.ship.NPCState != "Fighting" || !npc.Input.Fire {
				t.Fatalf("retaliation did not begin at its deadline: state=%d label=%q input=%+v", npc.State, npc.ship.NPCState, npc.Input)
			}
		})
	}
}

func TestPirateDefendsSurrenderedCargoAfterASecondPause(t *testing.T) {
	for _, accepted := range []bool{false, true} {
		for _, original := range []bool{false, true} {
			t.Run("collecting"+strconv.FormatBool(accepted)+"/original"+strconv.FormatBool(original), func(t *testing.T) {
				s, p, npc := waitingEncounter(t)
				otherSocket := s.AddPlayer()
				other := otherSocket
				other.Craft.Position = Vec.Add(npc.ship.Position, Vec.Create(180, 0))
				other.Craft.DockedTo, other.Craft.Launching = nil, 0
				// Finish this fixture's release during the three-second attack pause.
				p.Craft.CargoContents = p.Craft.CargoContents[:4]
				p.Craft.CargoRelease()
				s.Tick(1)

				if accepted {
					for float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep <= npc.CollectAfter+1e-9 {
						s.Tick(1)
					}

					if npc.State != collecting {
						t.Fatal("fixture did not begin collecting")
					}
				} else if !p.Craft.ReleasingCargo() {
					t.Fatal("fixture did not retain an ongoing cargo release")
				}

				attacker := other
				lines, otherLines := s.World.Specification.PirateDialog.DefendLoot, s.World.Specification.PirateDialog.BrokenTruce

				if original {
					attacker = p
					lines, otherLines = otherLines, lines
				}

				p.Controls, otherSocket.Controls = nil, nil
				npc.ship.Face(0)
				hit := []protocol.SimulationEvent{protocol.CollisionEvent{By: attacker.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}}
				s.Hits(hit)
				s.Update()
				deadline := npc.AttackAfter
				started := float64(s.World.Tick) * s.World.Specification.Simulation.SimulationStep

				if !npc.aggressors[attacker.ID] || math.Abs(deadline-started-3) > 1e-8 || npc.CollectAfter != 0 {
					t.Fatalf("loot defense did not replace collection with a fresh pause: state=%d deadline=%g collectAfter=%g", npc.State, deadline, npc.CollectAfter)
				}

				assertPiratePaused(t, npc)

				for float64(s.World.Tick)*s.World.Specification.Simulation.SimulationStep+1e-9 < deadline {
					s.Hits(hit)
					s.Tick(1)
					assertPiratePaused(t, npc)

					if npc.AttackAfter != deadline || !npc.aggressors[attacker.ID] {
						t.Fatal("old cargo release appeased retaliation or repeated hits reset its pause")
					}
				}

				s.Update()

				if npc.State != fighting || npc.ship.NPCState != "Fighting" || !npc.Input.Fire {
					t.Fatalf("loot defender did not enter combat: state=%d label=%q input=%+v", npc.State, npc.ship.NPCState, npc.Input)
				}

				if p.Craft.MinedCargoValue() != 0 || p.Craft.ReleasingCargo() {
					t.Fatal("fixture did not finish releasing its mined inventory")
				}

				if pirateDialogCount(p, lines) != 1 || pirateDialogCount(otherSocket, lines) != 1 || pirateDialogCount(p, otherLines) != 0 {
					t.Fatal("loot defense chose the wrong dialog or repeated it while taking hits")
				}

				for range 12 {
					s.Tick(1)
				}

				if npc.State != fighting || !npc.aggressors[attacker.ID] {
					t.Fatal("empty mined inventory silently ended loot defense")
				}

				if original {
					id := simulation.EntityID(s.World)
					item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
					item.Mined = true
					p.Craft.CargoContents = append(p.Craft.CargoContents, item)
					p.Craft.CargoRelease()
					s.Tick(1)
					assertPiratePaused(t, npc)

					if npc.aggressors[p.ID] || npc.CollectAfter == 0 || pirateDialogCount(p, s.World.Specification.PirateDialog.LateSurrender) != 1 {
						t.Fatal("a separate cargo release could not surrender after breaking the truce")
					}
				}
			})
		}
	}
}

func hasPirateCargoAction(t *testing.T, s *fixture, socket *testhost.Human, npc *pirate) bool {
	t.Helper()
	packet, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &npc.ship.ID}, s.World.Specification.Protocol)

	if err != nil {
		t.Fatal(err)
	}

	return slices.ContainsFunc(frames(socket), func(frame []byte) bool { return bytes.Equal(frame, packet) })
}

func TestPirateAnnouncesItsHaulWhenLeaving(t *testing.T) {
	for _, scenario := range []struct{ count, full, success int }{{0, 0, 0}, {2, 0, 1}, {8, 1, 0}} {
		t.Run(strconv.Itoa(scenario.count), func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			p.Craft.Name = "Skye"
			npc.State, npc.CargoAccepted, npc.ThinkAfter = collecting, true, 0
			npc.loot = nil

			for len(npc.ship.CargoContents) < scenario.count {
				item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
				npc.ship.CargoContents = append(npc.ship.CargoContents, item)
			}

			s.Update()
			s.World.Tick += pirateDecisionTicks(s)
			s.Update()
			full := chatCount(p, "That's all I can carry. Lucky you.")
			success := chatCount(p, "Pleasure doing business with you Skye. I'll see myself out.")

			if npc.State != returning || full != scenario.full || success != scenario.success {
				t.Fatalf("unexpected departure: state=%d full=%d success=%d", npc.State, full, success)
			}
		})
	}
}

func TestPirateStolenLootRestartsDemandForCollector(t *testing.T) {
	for _, original := range []bool{false, true} {
		t.Run(strconv.FormatBool(original), func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			otherSocket := s.AddPlayer()
			other := otherSocket
			other.Craft.Position = p.Craft.Position
			other.Craft.DockedTo, other.Craft.Launching = nil, 0
			thief, thiefSocket, observer := other, otherSocket, p

			if original {
				thief, thiefSocket, observer = p, p, otherSocket
			}

			// Unmined valuables must still be demanded back after theft.
			item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World))}, s.World.Specification)
			thief.Craft.CargoContents = []simulation.Entity{item}
			npc.loot = []simulation.Entity{item}
			npc.State, npc.CargoAccepted = collecting, true
			p.Controls, otherSocket.Controls = nil, nil
			started := s.World.Tick
			events := []protocol.SimulationEvent{protocol.ItemCollected{By: thief.ID, ItemID: item.ID}}
			s.ItemsCollected(events)
			s.ItemsCollected(events)

			if npc.victim != thief || npc.VictimShipID != thief.Craft.ID || chatCount(thiefSocket, "Hey, that was my haul!") != 1 || hasPirateCargoAction(t, s, thiefSocket, npc) {
				t.Fatal("theft did not protest once and retarget the collector without an early action")
			}

			for _, tick := range []uint64{0, 89, 90, 179, 180, 210, 240, 270, 300, 390, 480, 570} {
				s.World.Tick = started + tick
				s.Update()
				demand := chatCount(thiefSocket, "Give that back or I'll open fire.")

				if tick < 90 && demand != 0 || tick >= 90 && demand != 1 || hasPirateCargoAction(t, s, observer, npc) || hasPirateCargoAction(t, s, thiefSocket, npc) != (tick >= 90) {
					t.Fatalf("incorrect re-demand timing or action recipient at tick %d", tick)
				}

				if tick < 180 && chatCount(thiefSocket, "5") != 0 || tick >= 180 && chatCount(thiefSocket, "5") != 1 {
					t.Fatalf("countdown did not start three seconds after the re-demand at tick %d", tick)
				}

				if tick < 570 && npc.Input.Fire {
					t.Fatalf("pirate fired during the warning at tick %d", tick)
				}
			}

			if npc.State != fighting || !npc.aggressors[thief.ID] || pirateDialogCount(thiefSocket, s.World.Specification.PirateDialog.Attack) != 1 || pirateDialogCount(thiefSocket, s.World.Specification.PirateDialog.CargoDemand) != 0 {
				t.Fatal("re-demand did not flow into the normal attack sequence")
			}

			thief.Craft.CargoRelease()
			s.Update()

			if !npc.CargoAccepted || npc.CollectAfter == 0 || npc.Input.Fire || npc.aggressors[thief.ID] {
				t.Fatal("the collector could not surrender after the restarted countdown")
			}
		})
	}
}

func TestPirateDetectsLootTheftThroughSimulation(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	p.Craft.CargoContents = nil
	p.Craft.SetModuleActive("cargoHatch", true)
	p.Craft.UpdateModules(1)
	p.Input = protocol.Input{CargoHatch: true}
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World)), Position: Vec.Add(p.Craft.Position, Vec.Create(-2, 0))}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	npc.State, npc.CargoAccepted, npc.ThinkAfter = collecting, true, 0
	npc.loot = []simulation.Entity{item}

	s.Tick(1)

	if !slices.Contains(p.Craft.CargoContents, simulation.Entity(item)) || npc.ReDemandAfter == 0 || chatCount(p, "Hey, that was my haul!") != 1 {
		t.Fatal("collecting surrendered loot in the simulation did not trigger the theft sequence")
	}
}

func TestPiratePendingReDemandCanBeInterrupted(t *testing.T) {
	for _, action := range []string{"surrender", "dock", "disconnect", "defeat", "attack"} {
		t.Run(action, func(t *testing.T) {
			s, p, npc := waitingEncounter(t)
			item := p.Craft.CargoContents[0]
			npc.loot = []simulation.Entity{item}
			npc.State, npc.CargoAccepted = collecting, true
			s.ItemsCollected([]protocol.SimulationEvent{protocol.ItemCollected{By: p.ID, ItemID: item.Base().ID}})
			p.Controls = nil

			switch action {
			case "surrender":
				p.Craft.CargoRelease()
			case "dock":
				p.Craft.DockedTo = &npc.HomeID
			case "disconnect":
				p.Online = false
			case "defeat":
				for _, module := range npc.ship.Modules() {
					if module.ModuleBase().Spec.Behavior == "cargoHatch" {
						module.ModuleBase().Mount.Health = 0
					}
				}
			case "attack":
				s.Hits([]protocol.SimulationEvent{protocol.LaserDamage{By: p.ID, TargetID: npc.ship.ID, Damage: 3}})
			}

			s.Update()

			if npc.ReDemandAfter != 0 {
				t.Fatal("interruption left a pending re-demand")
			}

			s.World.Tick += 3 * 30
			s.Update()

			if chatCount(p, "Give that back or I'll open fire.") != 0 || hasPirateCargoAction(t, s, p, npc) {
				t.Fatal("interrupted sequence sent a delayed re-demand or cargo action")
			}
		})
	}
}

func TestPirateIgnoresItsOwnAndUnclaimedPickups(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	item := p.Craft.CargoContents[0]
	npc.loot = []simulation.Entity{item}
	npc.State, npc.CargoAccepted = collecting, true

	s.ItemsCollected([]protocol.SimulationEvent{
		protocol.ItemCollected{By: *npc.ship.PlayerID, ItemID: item.Base().ID},
		protocol.ItemCollected{By: p.ID, ItemID: -999},
	})

	if npc.ReDemandAfter != 0 || chatCount(p, "Hey, that was my haul!") != 0 {
		t.Fatal("pirate accused someone of stealing an unrelated or self-collected item")
	}
}

func TestPirateKeepsItsLootTargetAndWaitsForHeldCargo(t *testing.T) {
	s, p, npc := waitingEncounter(t)
	npc.State, npc.CargoAccepted, npc.CollectAfter = collecting, true, 0

	itemAt := func(distance float64) *objects.Item {
		return objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: new(simulation.EntityID(s.World)), Position: Vec.Add(npc.ship.Position, Vec.Create(distance, 0))}, s.World.Specification)
	}

	missing, near, target, dead, far := itemAt(10), itemAt(100), itemAt(500), itemAt(20), itemAt(800)
	held := p.Craft.CargoContents[0]
	s.Regions.Sleeping.Set(near.ID, near)

	for _, item := range []*objects.Item{target, dead, far} {
		simulation.AddEntity(s.World, item)
	}

	dead.Dead = true
	npc.loot = []simulation.Entity{missing, held, near, target, dead, far}
	npc.lootTarget = target

	input := s.inputFor(npc)

	if npc.lootTarget != target || !slices.Equal(npc.loot, []simulation.Entity{held, near, target, far}) {
		t.Fatal("collection abandoned its target, reordered the list, or retained missing loot")
	}

	if !input.CargoHatch {
		t.Fatal("collection did not open its hatch for the planned loot target")
	}

	target.Dead = true
	input = s.inputFor(npc)

	if npc.lootTarget != near || !slices.Equal(npc.loot, []simulation.Entity{held, near, far}) || !input.CargoHatch {
		t.Fatal("collection did not replace a lost target with the nearest sleeping item")
	}

	near.Dead, far.Dead = true, true
	p.Craft.CargoRelease()
	input = s.inputFor(npc)

	if npc.State != collecting || npc.lootTarget != nil || !slices.Equal(npc.loot, []simulation.Entity{held}) || !input.CargoHatch || input.Thrust != 0 || input.Turn != 0 {
		t.Fatal("collection did not wait for claimed cargo still being released")
	}

	p.Craft.CargoContents = nil
	s.inputFor(npc)

	if npc.State != returning || len(npc.loot) != 0 {
		t.Fatal("collection did not finish when its held cargo disappeared")
	}
}
