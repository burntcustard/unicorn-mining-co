package collector

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/npc/testhost"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"strings"
	"testing"
)

type fixture struct {
	*Manager
	Host *testhost.Host
}

func newFixture(catalog specs.Catalog) *fixture {
	host := testhost.New(25, catalog)
	manager := New(host)
	host.Dispatch, host.Before, host.After = manager.Dispatch, manager.Update, manager.ItemsCollected
	return &fixture{Manager: manager, Host: host}
}

func (s *fixture) Tick(ticks uint64) { s.Host.Tick(ticks) }

func dialogCount(player *testhost.Human, choices []string) int {
	count := 0

	for _, message := range player.Controls {
		if message.Type == "chat" && slices.Contains(choices, message.Text) {
			count++
		}
	}

	return count
}

func chatCount(player *testhost.Human, text string) int { return dialogCount(player, []string{text}) }

func collectorFixture(t testing.TB, count int) (*fixture, protocol.StationDescription, []pickupItem) {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	s := newFixture(catalog)
	home := s.Host.NearestStation(Vec.Vector{})
	var items []pickupItem

	for i := range count {
		id := simulation.EntityID(s.World)
		position := Vec.Add(home.Position, Vec.Create(750+float64(i)*130, 0))
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id, Position: position}, catalog)
		simulation.AddEntity(s.World, item)
		items = append(items, pickupItem{ID: id, Position: position, Name: item.Name})
	}

	return s, home, items
}

func collectorClock(s *fixture, home protocol.StationDescription) *dispatchStation {
	station := &dispatchStation{Home: home}
	runtime := s.Manager
	runtime.Stations = map[int64]*dispatchStation{s.Host.Regions.IDOffset + int64(home.ID): station}
	runtime.DiscoverAt = math.MaxUint64
	return station
}

func collectorAtWork(s *fixture, home protocol.StationDescription, items []pickupItem) *collector {
	npc := s.spawn(home, items)
	npc.ship.Launching = 0
	npc.ship.Position = Vec.Add(home.Position, Vec.Create(500, 0))
	npc.ship.Velocity = Vec.Vector{}
	s.World.Tick = 30
	return npc
}

func TestCollectorReturnAndStrandedRules(t *testing.T) {
	for _, reason := range []string{"full", "hull", "module", "radius", "empty", "fuel", "attacked"} {
		t.Run(reason, func(t *testing.T) {
			s, home, items := collectorFixture(t, 1)
			npc := collectorAtWork(s, home, items)

			switch reason {
			case "full":
				for range npc.ship.CargoSpace {
					npc.ship.CargoContents = append(npc.ship.CargoContents, objects.NewItem("gold", simulation.ObjectProperties{World: s.World}, s.World.Specification))
				}
			case "hull":
				for _, segment := range npc.ship.Segments {
					if segment.Hull && !segment.Core {
						objects.Damage(segment, 10000)
						break
					}
				}
			case "module":
				npc.ship.SetModuleActive("cargoHatch", true)

				for _, module := range npc.ship.Modules() {
					if module.ModuleBase().Type == "cargoHatch" {
						objects.Damage(npc.ship.SegmentsAtMount(module.ModuleBase().Mount)[0], 10000)
						break
					}
				}
			case "radius":
				npc.ship.Position = Vec.Add(home.Position, Vec.Create(10001, 0))
			case "empty":
				npc.Items = nil
			case "fuel":
				npc.ship.Fuel = 0
			case "attacked":
				objects.Damage(npc.ship.Cockpit, 1)
			}

			s.Update()
			expected := returning

			if reason == "fuel" {
				expected = stranded
			} else if reason == "attacked" {
				expected = collecting
			}

			if npc.State != expected || npc.input.Fire || !s.World.Entities.Has(npc.ship.ID) {
				t.Fatalf("reason=%s state=%s expected=%s", reason, npc.State, expected)
			}
		})
	}
}

