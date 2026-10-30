package pirate

import (
	"bytes"
	"encoding/json"
	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/npc/testhost"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
)

type fixture struct {
	*Manager
	*testhost.Host
	World *simulation.World
}

func newFixture(seed float64, catalog specs.Catalog) *fixture {
	host := testhost.New(seed, catalog)
	manager := New(host)
	host.Dispatch = manager.Dispatch
	host.Before = manager.Update

	host.After = func(events []protocol.SimulationEvent) { manager.ItemsCollected(events); manager.Hits(events) }

	return &fixture{Manager: manager, Host: host, World: host.World()}
}

func frames(human *testhost.Human) [][]byte {
	result := make([][]byte, 0, len(human.Controls))

	for _, message := range human.Controls {
		frame, err := protocol.EncodeServerControl(message, human.Craft.Catalog.Protocol)

		if err != nil {
			panic(err)
		}

		result = append(result, frame)
	}

	return result
}

/*
Advance direct encounter checks to the same decision boundary as the session.
*/
func pirateDecisionTicks(s *fixture) uint64 {
	return uint64(max(1, int(math.Ceil((s.World.Specification.NPCMovement.DecisionInterval-1e-9)/s.World.Specification.Simulation.SimulationStep))))
}

func pirateEncounter(t testing.TB) (*fixture, *testhost.Human) {
	return pirateEncounterSeed(t, 25)
}

func pirateEncounterSeed(t testing.TB, seed float64) (*fixture, *testhost.Human) {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	s := newFixture(seed, catalog)
	p := s.AddPlayer()
	home := s.NearestStation(p.Craft.Position)
	p.Craft.Position = Vec.Add(home.Position, Vec.Create(home.Radius+650, 0))
	p.Craft.Face(math.Pi)

	for range 7 {
		id := simulation.EntityID(s.World)
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id}, catalog)
		item.Mined = true
		p.Craft.CargoContents = append(p.Craft.CargoContents, item)
	}

	return s, p
}

func TestPirateDispatchThresholdAndIdentity(t *testing.T) {
	s, p := pirateEncounter(t)
	item := p.Craft.CargoContents[6]
	p.Craft.CargoContents = p.Craft.CargoContents[:6]
	s.Manager.Dispatch()

	if len(s.Pirates) != 0 {
		t.Fatal("six items attracted a pirate")
	}

	p.Craft.CargoContents = append(p.Craft.CargoContents, item)
	s.World.Tick = 30
	s.Manager.Dispatch()
	pirates := s.Pirates

	if len(pirates) != 1 {
		t.Fatal("seven items did not dispatch one pirate")
	}

	npc := pirates[0]

	for _, module := range npc.ship.Modules() {
		if module.ModuleBase().Spec.Behavior == "shieldGenerator" {
			t.Fatal("pirate must spawn without a shield generator")
		}
	}

	if !slices.Contains(s.World.Specification.PirateSpec.Names, npc.ship.Name) || !npc.ship.Hostile || npc.Credits <= 0 || npc.ship.DefinitionID != "courser" {
		t.Fatal("missing NPC identity")
	}

	if npc.ship.NPCState != "Pursuing" {
		t.Fatal("spawned pirate did not expose its current state")
	}

	if npc.Home.ID != s.NearestStation(p.Craft.Position).ID || npc.ship.Position != npc.Home.Position || npc.ship.Launching <= 0 {
		t.Fatal("pirate did not launch from the nearest station")
	}

	s.Manager.Dispatch()

	if len(s.Pirates) != 1 {
		t.Fatal("duplicate dispatch")
	}
}

