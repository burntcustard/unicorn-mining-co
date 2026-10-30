package collector

import (
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestCollectorDispatchGraceCapacityAndSpacing(t *testing.T) {
	s, home, items := collectorFixture(t, 7)
	station := collectorClock(s, home)
	s.Dispatch()

	if len(s.Manager.Collectors) != 0 || len(station.Seen) != 7 {
		t.Fatal("first observation must only start the grace period")
	}

	step := s.World.Specification.Simulation.SimulationStep

	if float64(station.CheckAt)*step < 120 || float64(station.CheckAt)*step > 301 {
		t.Fatal("station check is not within its randomized interval")
	}

	s.World.Tick = station.CheckAt
	s.Dispatch()
	collectors := s.Manager.Collectors

	if len(collectors) != 1 || len(collectors[0].Items) != 6 || len(station.Queue) != 1 || len(station.Queue[0]) != 1 {
		t.Fatalf("seven old items should launch a six-item trip and queue one: collectors=%d queue=%v", len(collectors), station.Queue)
	}

	if !slices.Contains(s.World.Specification.CollectorSpec.Names, collectors[0].ship.Name) || collectors[0].ship.Hostile || collectors[0].ship.DefinitionID != "finch" || collectors[0].ship.Launching <= 0 {
		t.Fatal("collector identity or station departure is wrong")
	}

	for _, module := range collectors[0].ship.Modules() {
		if module.ModuleBase().Spec.Behavior == "shieldGenerator" || module.ModuleBase().Spec.Behavior == "weapon" {
			t.Fatal("collector launched with unrequested defensive equipment")
		}
	}

	// Finishing a pickup on the launched trip must not change queued work.
	pickedUp := s.entity(items[0].ID)
	pickedUp.Base().Remove()
	collectors[0].ship.CargoContents = append(collectors[0].ship.CargoContents, pickedUp)
	s.inputFor(collectors[0], float64(s.World.Tick)*step)

	if len(collectors[0].Items) != 5 || station.Queue[0][0].ID != items[6].ID {
		t.Fatal("an active pickup changed a later trip's saved list")
	}

	s.World.Tick = station.LaunchAt - 1
	s.Dispatch()

	if len(s.Manager.Collectors) != 1 {
		t.Fatal("second collector launched before the five-second gap")
	}

	// Queued trips keep their list even if another ship has taken an item.
	s.World.Entities.Delete(items[6].ID)
	s.Host.Regions.Sleeping.Delete(items[6].ID)
	s.World.Tick = station.LaunchAt
	s.Dispatch()

	if len(s.Manager.Collectors) != 2 || s.Manager.Collectors[1].Items[0].ID != items[6].ID {
		t.Fatal("second trip did not retain its missing item")
	}
}

func TestCollectorEligibilityAndFreshlyDroppedGrace(t *testing.T) {
	s, home, items := collectorFixture(t, 2)
	station := collectorClock(s, home)

	for _, kind := range []string{"message", "buried", "dead", "distant"} {
		id := simulation.EntityID(s.World)
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id, Position: items[0].Position}, s.World.Specification)

		switch kind {
		case "message":
			item.Message = new("A clue")
		case "buried":
			item.Buried = true
		case "dead":
			item.Dead = true
		case "distant":
			item.Position = Vec.Add(home.Position, Vec.Create(10001, 0))
		}

		simulation.AddEntity(s.World, item)
	}

	s.Dispatch()
	s.World.Tick = station.CheckAt
	s.Dispatch()

	if len(station.Seen) != 2 || len(s.Manager.Collectors) != 0 {
		t.Fatal("ineligible items counted or two items launched a collector")
	}

	id := simulation.EntityID(s.World)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, ID: &id, Position: Vec.Add(items[0].Position, Vec.Create(0, 500))}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	s.World.Tick = station.CheckAt
	s.Dispatch()

	if len(s.Manager.Collectors) != 0 {
		t.Fatal("an isolated freshly dropped third item bypassed its grace period")
	}

	s.ItemsCollected([]protocol.SimulationEvent{protocol.ItemCollected{ItemID: id}})
	s.World.Tick = station.CheckAt
	s.Dispatch()

	if len(s.Manager.Collectors) != 0 {
		t.Fatal("collecting and redropping the same entity retained its earlier eligibility")
	}

	s.World.Tick = station.CheckAt
	s.Dispatch()

	if len(s.Manager.Collectors) != 1 {
		t.Fatal("three aged items did not launch a collector")
	}
}