func TestCollectorUnattendedTripCollectsAndSells(t *testing.T) {
	s, home, items := collectorFixture(t, 6)
	npc := s.spawn(home, items)
	collectorClock(s, home).CheckAt = math.MaxUint64
	startingHull := npc.ship.HullHealthTotal()

	for range 30 * 240 {
		s.Tick(1)

		if len(s.Manager.Collectors) == 0 {
			break
		}
	}

	if npc.ship.Dead || npc.ship.DockedTo == nil || *npc.ship.DockedTo != npc.HomeID || len(npc.ship.CargoContents) != 0 || npc.Credits <= 0 || len(s.Manager.Collectors) != 0 {
		t.Fatalf("unattended trip did not collect and sell: state=%s pos=%v hull=%g/%g cargo=%d credit=%g remaining=%v fuel=%g", npc.State, npc.ship.Position, npc.ship.HullHealthTotal(), startingHull, len(npc.ship.CargoContents), npc.Credits, npc.Items, npc.ship.Fuel)
	}

	if npc.Credits != 6**s.World.Specification.ItemSpecs["gold"].Price {
		t.Fatal("collector did not sell every listed item")
	}
}

func TestCollectorDestructionUsesNormalCargoAndWreckageRelease(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	npc := collectorAtWork(s, home, items)
	item := s.entity(items[0].ID)
	item.Base().Remove()
	spare := modules.Create("searchLight", simulation.ObjectProperties{World: s.World}, s.World.Specification)
	spare.Base().Dead = true
	npc.ship.CargoContents = append(npc.ship.CargoContents, item, spare)

	for _, segment := range npc.ship.Segments {
		if segment.Hull && segment.Core {
			objects.Damage(segment, 10000)
		}
	}

	npc.ship.Update(0)
	s.Update()

	if !npc.ship.Dead || len(npc.ship.CargoContents) != 0 || len(s.Manager.Collectors) != 0 || s.World.Players.Has(*npc.ship.PlayerID) || s.World.Entities.Has(npc.ship.ID) {
		t.Fatal("destroyed collector retained its ship, observer, controller, or cargo")
	}

	for _, cargo := range []simulation.Entity{item, spare} {
		released, ok := s.World.Entities.Get(cargo.Base().ID)

		if !ok || released != cargo || released.Base().Dead || released.Base().ID <= 0 {
			t.Fatal("ordinary ship destruction did not return collected cargo and its spare module to the world")
		}
	}

	wreckage := 0

	s.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		if entity.Base().Kind == "craft" && entity.Base().Decay > 0 {
			wreckage++
		}
	})

	if wreckage == 0 {
		t.Fatal("destroyed collector did not produce ordinary ship wreckage")
	}
}

func TestCollectorMissingItemsRequireVisits(t *testing.T) {
	s, home, items := collectorFixture(t, 6)
	npc := collectorAtWork(s, home, items)

	for _, item := range items {
		s.World.Entities.Delete(item.ID)
		s.Host.Regions.Sleeping.Delete(item.ID)
	}

	s.inputFor(npc, 1)

	if len(npc.Items) != 6 || npc.Missing != 0 || npc.State != collecting {
		t.Fatal("missing items were discarded before visiting their positions")
	}

	for i, item := range items {
		npc.ship.Position = item.Position
		s.inputFor(npc, float64(i+2))

		if npc.Missing != i+1 || len(npc.Items) != 5-i {
			t.Fatalf("missing visit %d did not advance the list", i+1)
		}
	}

	if npc.State != returning {
		t.Fatal("collector did not return after visiting all missing items")
	}
}

func TestCollectorPickupTimeoutAppliesOnlyToThisTrip(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	npc := collectorAtWork(s, home, items)
	s.inputFor(npc, 1)
	s.inputFor(npc, 300.9)

	if len(npc.Items) != 1 {
		t.Fatal("collector abandoned its item before five minutes")
	}

	s.inputFor(npc, 301)

	if len(npc.Items) != 0 || !npc.Inspected[items[0].ID] {
		t.Fatal("timed-out item remained on this trip or can interrupt it as unlisted")
	}

	other := collectorAtWork(s, home, items)
	s.inputFor(other, 302)

	if other.TargetID != items[0].ID || s.entity(items[0].ID) == nil {
		t.Fatal("failed pickup prevented a later trip from trying")
	}
}