func TestPirateSurrenderAndSale(t *testing.T) {
	for _, count := range []int{8, 12} {
		t.Run(strconv.Itoa(count), func(t *testing.T) {
			s, p := pirateEncounter(t)
			p.Craft.CargoContents = append(p.Craft.CargoContents, modules.Create("searchLight", simulation.ObjectProperties{World: s.World}, s.World.Specification))

			for len(p.Craft.CargoContents) < count {
				id := simulation.EntityID(s.World)
				item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
				item.Mined = true
				p.Craft.CargoContents = append(p.Craft.CargoContents, item)
			}

			value := 0.0

			for _, item := range p.Craft.CargoContents {
				if _, ok := item.(*objects.Item); ok {
					value += item.Base().Price
				}
			}

			s.Manager.Dispatch()
			npc := s.Pirates[0]
			value = min(value, float64(npc.ship.CargoSpace-1)*p.Craft.CargoContents[0].Base().Price)
			warned := false

			for tick := 0; tick < 30*180; tick++ {
				if npc.State == waiting && !warned {
					warned = true
					p.Input = protocol.Input{CargoRelease: true}
				}

				s.Tick(1)

				if npc.ship.Firing {
					t.Fatal("pirate fired on surrendering player")
				}

				if len(s.Pirates) == 0 {
					break
				}

			}

			if !warned || len(p.Craft.CargoContents) != 1 || npc.State != docked {
				for _, item := range npc.loot {
					t.Logf("remaining %d pos=%v vel=%v dead=%v loaded=%v sleeping=%v; ship vel=%v rotation=%g thrust=%g turn=%g", item.Base().ID, item.Base().Position, item.Base().Velocity, item.Base().Dead, s.World.Entities.Has(item.Base().ID), s.Regions.Sleeping.Has(item.Base().ID), npc.ship.Velocity, npc.ship.Rotation, npc.Input.Thrust, npc.Input.Turn)
				}

				t.Fatalf("surrender did not finish: warned=%v playerCargo=%d state=%d pirateCargo=%d loot=%d pos=%v home=%v dock=%v", warned, len(p.Craft.CargoContents), npc.State, len(npc.ship.CargoContents), len(npc.loot), npc.ship.Position, npc.Home.Position, npc.ship.DockedTo)
			}

			if npc.Credits != 1000+value {
				t.Fatalf("sale balance=%g, want %g", npc.Credits, 1000+value)
			}

			if s.World.Entities.Has(npc.ship.ID) || s.World.Players.Has(*npc.ship.PlayerID) || len(s.Pirates) != 0 {
				t.Fatal("pirate remained in the game after selling its first load")
			}

		})
	}
}

func TestPirateCountdownAndCombat(t *testing.T) {
	s, p := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	// Set up an unobstructed standoff, then run the real flight/weapon simulation.
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(-250, 0))
	npc.ship.Face(math.Pi / 2)
	p.Controls = nil
	warningTick := uint64(0)
	attackTick := uint64(0)
	startingHealth := p.Craft.HullHealthTotal()
	var messageTicks []uint64
	var messages []int
	dialog := s.World.Specification.PirateDialog
	expected := [][]string{dialog.CargoDemand}

	for remaining := 5; remaining > 0; remaining-- {
		var lines []string

		for _, line := range dialog.Countdown {
			lines = append(lines, strings.ReplaceAll(line, "{seconds}", strconv.Itoa(remaining)))
		}

		expected = append(expected, lines)
	}

	expected = append(expected, dialog.CountdownEnd, dialog.Attack)

	for tick := 0; tick < 30*35; tick++ {
		previousFrames := len(frames(p))
		s.Tick(1)

		for _, frame := range frames(p)[previousFrames:] {
			if len(frame) > 3 && frame[1] == 0x43 && frame[3] == byte(s.World.Specification.Protocol.ControlMessageIDs["chat"]) {
				for category, lines := range expected {
					if slices.ContainsFunc(lines, func(text string) bool { return bytes.HasSuffix(frame, []byte(text)) }) {
						messageTicks = append(messageTicks, s.World.Tick)
						messages = append(messages, category)
						break
					}
				}
			}
		}

		if npc.State == waiting && npc.ship.Forward != 0 {
			t.Fatal("waiting pirate kept thrusting")
		}

		if npc.State == waiting && npc.ship.NPCState != "Waiting" {
			t.Fatal("pirate state label did not update when waiting")
		}

		if npc.State == waiting && warningTick == 0 {
			warningTick = s.World.Tick
		}

		if npc.State == waiting && s.World.Tick-warningTick > 120 {
			offset := Vec.Subtract(p.Craft.Position, npc.ship.Position)
			angle := math.Remainder(math.Atan2(offset.Y, offset.X)-npc.ship.Rotation, 2*math.Pi)

			if math.Abs(angle) > .03 {
				t.Fatal("waiting pirate did not turn toward the player")
			}
		}

		if s.World.Tick-warningTick < 690 && npc.ship.Firing {
			t.Fatal("pirate fired before the attack announcement pause finished")
		}

		if npc.State == fighting && attackTick == 0 {
			attackTick = s.World.Tick
		}

		if p.Craft.HullHealthTotal() < startingHealth {
			break
		}
	}

	if p.Craft.HullHealthTotal() >= startingHealth {
		t.Fatalf("pirate failed to damage player; state=%d pos=%v victim=%v fire=%v", npc.State, npc.ship.Position, p.Craft.Position, npc.ship.Firing)
	}

	if npc.ship.NPCState != "Fighting" || !slices.Contains(s.World.Specification.PirateSpec.Names, npc.ship.Name) {
		t.Fatal("pirate state label must update independently of its name")
	}

	if len(messages) != len(expected) {
		t.Fatalf("warning sequence=%v", messages)
	}

	for i, seconds := range []uint64{0, 10, 11, 12, 13, 14, 17, 20} {
		if messages[i] != i {
			t.Fatalf("warning sequence=%v", messages)
		}

		if messageTicks[i]-messageTicks[0] != seconds*30 {
			t.Fatalf("message %d arrived at tick %d", i, messageTicks[i]-messageTicks[0])
		}
	}

	if attackTick != messageTicks[len(messageTicks)-1]+90 {
		t.Fatal("combat did not start three seconds after its announcement")
	}
}