func TestCollectorStationsDispatchIndependentlyForOverlappingItems(t *testing.T) {
	s, home, items := collectorFixture(t, 3)
	other := home
	other.ID++
	other.Position = Vec.Add(home.Position, Vec.Create(1500, 0))
	otherID := s.Host.Regions.IDOffset + int64(other.ID)
	station := objects.CreateStation(objects.Properties{DefinitionID: other.DefinitionID, ObjectProperties: simulation.ObjectProperties{World: s.World, ID: &otherID, Position: other.Position}}, s.World.Specification)
	simulation.AddEntity(s.World, station)
	first := collectorClock(s, home)
	second := &dispatchStation{Home: other}
	runtime := s.Manager
	runtime.Stations[otherID] = second
	s.Dispatch()

	if len(first.Seen) != 3 || len(second.Seen) != 3 || len(runtime.Collectors) != 0 {
		t.Fatal("overlapping stations did not independently observe the loose items")
	}

	s.World.Tick = max(first.CheckAt, second.CheckAt)
	s.Dispatch()

	if len(runtime.Collectors) != 2 {
		t.Fatal("one station reserved the other station's collection work")
	}

	for _, npc := range runtime.Collectors {
		for _, item := range items {
			if !slices.ContainsFunc(npc.Items, func(listed pickupItem) bool { return listed.ID == item.ID }) {
				t.Fatal("overlapping stations split or reserved their independent pickup lists")
			}
		}
	}

	if runtime.Collectors[0].HomeID == runtime.Collectors[1].HomeID {
		t.Fatal("both trips launched from the same station")
	}
}

func TestCollectorDiscoveryKeepsLoadedRegionsAfterFirstVisit(t *testing.T) {
	s, home, _ := collectorFixture(t, 3)
	s.discoverStations()
	runtime := s.Manager
	homeID := s.Host.Regions.IDOffset + int64(home.ID)
	station := runtime.Stations[homeID]

	if station == nil {
		t.Fatal("loose items did not discover their home station")
	}

	checkAt := station.CheckAt

	// A repeated discovery must not unload physics descriptions in another region.
	position := Vec.Add(home.Position, Vec.Create(20000, 20000))
	s.Host.Regions.View(position, nil)
	size := s.World.Specification.Simulation.RegionSize
	region := Vec.Create(math.Floor(position.X/size), math.Floor(position.Y/size))
	loaded := s.Host.Regions.Procedural.Load(region)
	s.World.Tick = runtime.DiscoverAt
	s.discoverStations()

	if s.Host.Regions.Procedural.Load(region) != loaded {
		t.Fatal("repeated station discovery unloaded an active physics region")
	}

	if station.CheckAt != checkAt {
		t.Fatal("repeated discovery restarted a station's grace timer")
	}
}

func TestCollectorDiscoveryFindsNewSleepingItemRegionsOnSchedule(t *testing.T) {
	s, _, _ := collectorFixture(t, 1)
	s.discoverStations()
	runtime := s.Manager
	far := s.Host.NearestStation(Vec.Create(50000, 50000))
	farID := s.Host.Regions.IDOffset + int64(far.ID)

	if runtime.Stations[farID] != nil {
		t.Fatal("fixture's second station must lie outside the first discovery")
	}

	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Add(far.Position, Vec.Create(500, 0))}, s.World.Specification)
	s.Host.Regions.Sleeping.Set(item.ID, item)
	s.World.Tick = runtime.DiscoverAt - 1
	s.discoverStations()

	if runtime.Stations[farID] != nil {
		t.Fatal("station discovery ran before its one-second interval")
	}

	s.World.Tick++
	s.discoverStations()

	if runtime.Stations[farID] == nil {
		t.Fatal("sleeping cargo in a new region did not discover its station")
	}
}

func TestCollectorDispatchIncludesFreshNeighborsOfOlderItems(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	station := collectorClock(s, home)
	s.Dispatch()
	old := s.entity(items[0].ID)
	old.Base().Position = Vec.Add(home.Position, Vec.Create(2000, 0))
	s.World.Entities.Delete(items[0].ID)
	s.Host.Regions.Sleeping.Set(items[0].ID, old)
	wanted := []int64{items[0].ID}
	var excluded []int64

	for _, offset := range []Vec.Vector{Vec.Create(200, 0), Vec.Create(0, -200), Vec.Create(400, 0), Vec.Create(0, -201)} {
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Add(old.Base().Position, offset)}, s.World.Specification)
		simulation.AddEntity(s.World, item)

		if Vec.LengthSquared(offset) <= 200*200 {
			wanted = append(wanted, item.ID)
		} else {
			excluded = append(excluded, item.ID)
		}
	}

	// Ineligible objects cannot join the group even at its center.
	for _, kind := range []string{"message", "unlock", "buried", "dead"} {
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: old.Base().Position}, s.World.Specification)

		switch kind {
		case "message":
			item.Message = new("A clue")
		case "unlock":
			item.Unlock = "paint"
		case "buried":
			item.Buried = true
		case "dead":
			item.Dead = true
		}

		simulation.AddEntity(s.World, item)
		excluded = append(excluded, item.ID)
	}

	s.World.Tick = station.CheckAt
	s.Dispatch()
	collectors := s.Manager.Collectors

	if len(collectors) != 1 || len(collectors[0].Items) != len(wanted) {
		t.Fatalf("one older item and its two fresh neighbors did not launch together: %v", collectors)
	}

	for _, id := range wanted {
		if !slices.ContainsFunc(collectors[0].Items, func(item pickupItem) bool { return item.ID == id }) {
			t.Fatalf("nearby item %d was omitted from the trip", id)
		}
	}

	for _, id := range excluded {
		if slices.ContainsFunc(collectors[0].Items, func(item pickupItem) bool { return item.ID == id }) {
			t.Fatalf("ineligible, distant, or chained fresh item %d bypassed its grace period", id)
		}
	}
}

