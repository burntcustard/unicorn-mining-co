package network

import (
	"bytes"
	"math"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func pirateEncounter(t testing.TB) (*GameSession, *playerRecord, *soundSocket) {
	return pirateEncounterSeed(t, 25)
}

func pirateEncounterSeed(t testing.TB, seed float64) (*GameSession, *playerRecord, *soundSocket) {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	s := NewGameSession(seed, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, socket)
	p := s.playersBySocket[socket]
	home := s.nearestStation(p.ship.Position)
	p.ship.Position = Vec.Add(home.Position, Vec.Create(home.Radius+650, 0))
	p.ship.Face(math.Pi)

	for range 7 {
		id := simulation.EntityID(s.World)
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id}, catalog)
		item.Mined = true
		p.ship.CargoContents = append(p.ship.CargoContents, item)
	}

	return s, p, socket
}

func advanceEncounter(s *GameSession, socket *soundSocket) {
	p := s.playersBySocket[socket]
	s.Receive(protocol.Control{Type: "snapshotAck", Sequence: p.snapshotSequence}, socket)
	s.Tick(1)
}

func TestPirateDispatchThresholdAndIdentity(t *testing.T) {
	s, p, _ := pirateEncounter(t)
	item := p.ship.CargoContents[6]
	p.ship.CargoContents = p.ship.CargoContents[:6]
	s.dispatchPirates()

	if len(s.sectors[s.currentSector].pirates) != 0 {
		t.Fatal("six items attracted a pirate")
	}

	p.ship.CargoContents = append(p.ship.CargoContents, item)
	s.World.Tick = 30
	s.dispatchPirates()
	pirates := s.sectors[s.currentSector].pirates

	if len(pirates) != 1 {
		t.Fatal("seven items did not dispatch one pirate")
	}

	npc := pirates[0]

	for _, module := range npc.ship.Modules() {
		if module.ModuleBase().Spec.Behavior == "shieldGenerator" {
			t.Fatal("pirate must spawn without a shield generator")
		}
	}

	if npc.ship.Name != "Pirate" || !npc.ship.Hostile || npc.credits <= 0 || npc.ship.DefinitionID != "courser" {
		t.Fatal("missing NPC identity")
	}

	if npc.ship.NPCState != "Pursuing" {
		t.Fatal("spawned pirate did not expose its current state")
	}

	if npc.home.ID != s.nearestStation(p.ship.Position).ID || npc.ship.Position != npc.home.Position || npc.ship.Launching <= 0 {
		t.Fatal("pirate did not launch from the nearest station")
	}

	s.dispatchPirates()

	if len(s.sectors[s.currentSector].pirates) != 1 {
		t.Fatal("duplicate dispatch")
	}
}

func TestPirateSurrenderAndSale(t *testing.T) {
	for _, count := range []int{8, 12} {
		t.Run(strconv.Itoa(count), func(t *testing.T) {
			s, p, socket := pirateEncounter(t)
			p.ship.CargoContents = append(p.ship.CargoContents, modules.Create("searchLight", simulation.ObjectProperties{World: s.World}, s.World.Specification))

			for len(p.ship.CargoContents) < count {
				id := simulation.EntityID(s.World)
				item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
				item.Mined = true
				p.ship.CargoContents = append(p.ship.CargoContents, item)
			}

			value := 0.0

			for _, item := range p.ship.CargoContents {
				if _, ok := item.(*objects.Item); ok {
					value += item.Base().Price
				}
			}

			s.dispatchPirates()
			npc := s.sectors[s.currentSector].pirates[0]
			value = min(value, float64(npc.ship.CargoSpace-1)*p.ship.CargoContents[0].Base().Price)
			warned := false

			for tick := 0; tick < 30*180; tick++ {
				if npc.state == pirateWaiting && !warned {
					warned = true
					p.lastInput = protocol.Input{CargoRelease: true}
				}

				advanceEncounter(s, socket)

				if npc.ship.Firing {
					t.Fatal("pirate fired on surrendering player")
				}

				if len(s.sectors[s.currentSector].pirates) == 0 {
					break
				}

			}

			if !warned || len(p.ship.CargoContents) != 1 || npc.state != pirateDocked {
				for _, item := range npc.loot {
					t.Logf("remaining %d pos=%v vel=%v dead=%v loaded=%v sleeping=%v; ship vel=%v rotation=%g thrust=%g turn=%g", item.Base().ID, item.Base().Position, item.Base().Velocity, item.Base().Dead, s.World.Entities.Has(item.Base().ID), s.regions.sleeping.Has(item.Base().ID), npc.ship.Velocity, npc.ship.Rotation, npc.input.Thrust, npc.input.Turn)
				}

				t.Fatalf("surrender did not finish: warned=%v playerCargo=%d state=%d pirateCargo=%d loot=%d pos=%v home=%v dock=%v", warned, len(p.ship.CargoContents), npc.state, len(npc.ship.CargoContents), len(npc.loot), npc.ship.Position, npc.home.Position, npc.ship.DockedTo)
			}

			if npc.credits != 1000+value {
				t.Fatalf("sale balance=%g, want %g", npc.credits, 1000+value)
			}

			if s.World.Entities.Has(npc.ship.ID) || s.World.Players.Has(*npc.ship.PlayerID) || len(s.sectors[s.currentSector].pirates) != 0 {
				t.Fatal("pirate remained in the game after selling its first load")
			}

		})
	}
}