func TestPirateAcceptsCargoDuringCountdownPauses(t *testing.T) {
	for _, seconds := range []int{16, 19, 22} {
		t.Run(strconv.Itoa(seconds), func(t *testing.T) {
			s, p := pirateEncounter(t)
			s.Manager.Dispatch()
			npc := s.Pirates[0]
			npc.ship.Launching = 0
			npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(-250, 0))

			for range 30*seconds + 1 {
				s.Tick(1)
			}

			if npc.State != waiting {
				t.Fatal("pirate attacked before the pause ended")
			}

			p.Craft.CargoRelease()
			s.Tick(1)

			if npc.State != waiting || npc.CollectAfter == 0 {
				t.Fatal("pirate did not accept cargo during the pause")
			}

			for range 30 * (25 - seconds) {
				s.Tick(1)

				if npc.ship.Firing || npc.aggressors[p.ID] || npc.State == fighting {
					t.Fatal("countdown restarted combat after surrender")
				}
			}
		})
	}
}

func TestPirateEscapeToStation(t *testing.T) {
	s, p := pirateEncounter(t)
	p.Craft.Name = "Skye"
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	stationEntity, _ := s.World.Entities.Get(npc.HomeID)
	station := stationEntity.(*objects.Station)
	angle := station.Rotation + station.DockingBays[0]
	direction := Vec.Create(math.Cos(angle), math.Sin(angle))
	p.Craft.Position = Vec.AddScaled(station.Position, direction, station.Radius+600)
	p.Craft.Face(angle + math.Pi)
	npc.ship.Launching = 0
	npc.ship.Position = Vec.AddScaled(p.Craft.Position, direction, 280)
	npc.ship.Face(angle + math.Pi)
	npc.State = fighting
	npc.aggressors[p.ID] = true

	for tick := 0; tick < 30*40 && p.Craft.DockedTo == nil; tick++ {
		// Player controls: steer toward the center of the open bay and hold Up.
		offset := Vec.Subtract(station.Position, p.Craft.Position)
		error := math.Remainder(math.Atan2(offset.Y, offset.X)-p.Craft.Rotation, 2*math.Pi)
		turn := 0.0

		if error > .025 {
			turn = 1
		} else if error < -.025 {
			turn = -1
		}

		p.Input = protocol.Input{Thrust: 1, Turn: turn}
		s.Tick(1)
	}

	if p.Craft.DockedTo == nil || *p.Craft.DockedTo != station.ID || p.Craft.Dead || len(p.Craft.CargoContents) != 7 {
		t.Fatal("player could not escape with cargo by flying into a station")
	}

	s.Tick(1)

	if npc.State != returning || npc.ship.Firing || npc.aggressors[p.ID] {
		t.Fatal("pirate continued attacking a docked player")
	}

	for range 12 {
		s.Tick(1)
	}

	if chatCount(p, "You've gotten away this time Skye") != 1 {
		t.Fatal("docking during combat did not announce the escape exactly once")
	}
}

func TestPirateRetaliationAndCleanup(t *testing.T) {
	s, p := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	otherSocket := s.AddPlayer()
	other := otherSocket
	// An armed player approaches from behind the pirate while the victim is distant.
	old := other.Craft
	s.World.Entities.Delete(old.ID)
	other.Craft = objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: "courser", PlayerID: &other.ID, Position: Vec.Add(p.Craft.Position, Vec.Create(500, 0))})
	other.Craft.ID = other.Craft.ID
	simulation.AddEntity(s.World, other.Craft)
	simulation.AddPlayer(s.World, simulation.Player{ID: other.ID, ShipID: other.Craft.ID})
	ammoID := simulation.EntityID(s.World)
	other.Craft.CargoContents = append(other.Craft.CargoContents, objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: s.World, ID: &ammoID}, s.World.Specification))
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(other.Craft.Position, Vec.Create(150, 0))
	npc.ship.Face(0)
	retaliated := false

	for tick := 0; tick < 30*60 && !npc.ship.Dead; tick++ {
		offset := Vec.Subtract(npc.ship.Position, other.Craft.Position)
		error := math.Remainder(math.Atan2(offset.Y, offset.X)-other.Craft.Rotation, 2*math.Pi)
		turn := 0.0

		if error > .02 {
			turn = 1
		} else if error < -.02 {
			turn = -1
		}

		other.Input = protocol.Input{AutogunActive: true, Fire: math.Abs(error) < .15, Turn: turn}
		s.Tick(1)
		retaliated = retaliated || npc.aggressors[other.ID]
	}

	if !retaliated {
		t.Fatal("real player projectiles did not provoke pirate")
	}

	if npc.ship.HullHealthTotal() >= npc.ship.HullMaxHealth() {
		t.Fatal("player weapons did not damage the pirate")
	}

	npc.ship.Remove()

	s.Tick(1)

	if s.World.Players.Has(*npc.ship.PlayerID) || s.World.Entities.Has(npc.ship.ID) {
		t.Fatal("dead NPC left an observer or ship behind")
	}
}