func TestCollectorFreshGroupDoesNotExtendOperatingRadius(t *testing.T) {
	s, home, items := collectorFixture(t, 1)
	anchor := s.entity(items[0].ID)
	anchor.Base().Position = Vec.Add(home.Position, Vec.Create(9990, 0))
	station := collectorClock(s, home)
	s.Dispatch()

	for _, distance := range []float64{9980, 9995, 10010} {
		item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Add(home.Position, Vec.Create(distance, 0))}, s.World.Specification)
		s.Host.Regions.Sleeping.Set(item.ID, item)
	}

	s.World.Tick = station.CheckAt
	s.Dispatch()
	collectors := s.Manager.Collectors

	if len(collectors) != 1 || len(collectors[0].Items) != 3 {
		t.Fatal("fresh group did not keep exactly its three in-range items")
	}

	for _, item := range collectors[0].Items {
		if Vec.Distance(item.Position, home.Position) > 10000 {
			t.Fatal("nearby-item expansion crossed the station's operating boundary")
		}
	}
}

func TestCollectorFreshNeighborsRespectExistingAssignments(t *testing.T) {
	s, home, _ := collectorFixture(t, 3)
	station := collectorClock(s, home)
	s.Dispatch()
	s.World.Tick = station.CheckAt
	s.Dispatch()
	first := s.Manager.Collectors[0]
	anchor := s.entity(first.Items[0].ID)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: anchor.Base().Position}, s.World.Specification)
	simulation.AddEntity(s.World, item)
	s.World.Tick = station.CheckAt
	s.Dispatch()
	collectors := s.Manager.Collectors

	if len(collectors) != 2 || len(collectors[1].Items) != 1 || collectors[1].Items[0].ID != item.ID {
		t.Fatal("fresh neighbor was omitted or existing assignments were duplicated")
	}
}

func TestCollectorDispatchDoesNotDuplicateItsOwnTrips(t *testing.T) {
	s, home, _ := collectorFixture(t, 13)
	station := collectorClock(s, home)
	s.Dispatch()
	s.World.Tick = station.CheckAt
	s.Dispatch()

	// A later check must count both the flying list and queued departures.
	s.World.Tick = station.CheckAt
	s.Dispatch()
	runtime := s.Manager

	if len(runtime.Collectors) != 2 || len(station.Queue) != 1 {
		t.Fatalf("duplicated active or queued work: %d collectors, %d queued", len(runtime.Collectors), len(station.Queue))
	}

	s.World.Tick = station.LaunchAt
	s.Dispatch()
	s.World.Tick = station.CheckAt
	s.Dispatch()

	if len(runtime.Collectors) != 3 || len(station.Queue) != 0 {
		t.Fatal("another observation duplicated the three active trips")
	}

	failed := runtime.Collectors[0]
	failed.State = stranded
	s.World.Tick = station.CheckAt
	s.Dispatch()

	if len(runtime.Collectors) != 4 || len(runtime.Collectors[3].Items) != len(failed.Items) {
		t.Fatal("stranded work was not made available at the normal next check")
	}

	for _, item := range failed.Items {
		if !slices.ContainsFunc(runtime.Collectors[3].Items, func(reassigned pickupItem) bool { return reassigned.ID == item.ID }) {
			t.Fatal("replacement trip did not retain the stranded worker's uncollected items")
		}
	}
}