func TestCollectorUnlistedInspectionTiming(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	npc := collectorAtWork(s, home, items)
	id := simulation.EntityID(s.World)
	item := objects.NewItem("amethyst", simulation.ObjectProperties{World: s.World, ID: &id}, s.World.Specification)
	distance := npc.ship.Radius + item.Radius + s.World.Specification.CollectorSpec.InspectionDistance
	item.Position = Vec.Add(npc.ship.Position, Vec.Create(distance, 0))
	simulation.AddEntity(s.World, item)
	input := s.inputFor(npc, 1)

	if npc.State != inspecting || npc.Inspect == nil || npc.Inspect.ArrivedAt != 1 || input.CargoHatch || input.Turn != 0 {
		t.Fatalf("unlisted item did not get a closed-hatch, head-on inspection: %+v", npc.Inspect)
	}

	s.inputFor(npc, 5.9)

	if npc.Inspect.Announced {
		t.Fatal("inspection announcement occurred before five seconds")
	}

	s.inputFor(npc, 6)

	if !npc.Inspect.Announced {
		t.Fatal("inspection announcement missing at five seconds")
	}

	s.inputFor(npc, 10.9)

	if npc.Inspect == nil {
		t.Fatal("collector left before ten seconds")
	}

	s.inputFor(npc, 11)
	s.inputFor(npc, 11.2)

	if npc.Inspect != nil || npc.TargetID != items[0].ID || len(npc.Items) != 1 || !s.World.Entities.Has(id) {
		t.Fatal("collector repeated its inspection, collected the unlisted item, or lost its actual list")
	}
}

func TestCollectorMissingDialogueAdvancesOncePerVisit(t *testing.T) {
	s, home, items := collectorFixture(t, 6)
	socket := s.Host.AddPlayer()
	npc := collectorAtWork(s, home, items)

	for _, item := range items {
		s.World.Entities.Delete(item.ID)
		s.Host.Regions.Sleeping.Delete(item.ID)
	}

	socket.Controls = nil
	dialog := s.World.Specification.CollectorDialog
	lines := [][]string{dialog.MissingFirst, dialog.MissingSecond, dialog.MissingThird, dialog.MissingFourth, dialog.MissingFifth, dialog.MissingSixth}

	for i, item := range items {
		s.inputFor(npc, float64(i*2+1))

		if dialogCount(socket, lines[i]) != 0 {
			t.Fatalf("missing item %d was announced before arrival", i+1)
		}

		npc.ship.Position = item.Position
		s.inputFor(npc, float64(i*2+2))

		for j, choices := range lines {
			want := 0

			if j <= i {
				want = 1
			}

			if dialogCount(socket, choices) != want {
				t.Fatalf("visit %d did not announce missing count %d exactly once", i+1, j+1)
			}
		}
	}

	if npc.State != returning || npc.Missing != 6 {
		t.Fatal("six missing items did not end the trip")
	}

	s.inputFor(npc, 14)

	if dialogCount(socket, dialog.MissingSixth) != 1 || dialogCount(socket, dialog.Finished) != 0 {
		t.Fatal("returning repeated or contradicted the final missing-item announcement")
	}
}

func TestCollectorListsKeepTakenItemsMissingAfterRedrop(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	npc := collectorAtWork(s, home, items)
	station := collectorClock(s, home)
	station.CheckAt = math.MaxUint64
	station.Queue = [][]pickupItem{slices.Clone(items)}
	station.Seen = map[int64]bool{items[0].ID: true}
	item := s.entity(items[0].ID)
	item.Base().Remove()
	s.ItemsCollected([]protocol.SimulationEvent{protocol.ItemCollected{By: 999, ItemID: items[0].ID}})
	item.Base().Position = Vec.Add(items[0].Position, Vec.Create(1000, 0))
	item.Base().Add()

	if !npc.Items[0].Taken || !station.Queue[0][0].Taken || station.Seen[items[0].ID] {
		t.Fatal("pickup did not invalidate active, queued, and grace-period lists")
	}

	input := s.inputFor(npc, 1)

	if input.CargoHatch || npc.Items[0].Position != items[0].Position || npc.Inspect != nil {
		t.Fatal("active trip pursued the newly dropped object instead of its old recorded location")
	}

	s.Dispatch()
	queued := s.Manager.Collectors[1]
	queued.ship.Launching = 0
	queued.ship.Position = npc.ship.Position
	input = s.inputFor(queued, 1)

	if input.CargoHatch || !queued.Items[0].Taken || queued.Items[0].Position != items[0].Position {
		t.Fatal("queued trip forgot the pickup before it launched")
	}

	for _, trip := range []*collector{npc, queued} {
		trip.ship.Position = items[0].Position
		s.inputFor(trip, 2)

		if trip.Missing != 1 || len(trip.Items) != 0 || trip.State != returning || !s.World.Entities.Has(item.Base().ID) {
			t.Fatal("re-dropped cargo did not remain untouched after the original list location was checked")
		}
	}
}