func TestPirateObserverRange(t *testing.T) {
	s, p := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	// Leave only the NPC observing a remote part of the sector.
	s.World.Entities.Delete(p.Craft.ID)
	s.World.Players.Delete(p.ID)
	view := s.Regions.View(Vec.Vector{}, nil)

	if len(view.Asteroids) == 0 {
		t.Fatal("fixture has no asteroid field")
	}

	npc.ship.Position = view.Asteroids[0].Position
	nearID, farID := simulation.EntityID(s.World), simulation.EntityID(s.World)
	near := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &nearID, Position: Vec.Add(npc.ship.Position, Vec.Create(1500, 0))}, s.World.Specification)
	far := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &farID, Position: Vec.Add(npc.ship.Position, Vec.Create(1501, 0))}, s.World.Specification)
	simulation.AddEntity(s.World, near)
	simulation.AddEntity(s.World, far)
	s.Regions.Sync(s.World, nil)

	if !s.World.Entities.Has(nearID) || s.World.Entities.Has(farID) {
		t.Fatal("NPC loading exceeded its 1,500-unit range")
	}

	generated := 0

	s.Regions.Managed.ForEach(func(_ bool, id int64) {
		if entity, ok := s.World.Entities.Get(id); ok {
			generated++

			if Vec.Distance(entity.Base().Position, npc.ship.Position) > ai.SightRange {
				t.Fatal("procedural entity loaded beyond NPC range")
			}
		}
	})

	if generated == 0 {
		t.Fatal("NPC did not load procedural surroundings")
	}

	npc.ship.Position.X += 10
	s.Regions.Sync(s.World, nil)

	if !s.World.Entities.Has(farID) {
		t.Fatal("moving NPC did not wake nearby objects")
	}
}

func TestPirateSurrenderAfterAttackStopsFire(t *testing.T) {
	s, p := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(-250, 0))
	npc.ship.Launching = 0
	npc.ship.Face(0)

	for range 30 * 25 {
		s.Tick(1)
	}

	if npc.State != fighting {
		t.Fatal("pirate never started the attack")
	}

	p.Input = protocol.Input{CargoRelease: true}

	for range 30 {
		s.Tick(1)
	}

	if npc.ship.Firing || npc.State != waiting || npc.CollectAfter == 0 {
		t.Fatalf("surrender did not stop the ongoing robbery attack: cargo=%d firing=%v state=%d collectAfter=%v releasing=%v", len(p.Craft.CargoContents), npc.ship.Firing, npc.State, npc.CollectAfter, p.Craft.ReleasingCargo())
	}

	for range 30 * 4 {
		s.Tick(1)

		if npc.ship.Firing {
			t.Fatal("pirate resumed firing while cargo was being released")
		}
	}

	if len(p.Craft.CargoContents) != 0 {
		t.Fatal("held surrender did not finish releasing cargo")
	}
}

func TestPiratePursuitThroughAsteroidField(t *testing.T) {
	for _, seed := range []float64{25, 67, 123, 501} {
		t.Run(strconv.Itoa(int(seed)), func(t *testing.T) {
			s, p := pirateEncounterSeed(t, seed)
			view := s.Regions.View(Vec.Vector{}, nil)
			found := false

			for x := -1500.0; x <= 1500 && !found; x += 200 {
				for y := -1500.0; y <= 1500 && !found; y += 200 {
					position := Vec.Create(x, y)
					clear := true

					for _, rock := range view.Asteroids {
						if Vec.Distance(position, rock.Position) < rock.Radius+180 {
							clear = false
							break
						}
					}

					if clear {
						p.Craft.Position = position
						found = true
					}
				}
			}

			if !found {
				t.Fatal("no clear player starting position in fixture")
			}

			s.Regions.Sync(s.World, s.Positions())
			s.Manager.Dispatch()

			if len(s.Pirates) == 0 {
				t.Fatalf("no dispatch: docked=%v dead=%v transit=%g player=%v value=%g home=%+v", p.Craft.DockedTo, p.Craft.Dead, p.Craft.TransitTime, s.World.Players.Has(p.ID), p.Craft.MinedCargoValue(), s.NearestStation(p.Craft.Position))
			}

			npc := s.Pirates[0]

			for range 30 * 180 {
				s.Tick(1)

				if npc.State == waiting {
					return
				}

				if npc.ship.Dead {
					t.Fatal("pirate collided fatally en route to the asteroid field")
				}
			}

			t.Fatalf("pirate failed to reach player in asteroid field: state=%d distance=%g", npc.State, Vec.Distance(npc.ship.Position, p.Craft.Position))
		})
	}
}