func TestPirateCountdownAndCombat(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	// Set up an unobstructed standoff, then run the real flight/weapon simulation.
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(-250, 0))
	npc.ship.Face(math.Pi / 2)
	socket.frames = nil
	warningTick := uint64(0)
	attackTick := uint64(0)
	startingHealth := p.ship.HullHealthTotal()
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
		previousFrames := len(socket.frames)
		advanceEncounter(s, socket)

		for _, frame := range socket.frames[previousFrames:] {
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

		if npc.state == pirateWaiting && npc.ship.Forward != 0 {
			t.Fatal("waiting pirate kept thrusting")
		}

		if npc.state == pirateWaiting && npc.ship.NPCState != "Waiting" {
			t.Fatal("pirate state label did not update when waiting")
		}

		if npc.state == pirateWaiting && warningTick == 0 {
			warningTick = s.World.Tick
		}

		if npc.state == pirateWaiting && s.World.Tick-warningTick > 120 {
			offset := Vec.Subtract(p.ship.Position, npc.ship.Position)
			angle := math.Remainder(math.Atan2(offset.Y, offset.X)-npc.ship.Rotation, 2*math.Pi)

			if math.Abs(angle) > .03 {
				t.Fatal("waiting pirate did not turn toward the player")
			}
		}

		if s.World.Tick-warningTick < 690 && npc.ship.Firing {
			t.Fatal("pirate fired before the attack announcement pause finished")
		}

		if npc.state == pirateFighting && attackTick == 0 {
			attackTick = s.World.Tick
		}

		if p.ship.HullHealthTotal() < startingHealth {
			break
		}
	}

	if p.ship.HullHealthTotal() >= startingHealth {
		t.Fatalf("pirate failed to damage player; state=%d pos=%v victim=%v fire=%v", npc.state, npc.ship.Position, p.ship.Position, npc.ship.Firing)
	}

	if npc.ship.NPCState != "Fighting" || npc.ship.Name != "Pirate" {
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
			s, p, socket := pirateEncounter(t)
			s.dispatchPirates()
			npc := s.sectors[s.currentSector].pirates[0]
			npc.ship.Launching = 0
			npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(-250, 0))

			for range 30*seconds + 1 {
				advanceEncounter(s, socket)
			}

			if npc.state != pirateWaiting {
				t.Fatal("pirate attacked before the pause ended")
			}

			p.ship.CargoRelease()
			advanceEncounter(s, socket)

			if npc.state != pirateWaiting || npc.collectAfter == 0 {
				t.Fatal("pirate did not accept cargo during the pause")
			}

			for range 30 * (25 - seconds) {
				advanceEncounter(s, socket)

				if npc.ship.Firing || npc.aggressors[p.playerID] || npc.state == pirateFighting {
					t.Fatal("countdown restarted combat after surrender")
				}
			}
		})
	}
}

