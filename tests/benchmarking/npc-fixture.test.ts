import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { prepareNPCFixture } from '../../benchmarking/npc/fixture.ts';

/*
 * Exercise the generated compiler fixture against real sessions and physics.
 * All scene data, reports, and the manifest stay inside this test's directory.
 */
const tests = String.raw`package network

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
 "os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func npcFixtureActor(t *testing.T, name string, seeds ...uint32) (*GameSession, *soundSocket, *collectorBenchmarkEncounter) {
	t.Helper()
	catalog, err := specs.Load()
	if err != nil {
		t.Fatal(err)
	}
	s := NewGameSession(25, catalog)
	return npcFixturePlayer(t, s, name, seeds...)
}

func npcFixturePlayer(t *testing.T, s *GameSession, name string, seeds ...uint32) (*GameSession, *soundSocket, *collectorBenchmarkEncounter) {
	t.Helper()
	socket := &soundSocket{}
	previous := collectorBenchmarkEncounters[s.World]
	s.Receive(protocol.Control{Type: "prepare"}, socket)
	p := s.playersBySocket[socket]
	if collectorBenchmarkEncounters[s.World] != previous || s.World.Players.Has(p.playerID) {
		t.Fatal("Prepare activated the fixture before Play")
	}
	if len(seeds) > 0 {
		s.Receive(protocol.Control{Type: "chat", Text: fmt.Sprintf("/npc-benchmark-seed %d", seeds[0])}, socket)
	}
	s.Receive(protocol.Control{Type: "profile", DisplayName: name}, socket)
	if collectorBenchmarkEncounters[s.World] != previous || s.World.Players.Has(p.playerID) {
		t.Fatal("Profile activated the fixture before Play")
	}
	s.Receive(protocol.Control{Type: "play"}, socket)
	if s.persistence != nil {
		committedSession(t, s)
		s.sendSnapshot(p, nil, nil)
	}
	e := collectorBenchmarkEncounters[s.World]
	t.Cleanup(func() {
		if collectorBenchmarkEncounters[s.World] == e {
			s.Disconnect(socket)
			s.recordCollectorBenchmark(nil)
			delete(collectorBenchmarkEncounters, s.World)
		}
	})
	if e == nil {
		t.Fatal("fixture missing")
	}
	if _, pending := collectionBenchmarkSeeds[p]; pending {
		t.Fatal("Play did not consume its pending layout seed")
	}
	if p.ship.Name != "Fixture "+e.scenario || !slices.Contains(p.binaryReplication.entityIDs, uint64(p.shipID)) {
		t.Fatal("Play did not replicate the compatibility anchor")
	}
	if s.World.Entities.Has(p.shipID) || s.World.Players.Has(p.playerID) || p.ship.PlayerID != nil || len(p.ship.Segments) != 0 || len(p.ship.Modules()) != 0 || len(p.ship.Hitbox()) != 0 || p.ship.Cockpit != nil || p.ship.Radius != 0 {
		t.Fatal("benchmark viewer acquired a physical body or observer ownership")
	}
	health := p.ship.HullHealth()
	if len(health) == 0 || slices.ContainsFunc(health, func(value float64) bool { return value != 0 }) {
		t.Fatal("anchor wire hull health would rebuild stock client geometry")
	}
	s.Receive(protocol.Control{Type: "play"}, socket)
	if collectorBenchmarkEncounters[s.World] != e {
		t.Fatal("repeated Play replaced the active fixture")
	}
	return s, socket, e
}

func TestNPCFixtureSeededLayouts(t *testing.T) {
	var previous []Vec.Vector
	minerals := map[string]bool{}
	for _, seed := range []uint32{0, 1, 37, math.MaxUint32} {
		var shared []Vec.Vector
		var sharedTypes []string
		for _, name := range []string{"Gather Courser", "Gather Finch", "Gather Courser"} {
			s, socket, e := npcFixtureActor(t, name, seed)
			manager := s.sectors[s.currentSector].collectors
			home := manager.Stations[e.homeID].Home.Position
			if e.seed == nil || *e.seed != seed || len(e.layout) != 8 {
				t.Fatalf("seed %d was not retained with all eight slots", seed)
			}
			if shared == nil {
				shared = slices.Clone(e.layout)
				sharedTypes = slices.Clone(e.itemTypes)
			} else if !slices.Equal(shared, e.layout) {
				t.Fatalf("seed %d did not reproduce the shared Courser/Finch layout", seed)
			}
			if len(e.itemTypes) != len(e.itemIDs) || !slices.Equal(sharedTypes[:len(e.itemTypes)], e.itemTypes) {
				t.Fatalf("seed %d did not reproduce the shared mineral prefix", seed)
			}
			ids := []int64{}
			for id := range e.itemIDs {
				ids = append(ids, id)
			}
			slices.Sort(ids)
			for index, id := range ids {
				item := manager.Environment.Entity(id).Base()
				definition := e.itemTypes[index]
				if !slices.Contains([]string{"gold", "amethyst", "diamond", "opal"}, definition) || item.Resource != s.World.Specification.ItemSpecs[definition].Resource {
					t.Fatal("collection contains a non-mineral item or incorrect spec")
				}
				minerals[definition] = true
				if Vec.Distance(Vec.Subtract(item.Position, home), e.layout[index]) > 1e-9 {
					t.Fatal("hull did not use the common layout prefix")
				}
			}
			for index, offset := range e.layout {
				if math.Abs(offset.X) > 1000 || math.Abs(offset.Y) > 1000 {
					t.Fatal("layout escaped the sampling square")
				}
				position := Vec.Add(home, offset)
				for _, other := range e.layout[:index] {
					if Vec.Distance(offset, other) < 120 {
						t.Fatal("layout items are too close together")
					}
				}
				s.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
					object := entity.Base()
					if object.Kind != "asteroid" && object.Kind != "station" && object.Kind != "ship" {
						return
					}
					if Vec.Distance(position, object.Position) < object.Radius+100 {
						t.Fatal("layout intersects an obstacle or the observer")
					}
				})
				if Vec.Distance(position, e.player.ship.Position) > s.World.Specification.Simulation.Replication.EntityLoad {
					t.Fatal("layout is outside ordinary observer replication")
				}
			}
			s.Receive(protocol.Control{Type: "chat", Text: "/npc-benchmark-seed 999"}, socket)
			if *e.seed != seed {
				t.Fatal("a post-Play marker changed the active layout")
			}
			if _, pending := collectionBenchmarkSeeds[e.player]; pending {
				t.Fatal("post-Play seed leaked into the next case")
			}
			s.Disconnect(socket)
			s.recordCollectorBenchmark(nil)
		}
		if previous != nil && slices.Equal(previous, shared) {
			t.Fatal("different seeds produced identical layouts")
		}
		previous = shared
	}
	if len(minerals) != 4 {
		t.Fatal("seeded collection cases did not exercise all four asteroid minerals")
	}
}

func TestNPCFixtureSeedDoesNotChangeCollectorScenes(t *testing.T) {
	for _, name := range []string{"Collect empty", "Collect idle", "Collect active", "Crowd idle", "Collect crowded"} {
		var previous []Vec.Vector
		for _, seed := range []uint32{1, 99} {
			s, socket, e := npcFixtureActor(t, name, seed)
			if e.seed != nil || e.layout != nil {
				t.Fatal("ordinary collector scene acquired random layout metadata")
			}
			ids := []int64{}
			for id := range e.itemIDs {
				ids = append(ids, id)
			}
			slices.Sort(ids)
			positions := []Vec.Vector{}
			for _, id := range ids {
				positions = append(positions, s.sectors[s.currentSector].collectors.Environment.Entity(id).Base().Position)
			}
			if seed == 1 {
				previous = positions
			} else if !slices.Equal(previous, positions) {
				t.Fatal("ordinary collector positions changed with seed")
			}
			s.Disconnect(socket)
			s.recordCollectorBenchmark(nil)
		}
	}
}

func TestNPCFixtureSeedIsScopedToPreparedPlayer(t *testing.T) {
	catalog, err := specs.Load()
	if err != nil {
		t.Fatal(err)
	}
	s := NewGameSession(25, catalog)
	first, second := &soundSocket{}, &soundSocket{}
	s.Receive(protocol.Control{Type: "prepare"}, first)
	s.Receive(protocol.Control{Type: "chat", Text: "/npc-benchmark-seed 37"}, first)
	p := s.playersBySocket[first]
	if collectionBenchmarkSeeds[p] != 37 {
		t.Fatal("seed marker was not stored for the prepared player")
	}
	s.Disconnect(first)
	if _, pending := collectionBenchmarkSeeds[p]; pending {
		t.Fatal("disconnect retained an unconsumed seed")
	}
	s.Receive(protocol.Control{Type: "prepare"}, second)
	s.Receive(protocol.Control{Type: "chat", Text: "/npc-benchmark-seed 4294967296"}, second)
	s.Receive(protocol.Control{Type: "profile", DisplayName: "Gather Finch"}, second)
	s.Receive(protocol.Control{Type: "play"}, second)
	e := collectorBenchmarkEncounters[s.World]
	if e.seed == nil || *e.seed != 1 {
		t.Fatal("another player or invalid marker changed the default seed")
	}
	s.Disconnect(second)
	s.recordCollectorBenchmark(nil)
	delete(collectorBenchmarkEncounters, s.World)
}

func TestNPCFixtureSevenScenarios(t *testing.T) {
	for _, name := range []string{"Collect empty", "Collect idle", "Collect active", "Crowd idle", "Collect crowded", "Gather Courser", "Gather Finch"} {
		t.Run(name, func(t *testing.T) {
			s, socket, e := npcFixtureActor(t, name)
			manager := s.sectors[s.currentSector].collectors
			unrelated := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Create(100000, 100000)}, s.World.Specification)
			simulation.AddEntity(s.World, unrelated)
			expected := 6
			if name == "Collect empty" {
				expected = 0
			} else if name == "Crowd idle" || name == "Collect crowded" {
				expected = 48
			}
			if name == "Gather Courser" {
				expected = s.World.Specification.ShipSpecs["courser"].CargoSpace
			}
			if name == "Gather Finch" {
				expected = s.World.Specification.ShipSpecs["finch"].CargoSpace
			}
			if len(e.itemIDs) != expected {
				t.Fatalf("items=%d want=%d", len(e.itemIDs), expected)
			}
			if strings.HasPrefix(name, "Gather ") {
				if len(manager.Collectors) != 0 {
					t.Fatal("generic case launched before start marker")
				}
				s.Receive(protocol.Control{Type: "chat", Text: "/npc-benchmark-start"}, socket)
				s.Receive(protocol.Control{Type: "chat", Text: "/npc-benchmark-start"}, socket)
				if len(manager.Collectors) != 1 || len(e.shipIDs) != 1 {
					t.Fatal("start marker did not launch exactly once")
				}
				definition := "finch"
				if name == "Gather Courser" {
					definition = "courser"
				}
				manager.ForEachShip(func(ship *objects.Ship) {
					if ship.DefinitionID != definition || ship.CargoSpace != expected {
						t.Fatalf("wrong hull or capacity: %s %d", ship.DefinitionID, ship.CargoSpace)
					}
				})
				for _, saved := range manager.Capture() {
					var state struct {
						Items []json.RawMessage
						State string
					}
					if err := json.Unmarshal(saved.State, &state); err != nil {
						t.Fatal(err)
					}
					if len(state.Items) != expected || state.State != "Collecting" {
						t.Fatal("generic case did not use normal collector state")
					}
				}
			}
			s.recordCollectorBenchmark(nil)
			s.Disconnect(socket)
			s.recordCollectorBenchmark(nil)
			if !e.saved {
				t.Fatal("fixture did not save and clean up")
			}
			if npcBenchmarkAnchors[s.World] != nil || slices.Contains(s.positions(), e.player.ship.Position) {
				t.Fatal("disconnected viewer survived in the replication or streaming view")
			}
			if _, ok := manager.Stations[e.homeID]; ok {
				t.Fatal("temporary station clock survived cleanup")
			}
			for id := range e.itemIDs {
				if s.World.Entities.Has(id) || s.regions.Sleeping.Has(id) {
					t.Fatalf("loose item %d survived", id)
				}
			}
			manager.ForEachShip(func(ship *objects.Ship) {
				if e.shipIDs[ship.ID] {
					t.Fatal("fixture controller survived")
				}
			})
			if !s.World.Entities.Has(unrelated.ID) && !s.regions.Sleeping.Has(unrelated.ID) {
				t.Fatal("unrelated world item removed")
			}
		})
	}
}

func TestNPCFixtureDoesNotPersistAnchor(t *testing.T) {
	s, store := persistedSession(t, filepath.Join(t.TempDir(), "world.sqlite"))
	defer store.Close(context.Background())
	_, socket, e := npcFixturePlayer(t, s, "Gather Finch")
	s.savePlayer(e.player)
	if _, pending := s.persistence.players[e.player]; pending {
		t.Fatal("anchor queued for player persistence")
	}
	s.Disconnect(socket)
	s.recordCollectorBenchmark(nil)
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	committedSession(t, s)
	saved, err := store.Load(s.worldSeed)
	if err != nil {
		t.Fatal(err)
	}
	for _, player := range saved.Players {
		if player.ID == e.player.profile.ID && (len(player.Ship.Modules) == 0 || !slices.ContainsFunc(player.Ship.Hull, func(health float64) bool { return health > 0 })) {
			t.Fatal("compatibility anchor replaced the saved real ship")
		}
	}
}

func TestNPCFixtureCleansExternallyHeldItems(t *testing.T) {
	s, socket, e := npcFixtureActor(t, "Collect idle")
	var id int64
	for itemID := range e.itemIDs {
		id = itemID
		break
	}
	item := s.sectors[s.currentSector].collectors.Environment.Entity(id)
	item.Base().Remove()
	normal := objects.NewItem("amethyst", simulation.ObjectProperties{World: s.World}, s.World.Specification)
	otherSocket := &soundSocket{}
	s.Receive(protocol.Control{Type: "prepare"}, otherSocket)
	external := s.playersBySocket[otherSocket]
	external.ship.CargoContents = append(external.ship.CargoContents, item, normal)
	s.recordCollectorBenchmark([]protocol.SimulationEvent{protocol.ItemCollected{By: external.playerID, ItemID: id}})
	s.Disconnect(socket)
	s.recordCollectorBenchmark(nil)
	foundNormal := false
	for _, cargo := range external.ship.CargoContents {
		if cargo.Base().ID == id {
			t.Fatal("fixture item remains in external cargo after cleanup")
		}
		if cargo == normal {
			foundNormal = true
		}
	}
	if !foundNormal {
		t.Fatal("cleanup removed unrelated cargo")
	}
}

func TestNPCFixtureCollectionUsesNormalPhysics(t *testing.T) {
	catalog, err := specs.Load()
	if err != nil {
		t.Fatal(err)
	}
	session := NewGameSession(25, catalog)
	var layout []Vec.Vector
	for _, name := range []string{"Gather Courser", "Gather Finch"} {
		t.Run(name, func(t *testing.T) {
			s, socket, e := npcFixturePlayer(t, session, name, 1)
			if layout == nil {
				layout = slices.Clone(e.layout)
			} else if !slices.Equal(layout, e.layout) {
				t.Fatal("the first trip or its observer changed the second hull's seeded layout")
			}
			manager := s.sectors[s.currentSector].collectors
			for range 15 * 30 {
				socketTick(s, socket)
			}
			if len(manager.Collectors) != 0 || len(e.shipIDs) != 0 {
				t.Fatal("collection started during warmup before its explicit marker")
			}
			s.Receive(protocol.Control{Type: "chat", Text: "/npc-benchmark-start"}, socket)
			visible := map[string]bool{}
			// An unrelated or forged dock event cannot finish the trip.
			s.recordCollectorBenchmark([]protocol.SimulationEvent{protocol.Docked{PlayerID: e.player.playerID, DockedTo: e.homeID}})
			manager.ForEachShip(func(ship *objects.Ship) {
				s.recordCollectorBenchmark([]protocol.SimulationEvent{protocol.Docked{PlayerID: *ship.PlayerID, DockedTo: e.homeID}})
			})
			if e.dockedTick != nil {
				t.Fatal("undocked actor generated completion")
			}
			for tick := range 180 * 30 {
				socketTick(s, socket)
				if tick == 30*30-1 && !slices.ContainsFunc(e.events, func(event collectorBenchmarkEvent) bool { return event.Kind == "pickup" }) {
					t.Fatal("no authoritative pickup in 30 simulated seconds")
				}
				if s.World.Tick%30 == 0 {
					manager.ForEachShip(func(ship *objects.Ship) {
						if !e.shipIDs[ship.ID] {
							return
						}
						if !slices.Contains(e.player.binaryReplication.entityIDs, uint64(ship.ID)) {
							t.Fatalf("NPC %d stopped replicating while %s", ship.ID, ship.NPCState)
						}
						visible[ship.NPCState] = true
					})
				}
				if s.World.Entities.Has(e.player.shipID) || s.World.Players.Has(e.player.playerID) {
					t.Fatal("viewer entered the authoritative simulation during the trip")
				}
				if e.dockedTick != nil {
					if *e.dockedTick != s.World.Tick || len(manager.Collectors) != 1 {
						t.Fatal("completion was not sent on the exact docking tick")
					}
					var actor *objects.Ship
					manager.ForEachShip(func(ship *objects.Ship) { actor = ship })
					if actor.DockedTo == nil || *actor.DockedTo != e.homeID {
						t.Fatal("completion preceded actual docking")
					}
					s.recordCollectorBenchmark([]protocol.SimulationEvent{protocol.Docked{PlayerID: *actor.PlayerID, DockedTo: e.homeID}})
					control, err := protocol.EncodeServerControl(protocol.ServerControl{Type: "chat", Sender: "NPC benchmark", Text: fmt.Sprintf("/npc-benchmark-docked %d %d", actor.ID, *e.dockedTick)}, s.World.Specification.Protocol)
					if err != nil {
						t.Fatal(err)
					}
					messages := 0
					for _, frame := range socket.frames {
						if bytes.Equal(frame, control) {
							messages++
						}
					}
					if messages != 1 {
						t.Fatalf("dock signal count=%d want1", messages)
					}
					socketTick(s, socket)
					if len(manager.Collectors) != 0 {
						t.Fatal("one tick after docking did not sell and remove the NPC")
					}
					station, _ := s.World.Entities.Get(e.homeID)
					deposited := 0
					for _, item := range station.(*objects.Station).CargoContents {
						if e.itemIDs[item.Base().ID] {
							deposited++
						}
					}
					if deposited != len(e.itemIDs) {
						t.Fatalf("docked trip deposited %d/%d", deposited, len(e.itemIDs))
					}
					break
				}
			}
			pickups := 0
			for _, event := range e.events {
				if event.Kind == "pickup" {
					pickups++
				}
			}
			if pickups != len(e.itemIDs) || len(manager.Collectors) != 0 || e.dockedTick == nil {
				t.Fatalf("trip did not finish in 180 simulated seconds: pickups=%d/%d active=%d", pickups, len(e.itemIDs), len(manager.Collectors))
			}
			if !visible["Collecting"] || !visible["Returning"] {
				t.Fatalf("ordinary replication missed a trip phase: %v", visible)
			}
			t.Logf("%s pickups=%d", name, pickups)
			s.Disconnect(socket)
			s.recordCollectorBenchmark(nil)
			for id := range e.itemIDs {
				if s.World.Entities.Has(id) || s.regions.Sleeping.Has(id) {
					t.Fatalf("fixture item %d survived physics cleanup", id)
				}
			}
		})
	}
}

func TestNPCFixtureTenSeedCollectionDiagnostic(t *testing.T) {
	catalog, err := specs.Load()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1000, 0)
	s := NewGameSession(25, catalog, SessionOptions{Now: func() time.Time { return now }})
	completed, picked, total := map[string]int{}, map[string]int{}, map[string]int{}
	for seed := uint32(1); seed <= 10; seed++ {
		names := []string{"Gather Courser", "Gather Finch"}
		if seed%2 == 0 {
			slices.Reverse(names)
		}
		var shared []Vec.Vector
		for _, name := range names {
			_, socket, e := npcFixturePlayer(t, s, name, seed)
			if shared == nil {
				shared = slices.Clone(e.layout)
			} else if !slices.Equal(shared, e.layout) {
				t.Fatalf("seed %d changed between sequential hull cases", seed)
			}
			minimum, maximum := math.Inf(1), 0.
			for _, position := range e.layout {
				distance := Vec.Length(position)
				minimum = min(minimum, distance)
				maximum = max(maximum, distance)
			}
			if maximum-minimum < 100 {
				t.Fatalf("seed %d collapsed into a narrow radial arc", seed)
			}
			manager := s.sectors[s.currentSector].collectors
			s.Receive(protocol.Control{Type: "chat", Text: "/npc-benchmark-start"}, socket)
			seen, pickups := 0, 0
			completion := "incomplete"
			for tick := 1; tick <= 120*30; tick++ {
				now = now.Add(time.Second / 30)
				socketTick(s, socket)
				for _, event := range e.events[seen:] {
					if event.Kind == "pickup" {
						pickups++
						if pickups == len(e.itemIDs) {
							completion = fmt.Sprintf("%.2fs", float64(tick)/30)
						}
					}
				}
				seen = len(e.events)
				if tick%30 == 0 {
					manager.ForEachShip(func(ship *objects.Ship) {
						if e.shipIDs[ship.ID] && !slices.Contains(e.player.binaryReplication.entityIDs, uint64(ship.ID)) {
							t.Fatalf("seed %d %s lost NPC replication while %s", seed, name, ship.NPCState)
						}
					})
				}
			}
			if pickups == len(e.itemIDs) {
				completed[name]++
			}
			picked[name] += pickups
			total[name] += len(e.itemIDs)
			t.Logf("seed=%d hull=%s pickups=%d/%d T100=%s", seed, strings.TrimPrefix(name, "Gather "), pickups, len(e.itemIDs), completion)
			s.Disconnect(socket)
			s.recordCollectorBenchmark(nil)
		}
	}
	for _, name := range []string{"Gather Courser", "Gather Finch"} {
		t.Logf("%s completed=%d/10 pickups=%d/%d at120simulatedseconds", name, completed[name], picked[name], total[name])
	}
}

func TestNPCFixtureRestoresDiscoveryCache(t *testing.T) {
	s, socket, e := npcFixtureActor(t, "Collect idle")
	manager := s.sectors[s.currentSector].collectors
	if len(manager.Regions) == 0 {
		t.Fatal("fixture did not populate discovery cache")
	}
	var position Vec.Vector
	for id := range e.itemIDs {
		position = manager.Environment.Entity(id).Base().Position
		break
	}
	previousDeadline := manager.DiscoverAt
	s.Disconnect(socket)
	s.recordCollectorBenchmark(nil)
	if !e.saved {
		t.Fatal("fixture not cleaned")
	}
	if manager.Stations[e.homeID] != nil {
		t.Fatal("temporary station remains")
	}
	if manager.DiscoverAt != previousDeadline {
		t.Fatal("cleanup changed ordinary discovery timing")
	}
	if len(manager.Regions) != len(e.previousRegions) {
		t.Fatal("discovery cache not restored")
	}
	for id := range e.itemIDs {
		if manager.Environment.Entity(id) != nil {
			t.Fatal("fixture item remains")
		}
	}
	ordinary := objects.NewItem("amethyst", simulation.ObjectProperties{World: s.World, Position: position}, s.World.Specification)
	simulation.AddEntity(s.World, ordinary)
	s.World.Tick = manager.DiscoverAt
	manager.Dispatch()
	if manager.Stations[e.homeID] == nil {
		t.Fatal("ordinary item did not rediscover home station")
	}
	if !s.World.Entities.Has(ordinary.ID) {
		t.Fatal("ordinary item was altered")
	}
}

func TestNPCFixturePreservesExistingDiscoveryCache(t *testing.T) {
	catalog, err := specs.Load()
	if err != nil {
		t.Fatal(err)
	}
	s := NewGameSession(25, catalog)
	socket := &soundSocket{}
	s.Receive(protocol.Control{Type: "prepare"}, socket)
	p := s.playersBySocket[socket]
	p.profile.DisplayName = "Collect idle"
	manager := s.sectors[s.currentSector].collectors
	sentinel := Vec.Create(9999, 9999)
	manager.Regions = map[Vec.Vector]bool{sentinel: true}
	s.play(p)
	encounter := collectorBenchmarkEncounters[s.World]
	if encounter.previousRegions == nil || !encounter.previousRegions[sentinel] {
		t.Fatal("preexisting discovery cache not captured")
	}
	if len(manager.Regions) < 2 {
		t.Fatal("fixture did not add its own discovery regions")
	}
	s.Disconnect(socket)
	s.recordCollectorBenchmark(nil)
	if len(manager.Regions) != 1 || !manager.Regions[sentinel] {
		t.Fatal("preexisting discovery cache changed")
	}
}

func TestNPCFixtureConcurrentCasesStayIsolated(t *testing.T) {
 catalog,err:=specs.Load()
 if err!=nil {t.Fatal(err)}
 s:=NewGameSession(25,catalog)
 sockets:=[]*soundSocket{}
 encounters:=[]*collectorBenchmarkEncounter{}
 worlds:=[]*simulation.World{}
 for lane:=0;lane<6;lane++ {
  socket:=&soundSocket{}
  s.Receive(protocol.Control{Type:"prepare"},socket)
  p:=s.playersBySocket[socket]
  s.Receive(protocol.Control{Type:"chat",Text:fmt.Sprintf("/npc-benchmark-slot %d",lane+1)},socket)
  s.Receive(protocol.Control{Type:"chat",Text:fmt.Sprintf("/npc-benchmark-seed %d",lane%3+1)},socket)
  name:="Gather Courser"
  if lane>=3 {name="Gather Finch"}
  s.Receive(protocol.Control{Type:"profile",DisplayName:name},socket)
  s.Receive(protocol.Control{Type:"play"},socket)
  world:=p.ship.World
  e:=collectorBenchmarkEncounters[world]
  if e==nil||world==s.World||slices.Contains(worlds,world) {t.Fatal("concurrent case did not get its own world")}
  worlds=append(worlds,world)
  sockets=append(sockets,socket)
  encounters=append(encounters,e)
  s.Receive(protocol.Control{Type:"chat",Text:"/npc-benchmark-start"},socket)
 }
 for index,e:=range encounters {
  for other,world:=range worlds {
   if index==other {continue}
   for id:=range e.itemIDs {if world.Entities.Has(id) {t.Fatal("fixture item leaked into another case")}}
  }
  if index>=3&&!slices.Equal(e.layout,encounters[index-3].layout) {t.Fatal("paired hulls did not get the same seeded layout")}
 }
 for tick:=0;tick<5400;tick++ {
  s.Tick(1)
  if !slices.ContainsFunc(encounters,func(e *collectorBenchmarkEncounter)bool{return e.dockedTick==nil}) {break}
 }
 docked:=[2]int{}
 for index,e:=range encounters {
  pickups:=0
  for _,event:=range e.events {if event.Kind=="pickup" {pickups++}}
  if pickups==0 {t.Fatalf("lane %d made no physical collection progress",index)}
  if e.dockedTick!=nil {docked[index/3]++}
  s.Disconnect(sockets[index])
 }
 if docked[0]==0||docked[1]==0 {t.Fatalf("both hulls must demonstrate independent docking: %v",docked)}
 s.Tick(1)
 for index,e:=range encounters {
  data,err:=os.ReadFile(filepath.Join(__REPORT_DIRECTORY__,fmt.Sprintf("npc-%d.json",e.player.shipID)))
  if err!=nil {t.Fatal(err)}
  var report struct {Deposited int}
  if err=json.Unmarshal(data,&report);err!=nil {t.Fatal(err)}
  picked:=0
  for _,event:=range e.events {if event.Kind=="pickup" {picked++}}
  if e.dockedTick!=nil&&report.Deposited!=picked {t.Fatalf("lane %d deposited %d/%d collected items",index,report.Deposited,picked)}
  delete(collectorBenchmarkEncounters,worlds[index])
 }
}

`;

const directory = mkdtempSync(resolve(tmpdir(), 'unicorn-npc-fixture-'));

try {
  const overlay = prepareNPCFixture({
    directory,
    manifestPath: resolve(directory, 'manifest.json'),
  });

  const replacements = JSON.parse(readFileSync(overlay, 'utf8')) as {
    Replace: Record<string, string>;
  };

  const testFile = resolve(directory, 'fixture_test.go');

  writeFileSync(
    testFile,
    tests.replaceAll('__REPORT_DIRECTORY__', JSON.stringify(directory)),
  );
  replacements.Replace[
    resolve('src/server/network/npc-benchmark-fixture_test.go')
  ] = testFile;
  writeFileSync(overlay, JSON.stringify(replacements));

  execFileSync(
    'go',
    [
      'test',
      '-overlay',
      overlay,
      './src/server/network',
      '-run',
      '^TestNPCFixture',
      '-count=1',
      '-timeout=45s',
      '-v',
    ],
    {
      env: { ...process.env, CGO_ENABLED: '0', GOEXPERIMENT: 'simd' },
      stdio: 'inherit',
      timeout: 120000,
    },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