func TestPirateUsesMinedValueInsteadOfCargoCount(t *testing.T) {
	for _, scenario := range []struct {
		name  string
		item  string
		count int
		mined bool
		want  bool
	}{
		{"many inexpensive minerals", "gold", 6, true, false},
		{"purchased minerals", "diamond", 7, false, false},
		{"few valuable mined minerals", "diamond", 3, true, true},
		{"ammunition", "autogunAmmo", 120, true, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			s, p := pirateEncounter(t)
			p.Craft.CargoContents = nil

			for range scenario.count {
				id := simulation.EntityID(s.World)
				item := objects.NewItem(scenario.item, simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
				item.Mined = scenario.mined
				p.Craft.CargoContents = append(p.Craft.CargoContents, item)
			}

			p.Craft.CargoContents = append(p.Craft.CargoContents, modules.Create("thrusterSingleXl", simulation.ObjectProperties{World: s.World}, s.World.Specification))
			s.Manager.Dispatch()
			pirates := s.Pirates

			if (len(pirates) > 0) != scenario.want {
				t.Fatalf("dispatch=%d, mined cargo value=%g", len(pirates), p.Craft.MinedCargoValue())
			}

			if scenario.want && pirates[0].Destination != p.Craft.Position {
				t.Fatal("pirate did not receive the distant player's location")
			}
		})
	}

	s, p := pirateEncounter(t)
	p.Craft.CargoContents = p.Craft.CargoContents[:1]
	p.Craft.CargoContents[0].Base().Price = s.World.Specification.PirateSpec.CargoValueThreshold
	s.Manager.Dispatch()

	if len(s.Pirates) != 0 {
		t.Fatal("exactly the threshold should not attract a pirate")
	}
}

func TestPirateSurrenderMessageAfterCombat(t *testing.T) {
	s, p := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(-250, 0))
	npc.State = fighting
	npc.aggressors[p.ID] = true
	npc.Input.Fire = true
	p.Craft.CargoRelease()
	s.Update()

	if npc.Input.Fire || npc.aggressors[p.ID] || npc.State != waiting || npc.CollectAfter == 0 {
		t.Fatal("late surrender did not end hostility toward the victim")
	}

	if !slices.ContainsFunc(frames(p), func(frame []byte) bool { return bytes.HasSuffix(frame, []byte("Changed your mind? Excellent.")) }) {
		t.Fatal("missing late surrender response")
	}
}

func TestPirateCargoDemandIsPrivateAndEndsOnSurrender(t *testing.T) {
	s, p := pirateEncounter(t)
	observerSocket := s.AddPlayer()
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(-250, 0))
	s.Update()

	packet := func(id int64) []byte {
		frame, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &id}, s.World.Specification.Protocol)

		if err != nil {
			t.Fatal(err)
		}

		return frame
	}

	has := func(socket *testhost.Human, frame []byte) bool {
		return slices.ContainsFunc(frames(socket), func(data []byte) bool { return bytes.Equal(data, frame) })
	}

	if !has(p, packet(npc.ship.ID)) || has(observerSocket, packet(npc.ship.ID)) {
		t.Fatal("cargo action was not private to the threatened player")
	}

	p.Craft.CargoRelease()
	s.Update()

	if !has(p, packet(0)) || has(observerSocket, packet(0)) {
		t.Fatal("surrender did not clear the private cargo action")
	}
}