func TestPirateEscapeToStation(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	s.Receive(protocol.Control{Type: "profile", DisplayName: "Skye"}, socket)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	stationEntity, _ := s.World.Entities.Get(npc.homeID)
	station := stationEntity.(*objects.Station)
	angle := station.Rotation + station.DockingBays[0]
	direction := Vec.Create(math.Cos(angle), math.Sin(angle))
	p.ship.Position = Vec.AddScaled(station.Position, direction, station.Radius+600)
	p.ship.Face(angle + math.Pi)
	npc.ship.Launching = 0
	npc.ship.Position = Vec.AddScaled(p.ship.Position, direction, 280)
	npc.ship.Face(angle + math.Pi)
	npc.state = pirateFighting
	npc.aggressors[p.playerID] = true

	for tick := 0; tick < 30*40 && p.ship.DockedTo == nil; tick++ {
		// Player controls: steer toward the center of the open bay and hold Up.
		offset := Vec.Subtract(station.Position, p.ship.Position)
		error := math.Remainder(math.Atan2(offset.Y, offset.X)-p.ship.Rotation, 2*math.Pi)
		turn := 0.0

		if error > .025 {
			turn = 1
		} else if error < -.025 {
			turn = -1
		}

		p.lastInput = protocol.Input{Thrust: 1, Turn: turn}
		advanceEncounter(s, socket)
	}

	if p.ship.DockedTo == nil || *p.ship.DockedTo != station.ID || p.ship.Dead || len(p.ship.CargoContents) != 7 {
		t.Fatal("player could not escape with cargo by flying into a station")
	}

	advanceEncounter(s, socket)

	if npc.state != pirateReturning || npc.ship.Firing || npc.aggressors[p.playerID] {
		t.Fatal("pirate continued attacking a docked player")
	}

	for range 12 {
		advanceEncounter(s, socket)
	}

	if chatCount(socket, "You've gotten away this time Skye") != 1 {
		t.Fatal("docking during combat did not announce the escape exactly once")
	}
}

func TestPirateRetaliationAndCleanup(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	otherSocket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, otherSocket)
	other := s.playersBySocket[otherSocket]
	// An armed player approaches from behind the pirate while the victim is distant.
	old := other.ship
	s.World.Entities.Delete(old.ID)
	other.ship = objects.CreatePlayerShip(s.World, objects.Properties{DefinitionID: "courser", PlayerID: &other.playerID, Position: Vec.Add(p.ship.Position, Vec.Create(500, 0))})
	other.shipID = other.ship.ID
	simulation.AddEntity(s.World, other.ship)
	simulation.AddPlayer(s.World, simulation.Player{ID: other.playerID, ShipID: other.shipID})
	ammoID := simulation.EntityID(s.World)
	other.ship.CargoContents = append(other.ship.CargoContents, objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: s.World, ID: &ammoID}, s.World.Specification))
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(other.ship.Position, Vec.Create(150, 0))
	npc.ship.Face(0)
	retaliated := false

	for tick := 0; tick < 30*60 && !npc.ship.Dead; tick++ {
		offset := Vec.Subtract(npc.ship.Position, other.ship.Position)
		error := math.Remainder(math.Atan2(offset.Y, offset.X)-other.ship.Rotation, 2*math.Pi)
		turn := 0.0

		if error > .02 {
			turn = 1
		} else if error < -.02 {
			turn = -1
		}

		other.lastInput = protocol.Input{AutogunActive: true, Fire: math.Abs(error) < .15, Turn: turn}
		advanceEncounter(s, socket)
		s.Receive(protocol.Control{Type: "snapshotAck", Sequence: other.snapshotSequence}, otherSocket)
		retaliated = retaliated || npc.aggressors[other.playerID]
	}

	if !retaliated {
		t.Fatal("real player projectiles did not provoke pirate")
	}

	if npc.ship.HullHealthTotal() >= npc.ship.HullMaxHealth() {
		t.Fatal("player weapons did not damage the pirate")
	}

	npc.ship.Remove()

	advanceEncounter(s, socket)

	if s.World.Players.Has(*npc.ship.PlayerID) || s.World.Entities.Has(npc.ship.ID) {
		t.Fatal("dead NPC left an observer or ship behind")
	}
}

func TestPirateObserverRange(t *testing.T) {
	s, p, _ := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	// Leave only the NPC observing a remote part of the sector.
	s.World.Entities.Delete(p.shipID)
	s.World.Players.Delete(p.playerID)
	view := s.regions.View(Vec.Vector{}, nil)

	if len(view.Asteroids) == 0 {
		t.Fatal("fixture has no asteroid field")
	}

	npc.ship.Position = view.Asteroids[0].Position
	nearID, farID := simulation.EntityID(s.World), simulation.EntityID(s.World)
	near := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &nearID, Position: Vec.Add(npc.ship.Position, Vec.Create(1500, 0))}, s.World.Specification)
	far := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &farID, Position: Vec.Add(npc.ship.Position, Vec.Create(1501, 0))}, s.World.Specification)
	simulation.AddEntity(s.World, near)
	simulation.AddEntity(s.World, far)
	s.regions.Sync(s.World, nil)

	if !s.World.Entities.Has(nearID) || s.World.Entities.Has(farID) {
		t.Fatal("NPC loading exceeded its 1,500-unit range")
	}

	generated := 0

	s.regions.managed.ForEach(func(_ bool, id int64) {
		if entity, ok := s.World.Entities.Get(id); ok {
			generated++

			if Vec.Distance(entity.Base().Position, npc.ship.Position) > pirateRange {
				t.Fatal("procedural entity loaded beyond NPC range")
			}
		}
	})

	if generated == 0 {
		t.Fatal("NPC did not load procedural surroundings")
	}

	npc.ship.Position.X += 10
	s.regions.Sync(s.World, nil)

	if !s.World.Entities.Has(farID) {
		t.Fatal("moving NPC did not wake nearby objects")
	}
}