func TestCollectorUnreachableMissingLocationTimesOut(t *testing.T) {
	s, home, items := collectorFixture(t, 2)
	socket := s.Host.AddPlayer()
	npc := collectorAtWork(s, home, items)
	s.World.Entities.Delete(items[0].ID)
	s.Host.Regions.Sleeping.Delete(items[0].ID)
	s.inputFor(npc, 1)

	if npc.TargetID != items[0].ID {
		t.Fatal("fixture did not begin the missing-item approach")
	}

	s.inputFor(npc, 300.9)

	if len(npc.Items) != 2 || npc.Missing != 0 {
		t.Fatal("collector abandoned a distant missing location before five minutes")
	}

	s.inputFor(npc, 301)
	s.inputFor(npc, 301.1)
	message := strings.ReplaceAll(s.World.Specification.CollectorDialog.Unreachable[0], "{item_name}", items[0].Name)

	if len(npc.Items) != 1 || npc.TargetID != items[1].ID || npc.Missing != 0 || chatCount(socket, message) != 1 {
		t.Fatal("unreachable old position did not produce one timeout message and advance the trip")
	}
}

func TestCollectorUnreachableInspectionTimesOutAndPreservesPickupTime(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	socket := s.Host.AddPlayer()
	npc := collectorAtWork(s, home, items)
	s.inputFor(npc, 1)
	id := simulation.EntityID(s.World)
	item := objects.NewItem("amethyst", simulation.ObjectProperties{World: s.World, ID: &id, Position: Vec.Add(npc.ship.Position, Vec.Create(70, 0)), Velocity: Vec.Create(50, 0)}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	s.inputFor(npc, 10)

	if npc.Inspect == nil || npc.Inspect.ArrivedAt != 0 || npc.Inspect.StartedAt != 10 {
		t.Fatal("fixture did not begin an uncompleted inspection approach")
	}

	s.inputFor(npc, 309.9)

	if npc.Inspect == nil {
		t.Fatal("inspection approach timed out before five minutes")
	}

	s.inputFor(npc, 310)
	message := strings.ReplaceAll(s.World.Specification.CollectorDialog.Unreachable[0], "{item_name}", item.Name)

	if npc.Inspect != nil || npc.State != collecting || npc.AttemptStartedAt != 301 || chatCount(socket, message) != 1 || dialogCount(socket, s.World.Specification.CollectorDialog.Unlisted) != 0 {
		t.Fatal("unreachable inspection did not end once, or consumed the actual item's pickup allowance")
	}

	s.inputFor(npc, 310.1)

	if npc.Inspect != nil || npc.TargetID != items[0].ID || len(npc.Items) != 1 || !s.World.Entities.Has(id) {
		t.Fatal("collector repeated the failed inspection or abandoned its real pickup")
	}
}

func TestCollectorAssignedItemCanMoveDuringPickup(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	npc := collectorAtWork(s, home, items)
	item := s.entity(items[0].ID)
	item.Base().Velocity = Vec.Create(5, 0)
	input := s.inputFor(npc, 1)

	if !input.CargoHatch || npc.TargetID != item.Base().ID || npc.Missing != 0 {
		t.Fatal("an assigned moving item was mistaken for missing loot")
	}
}

func TestCollectorKeepsSelectedTargetUntilPickup(t *testing.T) {
	s, home, items := collectorFixture(t, 3)
	npc := collectorAtWork(s, home, items)
	s.inputFor(npc, 1)
	first, second := s.entity(items[0].ID), s.entity(items[1].ID)
	first.Base().Position = Vec.Add(npc.ship.Position, Vec.Create(1000, 0))
	second.Base().Position = Vec.Add(npc.ship.Position, Vec.Create(20, 0))
	input := s.inputFor(npc, 2)

	if npc.TargetID != items[0].ID || npc.AttemptStartedAt != 1 || npc.Items[0].Position != first.Base().Position || input.CargoHatch {
		t.Fatal("a closer listed item replaced the active moving pickup or restarted its allowance")
	}

	first.Base().Remove()
	npc.ship.CargoContents = append(npc.ship.CargoContents, first)
	input = s.inputFor(npc, 3)

	if len(npc.Items) != 2 || npc.TargetID != items[1].ID || npc.AttemptStartedAt != 3 || npc.Items[0].Position != second.Base().Position || !input.CargoHatch {
		t.Fatal("finishing a pickup did not select the next nearest live item with a fresh allowance")
	}
}