func TestPirateAnnouncesStrandingAndDestructionOnce(t *testing.T) {
	s, p := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]
	npc.ship.Launching = 0
	npc.ship.DockedTo = nil
	npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(800, 0))
	engine := npc.ship.Engine()
	objects.Damage(engine.ModuleBase().Mount.Hull, 10000)
	npc.ship.Update(0)

	if npc.ship.Dead || !npc.ship.Stranded() {
		t.Fatal("fixture did not leave the pirate stranded")
	}

	s.Update()

	if npc.State != stranded {
		t.Fatal("NPC did not enter its stranded state")
	}

	s.Update()

	if pirateDialogCount(p, s.World.Specification.PirateDialog.Stranded) != 1 || chatCount(p, "AHH!") != 0 {
		t.Fatal("stranding message was missing, repeated, or treated as death")
	}

	for _, segment := range npc.ship.Segments {
		if segment.Hull && segment.Core {
			objects.Damage(segment, 10000)
		}
	}

	npc.ship.Update(0)
	s.Update()
	s.Update()

	if chatCount(p, "AHH!") != 1 || pirateDialogCount(p, s.World.Specification.PirateDialog.Stranded) != 1 || len(s.Pirates) != 0 {
		t.Fatal("full destruction did not produce one final message and cleanup")
	}
}

func TestPirateDestroyedDirectlyDoesNotAnnounceStranding(t *testing.T) {
	s, socket := pirateEncounter(t)
	s.Manager.Dispatch()
	npc := s.Pirates[0]

	for _, segment := range npc.ship.Segments {
		if segment.Hull && segment.Core {
			objects.Damage(segment, 10000)
		}
	}

	s.Update()
	npc.ship.Update(0)
	s.Update()

	if pirateDialogCount(socket, s.World.Specification.PirateDialog.Stranded) != 0 {
		t.Fatal("doomed pirate briefly announced being stranded")
	}

	if !slices.ContainsFunc(frames(socket), func(frame []byte) bool { return bytes.HasSuffix(frame, []byte("AHH!")) }) {
		t.Fatal("destroyed pirate did not scream")
	}
}

func TestDockingCallsOffAnOngoingPirateEncounter(t *testing.T) {
	for _, state := range []int{pursuing, waiting, fighting, search} {
		t.Run(strconv.Itoa(state), func(t *testing.T) {
			s, p := pirateEncounter(t)
			p.Craft.Name = "Skye"
			s.Manager.Dispatch()
			npc := s.Pirates[0]
			npc.ship.Launching = 0
			npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(-250, 0))
			npc.State = state
			npc.aggressors[p.ID] = true
			npc.Input.Fire = true
			npc.ThinkAfter = 10
			npc.loot = append(npc.loot, p.Craft.CargoContents...)
			p.Craft.DockedTo = &npc.HomeID
			s.Update()

			if npc.State != returning || npc.Input.Fire || npc.aggressors[p.ID] || len(npc.loot) != 0 {
				t.Fatal("docking did not immediately call off the encounter")
			}

			id := int64(0)
			cleared, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &id}, s.World.Specification.Protocol)

			if err != nil {
				t.Fatal(err)
			}

			found := false

			for _, frame := range frames(p) {
				found = found || bytes.Equal(frame, cleared)
			}

			if !found {
				t.Fatal("docking did not remove the cargo release action")
			}

			lateHit := []protocol.SimulationEvent{protocol.CollisionEvent{By: p.ID, B: npc.ship.ID, Damage: [2]float64{0, 3}}}
			s.Hits(lateHit)
			s.World.Tick += pirateDecisionTicks(s)
			s.Update()

			if npc.aggressors[p.ID] || chatCount(p, "You've gotten away this time Skye") != 1 {
				t.Fatal("escape message was missing or repeated")
			}

			p.Craft.Launch()
			s.Hits(lateHit)
			s.World.Tick += pirateDecisionTicks(s)
			s.Update()

			if npc.State != returning || npc.Input.Fire || npc.aggressors[p.ID] {
				t.Fatal("launching restarted the old encounter")
			}

			p.Craft.Launching = 0
			s.Hits(lateHit)

			if !npc.aggressors[p.ID] {
				t.Fatal("a fresh attack after escaping could not provoke the pirate")
			}
		})
	}
}

func TestDockingCallsOffOnlyThePlayerWhoEscaped(t *testing.T) {
	for _, victimEscapes := range []bool{false, true} {
		t.Run(strconv.FormatBool(victimEscapes), func(t *testing.T) {
			s, p := pirateEncounter(t)
			p.Craft.Name = "Skye"
			otherSocket := s.AddPlayer()
			other := otherSocket
			otherSocket.Craft.Name = "Robin"
			s.Manager.Dispatch()
			npc := s.Pirates[0]
			npc.ship.Launching = 0
			npc.ship.Position = Vec.Add(p.Craft.Position, Vec.Create(-250, 0))
			npc.ship.Face(0)
			npc.State = fighting
			npc.aggressors[p.ID], npc.aggressors[other.ID] = true, true
			other.Craft.Position = p.Craft.Position
			escaped, active := other, p

			if victimEscapes {
				escaped, active = p, other
			}

			escaped.Craft.DockedTo = &npc.HomeID
			npc.Input.Fire = true
			npc.ThinkAfter = 10
			s.Update()

			if npc.aggressors[escaped.ID] || !npc.aggressors[active.ID] || !npc.Input.Fire {
				t.Fatal("docking did not end only the escaped player's hostility")
			}

			escaped.Craft.Launch()
			s.World.Tick += pirateDecisionTicks(s)
			s.Update()

			if npc.aggressors[escaped.ID] || !npc.aggressors[active.ID] || chatCount(p, "You've gotten away this time "+escaped.Craft.Name) != 1 {
				t.Fatal("the escaped player became a target again or received repeated messages")
			}
		})
	}
}