func BenchmarkPirateSession(b *testing.B) {
	for _, count := range []int{0, 1, 8} {
		b.Run(strconv.Itoa(count), func(b *testing.B) {
			catalog, _ := specs.Load()
			s := NewGameSession(25, catalog)
			socket := &benchmarkSocket{}
			s.Receive(protocol.Control{Type: "hello"}, socket)
			p := s.playersBySocket[socket]
			home := s.nearestStation(p.ship.Position)
			p.ship.Position = Vec.Add(home.Position, Vec.Create(home.Radius+700, 0))

			for range 7 {
				id := simulation.EntityID(s.World)
				item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id}, catalog)
				item.Mined = true
				p.ship.CargoContents = append(p.ship.CargoContents, item)
			}

			for i := 0; i < count; i++ {
				npc := s.spawnPirate(p, home)
				npc.ship.Launching = 0
				npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(float64(i%4)*160-240, float64(i/4)*200+350))
			}

			p.pirateAfter = math.MaxUint64
			b.ReportAllocs()
			b.ResetTimer()

			for b.Loop() {
				for _, npc := range s.sectors[s.currentSector].pirates {
					npc.state = pirateWaiting
					npc.warnedAt = float64(s.World.Tick) * catalog.Simulation.SimulationStep
					npc.spawnedAt = npc.warnedAt
				}

				s.Receive(protocol.Control{Type: "snapshotAck", Sequence: socket.sequence}, socket)
				s.Tick(1)
			}
		})
	}
}

func TestCargoReleaseRequiresContinuousHold(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	p.pirateAfter = math.MaxUint64
	p.lastInput = protocol.Input{CargoRelease: true}

	for range 15 {
		advanceEncounter(s, socket)
	}

	p.lastInput = protocol.Input{}
	advanceEncounter(s, socket)
	p.lastInput = protocol.Input{CargoRelease: true}

	for range 29 {
		advanceEncounter(s, socket)
	}

	if len(p.ship.CargoContents) != 7 {
		t.Fatal("short taps accumulated into an accidental cargo release")
	}

	advanceEncounter(s, socket)

	if len(p.ship.CargoContents) != 6 {
		t.Fatalf("first release should eject one item, cargo=%d", len(p.ship.CargoContents))
	}

	p.lastInput = protocol.Input{CargoHatch: true}

	for range 50 {
		advanceEncounter(s, socket)
	}

	if len(p.ship.CargoContents) != 0 {
		t.Fatal("staggered release did not finish after keyup")
	}

	count := 0

	s.World.Entities.ForEach(func(e simulation.Entity, _ int64) {
		if e.Base().DroppedBy != nil && *e.Base().DroppedBy == p.playerID {
			count++
		}
	})

	if count != 7 {
		t.Fatalf("cargo release created %d objects, want 7", count)
	}

	for range 60 {
		advanceEncounter(s, socket)
	}

	if len(p.ship.CargoContents) != 0 {
		t.Fatal("release immediately recollected its cargo")
	}
}

func TestPirateSurrenderAfterAttackStopsFire(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(-250, 0))
	npc.ship.Launching = 0
	npc.ship.Face(0)

	for range 30 * 25 {
		advanceEncounter(s, socket)
	}

	if npc.state != pirateFighting {
		t.Fatal("pirate never started the attack")
	}

	p.lastInput = protocol.Input{CargoRelease: true}

	for range 31 + 45 {
		advanceEncounter(s, socket)
	}

	if len(p.ship.CargoContents) != 0 || npc.ship.Firing || npc.state != pirateWaiting || npc.collectAfter == 0 {
		t.Fatal("surrender did not stop the ongoing robbery attack")
	}
}