func TestCollectorNudgedItemMustSettleAndQualifyAgain(t *testing.T) {
	for _, velocity := range []Vec.Vector{Vec.Create(5, 0), Vec.Create(0, -5), Vec.Create(.001, 0)} {
		s, home, items := collectorFixture(t, 3)
		station := collectorClock(s, home)
		item := s.entity(items[2].ID)
		item.Base().Position = Vec.Add(home.Position, Vec.Create(2000, 0))
		s.Dispatch()
		item.Base().Velocity = velocity
		s.World.Tick = station.CheckAt
		s.Dispatch()

		if station.Seen[items[2].ID] || len(s.Manager.Collectors) != 0 {
			t.Fatalf("nudged item still counted as abandoned: velocity=%v", velocity)
		}

		item.Base().Velocity = Vec.Vector{}
		s.World.Tick = station.CheckAt
		s.Dispatch()

		if !station.Seen[items[2].ID] || len(s.Manager.Collectors) != 0 {
			t.Fatal("settling did not start a new grace period for the isolated item")
		}

		s.World.Tick = station.CheckAt
		s.Dispatch()

		if len(s.Manager.Collectors) != 1 || len(s.Manager.Collectors[0].Items) != 3 {
			t.Fatal("settled item did not qualify after the next complete check interval")
		}
	}
}

func TestCollectorMovingItemsCannotJoinOrAnchorNearbyGroups(t *testing.T) {
	for _, movingAnchor := range []bool{false, true} {
		s, home, items := collectorFixture(t, 1)
		station := collectorClock(s, home)
		s.Dispatch()
		anchor := s.entity(items[0].ID)
		movingID := items[0].ID

		if movingAnchor {
			anchor.Base().Velocity = Vec.Create(5, 0)
		}

		for index := range 2 {
			item := objects.NewItem("gold", simulation.ObjectProperties{World: s.World, Position: Vec.Add(anchor.Base().Position, Vec.Create(float64(index+1)*20, 0))}, s.World.Specification)

			if !movingAnchor && index == 0 {
				item.Velocity = Vec.Create(0, 5)
				movingID = item.ID
			}

			simulation.AddEntity(s.World, item)
		}

		s.World.Tick = station.CheckAt
		s.Dispatch()

		if station.Seen[movingID] || len(s.Manager.Collectors) != 0 {
			t.Fatalf("nearby grouping counted a moving item: movingAnchor=%v", movingAnchor)
		}
	}
}

type collectorMovementParent struct {
	*simulation.GameObject
}

func (p *collectorMovementParent) Holds(child simulation.Entity) bool {
	return Vec.DistanceSquared(p.Position, child.Base().Position) < 600*600
}

func (p *collectorMovementParent) Momentum(Vec.Vector) Vec.Vector { return Vec.Vector{} }

func TestCollectorItemsCarriedOnlyByLocalMovementRemainEligible(t *testing.T) {
	for _, stationParent := range []bool{false, true} {
		s, home, items := collectorFixture(t, 3)
		var parent simulation.Entity
		properties := simulation.ObjectProperties{World: s.World, Position: home.Position, Spin: .03, Velocity: Vec.Create(10, 20)}

		if stationParent {
			parent = objects.NewStation("corral-5", objects.Properties{ObjectProperties: properties}, s.World.Specification)
		} else {
			holder := &collectorMovementParent{GameObject: simulation.NewGameObject(properties, s.World.Specification.Simulation)}
			holder.Self = holder
			parent = holder
		}

		simulation.AddEntity(s.World, parent)
		station := &dispatchStation{Home: home}

		for index, item := range items {
			entity := s.entity(item.ID)
			entity.Base().Position = Vec.Add(home.Position, Vec.Create(100, float64(index)*50))
			entity.Base().Spin = .1
		}

		if len(s.observeItems(station)) != 0 {
			t.Fatal("items qualified before their first grace period")
		}

		for _, item := range items {
			entity := s.entity(item.ID)
			before := entity.Base().Position
			entity.Base().Update(.5)

			if entity.Base().Position == before || entity.Base().LocalMovementParent != parent || entity.Base().Velocity != (Vec.Vector{}) {
				t.Fatal("fixture did not reproduce an item carried only by local movement")
			}
		}

		if len(s.observeItems(station)) != 3 {
			t.Fatalf("local movement excluded otherwise settled items: stationParent=%v", stationParent)
		}

		s.entity(items[0].ID).Base().Velocity = Vec.Create(5, 0)

		if len(s.observeItems(station)) != 2 || station.Seen[items[0].ID] {
			t.Fatal("a local movement parent hid an item's independent drift")
		}
	}
}

func TestCollectorDiscoveryWaitsForItemsToStop(t *testing.T) {
	s, _, items := collectorFixture(t, 1)
	item := s.entity(items[0].ID)
	item.Base().Velocity = Vec.Create(5, 0)
	s.discoverStations()
	runtime := s.Manager

	if len(runtime.Stations) != 0 {
		t.Fatal("moving loot started a station's collector clock")
	}

	item.Base().Velocity = Vec.Vector{}
	s.World.Tick = runtime.DiscoverAt
	s.discoverStations()

	if len(runtime.Stations) == 0 {
		t.Fatal("settled loot did not discover nearby stations")
	}
}