func TestPirateEquipmentDefeat(t *testing.T) {
	for _, equipment := range []string{"cargoHatch", "cannonSm"} {
		for _, state := range []int{waiting, fighting, collecting, search, returning} {
			t.Run(equipment+"/"+stateNames[state], func(t *testing.T) {
				s, p, npc := waitingEncounter(t)
				npc.State = state
				npc.aggressors[p.ID] = true
				npc.Input.Fire = true
				npc.AttackAfter, npc.TauntAfter, npc.CollectAfter = 10, 20, 30
				npc.SearchExpired = true
				npc.loot = append(npc.loot, p.Craft.CargoContents...)
				npc.ThinkAfter = 1e9
				damaged := 0

				for _, module := range npc.ship.Modules() {
					data := module.ModuleBase()

					if data.Type != equipment && data.Spec.Behavior != equipment {
						continue
					}

					npc.ship.SetModuleActive(data.Type, true)
					objects.Damage(npc.ship.SegmentsAtMount(data.Mount)[0], 10000)
					damaged++

					if equipment == "cannonSm" && damaged == 1 {
						s.Update()

						if npc.Defeated || chatCount(p, "You win this time, I'm leaving!") != 0 {
							t.Fatal("losing one cannon defeated the pirate")
						}
					}
				}

				if damaged == 0 {
					t.Fatal("fixture did not damage any equipment")
				}

				s.Update()

				if !npc.Defeated || npc.State != returning || npc.Input.Fire || npc.Input.AutogunActive || len(npc.aggressors) != 0 || len(npc.loot) != 0 || npc.CollectAfter != 0 || npc.AttackAfter != 0 || npc.TauntAfter != 0 {
					t.Fatalf("defeat did not end combat and collection: state=%s input=%+v", stateNames[npc.State], npc.Input)
				}

				cleared, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: new(int64)}, s.World.Specification.Protocol)

				if err != nil || !slices.ContainsFunc(frames(p), func(frame []byte) bool { return bytes.Equal(frame, cleared) }) {
					t.Fatal("defeat did not clear the cargo demand")
				}

				s.Hits([]protocol.SimulationEvent{protocol.LaserDamage{By: p.ID, TargetID: npc.ship.ID, Damage: 3}})
				s.World.Tick += pirateDecisionTicks(s)
				s.Update()

				if npc.State != returning || npc.Input.Fire || len(npc.aggressors) != 0 || chatCount(p, "You win this time, I'm leaving!") != 1 {
					t.Fatal("defeated pirate resumed fighting or repeated its defeat message")
				}

				for range 30 * 120 {
					if npc.State == docked {
						break
					}

					s.Tick(1)
				}

				if npc.ship.Dead || npc.ship.DockedTo == nil || *npc.ship.DockedTo != npc.HomeID || npc.State != docked || s.World.Entities.Has(npc.ship.ID) {
					t.Fatalf("defeated pirate did not dock at its start station: state=%s position=%v home=%v", stateNames[npc.State], npc.ship.Position, npc.Home.Position)
				}
			})
		}
	}
}