func TestPiratePursuitThroughAsteroidField(t *testing.T) {
	for _, seed := range []float64{25, 67, 123, 501} {
		t.Run(strconv.Itoa(int(seed)), func(t *testing.T) {
			s, p, socket := pirateEncounterSeed(t, seed)
			view := s.regions.View(Vec.Vector{}, nil)
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
						p.ship.Position = position
						found = true
					}
				}
			}

			if !found {
				t.Fatal("no clear player starting position in fixture")
			}

			s.regions.Sync(s.World, s.positions())
			s.dispatchPirates()

			if len(s.sectors[s.currentSector].pirates) == 0 {
				t.Fatalf("no dispatch: docked=%v dead=%v transit=%g player=%v value=%g home=%+v", p.ship.DockedTo, p.ship.Dead, p.ship.TransitTime, s.World.Players.Has(p.playerID), p.ship.MinedCargoValue(), s.nearestStation(p.ship.Position))
			}

			npc := s.sectors[s.currentSector].pirates[0]

			for range 30 * 180 {
				advanceEncounter(s, socket)

				if npc.state == pirateWaiting {
					return
				}

				if npc.ship.Dead {
					t.Fatal("pirate collided fatally en route to the asteroid field")
				}
			}

			t.Fatalf("pirate failed to reach player in asteroid field: state=%d distance=%g", npc.state, Vec.Distance(npc.ship.Position, p.ship.Position))
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
			s, p, _ := pirateEncounter(t)
			p.ship.CargoContents = nil

			for range scenario.count {
				id := simulation.EntityID(s.World)
				item := objects.NewItem(scenario.item, simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
				item.Mined = scenario.mined
				p.ship.CargoContents = append(p.ship.CargoContents, item)
			}

			p.ship.CargoContents = append(p.ship.CargoContents, modules.Create("thrusterSingleXl", simulation.ObjectProperties{World: s.World}, s.World.Specification))
			s.dispatchPirates()
			pirates := s.sectors[s.currentSector].pirates

			if (len(pirates) > 0) != scenario.want {
				t.Fatalf("dispatch=%d, mined cargo value=%g", len(pirates), p.ship.MinedCargoValue())
			}

			if scenario.want && pirates[0].destination != p.ship.Position {
				t.Fatal("pirate did not receive the distant player's location")
			}
		})
	}

	s, p, _ := pirateEncounter(t)
	p.ship.CargoContents = p.ship.CargoContents[:1]
	p.ship.CargoContents[0].Base().Price = s.World.Specification.PirateSpec.CargoValueThreshold
	s.dispatchPirates()

	if len(s.sectors[s.currentSector].pirates) != 0 {
		t.Fatal("exactly the threshold should not attract a pirate")
	}
}

func TestCargoReleaseRetainsModulesAndOpenedAmmo(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	p.pirateAfter = math.MaxUint64
	module := modules.Create("thrusterSingleSm", simulation.ObjectProperties{World: s.World}, s.World.Specification)
	partialID, fullID := simulation.EntityID(s.World), simulation.EntityID(s.World)
	partial := objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: s.World, ID: &partialID}, s.World.Specification)
	partial.Rounds = new(117)
	full := objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: s.World, ID: &fullID}, s.World.Specification)
	p.ship.CargoContents = append(p.ship.CargoContents, module, partial, full)
	p.lastInput = protocol.Input{CargoRelease: true}

	for range 30 {
		advanceEncounter(s, socket)
	}

	if !p.ship.ModuleActive("cargoHatch") {
		t.Fatal("release did not activate closed cargo hatches")
	}

	if len(p.ship.CargoContents) != 9 {
		t.Fatal("cargo was not released one item at a time")
	}

	var first simulation.Entity

	s.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		if entity.Base().DroppedBy != nil {
			first = entity
		}
	})

	if first == nil {
		t.Fatal("no first item emerged")
	}

	atHatch := false

	for _, segment := range p.ship.Segments {
		if segment.Catches {
			position := Vec.Add(p.ship.Position, simulation.RotatePoint(segment.LocalPosition, p.ship.Rotation))
			atHatch = atHatch || Vec.Distance(position, first.Base().Position) < first.Base().Radius+6
		}
	}

	if !atHatch {
		t.Fatal("item did not emerge at an open cargo hatch")
	}

	p.lastInput = protocol.Input{CargoHatch: true}

	for range 70 {
		advanceEncounter(s, socket)
	}

	if len(p.ship.CargoContents) != 2 || !slices.Contains(p.ship.CargoContents, simulation.Entity(module)) || !slices.Contains(p.ship.CargoContents, simulation.Entity(partial)) {
		t.Fatal("release did not preserve modules and the partial ammunition pack")
	}

	if !s.World.Entities.Has(full.ID) || *partial.Rounds != 117 || *full.Rounds != 200 {
		t.Fatal("release changed ammunition or kept a full pack")
	}
}