func TestBehaviorRestoresAccountAndCargoReferences(t *testing.T) {
	for _, state := range []int{waiting, search, collecting, returning, stranded} {
		t.Run(stateNames[state], func(t *testing.T) {
			source, victim := pirateEncounter(t)
			aggressor := source.AddPlayer()
			source.World.Tick = 4200
			controller := source.spawn(victim, source.NearestStation(victim.Craft.Position))
			controller.State, controller.Credits = state, 123
			controller.Search = ai.Search{Origin: Vec.Create(150, 230), Heading: .5, Angle: 12}
			controller.Destination = Vec.Create(200, 300)
			controller.WarnedAt, controller.ThinkAfter, controller.SearchStartedAt = 130, 141, 135
			controller.AttackAfter, controller.TauntAfter, controller.CollectAfter, controller.ReDemandAfter = 148, 150, 146, 145
			controller.Countdown, controller.Following, controller.PlayerSeen, controller.CargoAccepted = 2, true, true, true
			controller.aggressors[victim.ID], controller.aggressors[aggressor.ID] = true, true
			controller.Input = protocol.Input{Thrust: .4, Turn: -.5, CargoHatch: true}
			item := objects.NewItem("gold", simulation.ObjectProperties{World: source.World, ID: new(simulation.EntityID(source.World)), Position: Vec.Create(800, 900)}, source.World.Specification)
			simulation.AddEntity(source.World, item)
			cargo := objects.NewItem("diamond", simulation.ObjectProperties{World: source.World, ID: new(simulation.EntityID(source.World))}, source.World.Specification)
			victim.Craft.CargoContents = append(victim.Craft.CargoContents, cargo)
			controller.loot, controller.lootTarget = []simulation.Entity{item, cargo}, item
			saved := source.Capture()[0]

			restored := newFixture(25, source.World.Specification)
			restored.NextID = 100
			restored.World.Tick = source.World.Tick
			currentVictim, currentAggressor := restored.AddPlayer(), restored.AddPlayer()
			currentVictim.Account, currentAggressor.Account = victim.Account, aggressor.Account
			currentVictim.Craft.ID = victim.Craft.ID
			held, err := objects.RestoreEntity(objects.CaptureEntity(cargo), restored.World)

			if err != nil {
				t.Fatal(err)
			}

			currentVictim.Craft.CargoContents = append(currentVictim.Craft.CargoContents, held)
			loose, err := objects.RestoreEntity(objects.CaptureEntity(item), restored.World)

			if err != nil {
				t.Fatal(err)
			}

			restored.Regions.Sleeping.Set(item.ID, loose)
			entity, err := objects.RestoreEntity(objects.CaptureEntity(controller.ship), restored.World)

			if err != nil {
				t.Fatal(err)
			}

			ship := entity.(*objects.Ship)
			ship.PlayerID = new(restored.NextObserverID())
			simulation.AddEntity(restored.World, ship)

			if err := restored.Restore(ship, saved.State); err != nil {
				t.Fatal(err)
			}

			actual := restored.Pirates[0]

			if actual.victim != currentVictim || !actual.aggressors[currentVictim.ID] || !actual.aggressors[currentAggressor.ID] {
				t.Fatal("persistent accounts were not rebound to current observers")
			}

			if actual.ammunition != ship.CargoContents[0] || len(actual.loot) != 2 || actual.loot[0] != loose || actual.loot[1] != held || actual.lootTarget != loose {
				t.Fatal("restored references do not point to the ordinary cargo and world entities")
			}

			if ship.NPCState != stateNames[state] || !ship.Hostile || !restored.World.Players.Has(*ship.PlayerID) || restored.Inputs[*ship.PlayerID].Input != controller.Input {
				t.Fatal("restored controller lost its state, observer, or cached input")
			}

			if got := restored.Capture()[0]; !reflect.DeepEqual(got, saved) {
				t.Fatalf("semantic state changed across restore:\n%s\n%s", saved.State, got.State)
			}
		})
	}
}

func TestRestoreRejectsUnknownAccountAndState(t *testing.T) {
	fixture, victim := pirateEncounter(t)
	controller := fixture.spawn(victim, fixture.NearestStation(victim.Craft.Position))

	for _, saved := range []savedPirate{{Victim: "unknown"}, {Victim: victim.Account, state: state{State: 99}}} {
		data, err := json.Marshal(saved)

		if err != nil {
			t.Fatal(err)
		}

		if fixture.Restore(controller.ship, data) == nil {
			t.Fatal("invalid persisted state was accepted")
		}
	}
}

/*
Saved state remains a flat object so existing worlds keep their encounter clocks.
*/
func TestSavedStateKeepsExistingKeys(t *testing.T) {
	data, err := json.Marshal(savedPirate{})

	if err != nil {
		t.Fatal(err)
	}

	var fields map[string]json.RawMessage

	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}

	keys := []string{}

	for key := range fields {
		keys = append(keys, key)
	}

	slices.Sort(keys)
	expected := []string{"Aggressors", "Ammunition", "AttackAfter", "CargoAccepted", "CollectAfter", "Countdown", "Credits", "Defeated", "Destination", "Following", "Home", "HomeID", "Input", "Loot", "LootTarget", "PlayerSeen", "ReDemandAfter", "Search", "SearchExpired", "SearchStartedAt", "SpawnedAt", "State", "TauntAfter", "ThinkAfter", "Victim", "VictimReleasingCargo", "VictimShipID", "VictimVisible", "WarnedAt"}

	if !slices.Equal(keys, expected) {
		t.Fatalf("persisted keys changed: %v", keys)
	}
}