func TestPirateSurrenderMessageAfterCombat(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(-250, 0))
	npc.state = pirateFighting
	npc.aggressors[p.playerID] = true
	npc.input.Fire = true
	p.ship.CargoRelease()
	s.updatePirates()

	if npc.input.Fire || npc.aggressors[p.playerID] || npc.state != pirateWaiting || npc.collectAfter == 0 {
		t.Fatal("late surrender did not end hostility toward the victim")
	}

	if !slices.ContainsFunc(socket.frames, func(frame []byte) bool { return bytes.HasSuffix(frame, []byte("Changed your mind? Excellent.")) }) {
		t.Fatal("missing late surrender response")
	}
}

func TestPirateCargoDemandIsPrivateAndEndsOnSurrender(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	observerSocket := &soundSocket{}
	s.Receive(protocol.Control{Type: "hello"}, observerSocket)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(-250, 0))
	s.updatePirates()

	packet := func(id int64) []byte {
		frame, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: npc.ship.Name, SenderRole: "hostile", CargoDemand: &id}, s.World.Specification.Protocol)

		if err != nil {
			t.Fatal(err)
		}

		return frame
	}

	has := func(socket *soundSocket, frame []byte) bool {
		return slices.ContainsFunc(socket.frames, func(data []byte) bool { return bytes.Equal(data, frame) })
	}

	if !has(socket, packet(npc.ship.ID)) || has(observerSocket, packet(npc.ship.ID)) {
		t.Fatal("cargo action was not private to the threatened player")
	}

	p.ship.CargoRelease()
	s.updatePirates()

	if !has(socket, packet(0)) || has(observerSocket, packet(0)) {
		t.Fatal("surrender did not clear the private cargo action")
	}
}

func TestPirateAnnouncesStrandingAndDestructionOnce(t *testing.T) {
	s, p, socket := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]
	npc.ship.Launching = 0
	npc.ship.DockedTo = nil
	npc.ship.Position = Vec.Add(p.ship.Position, Vec.Create(800, 0))
	engine := npc.ship.Engine()
	objects.Damage(engine.ModuleBase().Mount.Hull, 10000)
	npc.ship.Update(0)

	if npc.ship.Dead || !npc.ship.Stranded() {
		t.Fatal("fixture did not leave the pirate stranded")
	}

	s.updatePirates()

	if npc.state != pirateStranded {
		t.Fatal("NPC did not enter its stranded state")
	}

	s.updatePirates()

	count := func(text string) int {
		n := 0

		for _, frame := range socket.frames {
			if bytes.HasSuffix(frame, []byte(text)) {
				n++
			}
		}

		return n
	}

	if count("Oh no") != 1 || count("AHH!") != 0 {
		t.Fatal("stranding message was missing, repeated, or treated as death")
	}

	for _, segment := range npc.ship.Segments {
		if segment.Hull && segment.Core {
			objects.Damage(segment, 10000)
		}
	}

	npc.ship.Update(0)
	s.updatePirates()
	s.updatePirates()

	if count("AHH!") != 1 || count("Oh no") != 1 || len(s.sectors[s.currentSector].pirates) != 0 {
		t.Fatal("full destruction did not produce one final message and cleanup")
	}
}

func TestPirateDestroyedDirectlyDoesNotAnnounceStranding(t *testing.T) {
	s, _, socket := pirateEncounter(t)
	s.dispatchPirates()
	npc := s.sectors[s.currentSector].pirates[0]

	for _, segment := range npc.ship.Segments {
		if segment.Hull && segment.Core {
			objects.Damage(segment, 10000)
		}
	}

	s.updatePirates()
	npc.ship.Update(0)
	s.updatePirates()

	for _, frame := range socket.frames {
		if bytes.HasSuffix(frame, []byte("Oh no")) {
			t.Fatal("doomed pirate briefly announced being stranded")
		}
	}

	if !slices.ContainsFunc(socket.frames, func(frame []byte) bool { return bytes.HasSuffix(frame, []byte("AHH!")) }) {
		t.Fatal("destroyed pirate did not scream")
	}
}
