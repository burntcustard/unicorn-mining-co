package collector

import (
	"cmp"
	"math"
	"math/rand/v2"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

/*
Eligible excludes buried cargo, wreckage, and messages consumed on pickup.
Sleeping items still count: collection continues without any connected players.
*/
func Eligible(entity simulation.Entity) bool {
	item := entity.Base()
	return item.Item && !item.Dead && !item.Buried && item.Message == nil && item.Unlock == ""
}

/*
Velocity stores independent drift; local movement carries Position separately.
Only settled items enter new pickup lists. Existing targets stay valid when a
collector nudges them during an approach.
*/
func dispatchable(entity simulation.Entity) bool {
	return Eligible(entity) && entity.Base().Velocity == (Vec.Vector{})
}

func (s *Manager) checkAt() uint64 {
	rules := s.World.Specification.CollectorSpec
	delay := rules.CheckIntervalMin + rand.Float64()*(rules.CheckIntervalMax-rules.CheckIntervalMin)
	return s.World.Tick + max(1, uint64(math.Ceil(delay/s.World.Specification.Simulation.SimulationStep)))
}

/*
discoverStations starts independent station clocks near loose items without
loading a 10,000-meter circle of physics or requiring a nearby human observer.
*/
func (s *Manager) discoverStations() {
	rules := s.World.Specification.CollectorSpec

	if s.World.Tick < s.DiscoverAt {
		return
	}

	s.DiscoverAt = s.World.Tick + max(1, uint64(rules.DiscoveryInterval/s.World.Specification.Simulation.SimulationStep))

	if s.Stations == nil {
		s.Stations = make(map[int64]*dispatchStation)
	}

	if s.Regions == nil {
		s.Regions = make(map[Vec.Vector]bool)
	}

	size := s.World.Specification.Simulation.RegionSize
	ranges := protocol.WorldRanges{StationMarker: rules.OperatingRadius + math.Sqrt2*size}

	visit := func(entity simulation.Entity, _ int64) {
		if !dispatchable(entity) {
			return
		}

		position := entity.Base().Position
		region := Vec.Create(math.Floor(position.X/size), math.Floor(position.Y/size))

		if s.Regions[region] {
			return
		}

		// Station positions are fixed. Re-querying known regions would also
		// replace the procedural manager's cached physics-region view.
		s.Regions[region] = true

		for _, home := range s.Environment.Stations(Vec.Scale(region, size), &ranges) {
			id := s.Environment.StationID(home)

			if s.Stations[id] == nil {
				s.Stations[id] = &dispatchStation{Home: home, CheckAt: s.checkAt()}
			}
		}
	}

	s.World.Entities.ForEach(visit)
	s.Environment.Sleeping(visit)
}

func (s *Manager) Dispatch() {
	s.discoverStations()
	world := s.World
	rules := world.Specification.CollectorSpec
	capacity := world.Specification.ShipSpecs[rules.Ship].CargoSpace

	if capacity <= 0 {
		return
	}

	for homeID, station := range s.Stations {
		if world.Tick >= station.CheckAt {
			items := s.observeItems(station)
			station.CheckAt = s.checkAt()

			if len(items) >= rules.MinimumItems {
				assigned := s.assignedItems(homeID, station)

				items = slices.DeleteFunc(items, func(item pickupItem) bool { return assigned[item.ID] })

				slices.SortFunc(items, func(a, b pickupItem) int {
					if distance := cmp.Compare(Vec.DistanceSquared(a.Position, station.Home.Position), Vec.DistanceSquared(b.Position, station.Home.Position)); distance != 0 {
						return distance
					}

					return cmp.Compare(a.ID, b.ID)
				})

				for trip := range slices.Chunk(items, capacity) {
					station.Queue = append(station.Queue, trip)
				}
			}
		}

		if len(station.Queue) > 0 && world.Tick >= station.LaunchAt {
			s.spawn(station.Home, station.Queue[0])
			station.Queue[0] = nil
			station.Queue = station.Queue[1:]
			station.LaunchAt = world.Tick + max(1, uint64(rules.LaunchInterval/world.Specification.Simulation.SimulationStep))
		}
	}
}

/*
observeItems includes fresh neighbors of items seen at both checks.
Only older items anchor nearby groups, so fresh chains cannot extend them.
The small spatial index avoids comparing every loose item with every older one.
*/
func (s *Manager) observeItems(station *dispatchStation) []pickupItem {
	rules := s.World.Specification.CollectorSpec
	radius := rules.NearbyItemRadius
	seen := make(map[int64]bool)
	groups := make(map[Vec.Vector][]Vec.Vector)
	var items []pickupItem

	cellAt := func(position Vec.Vector) Vec.Vector {
		return Vec.Create(math.Floor(position.X/radius), math.Floor(position.Y/radius))
	}

	visit := func(entity simulation.Entity, id int64) {
		item := entity.Base()

		if seen[id] || !dispatchable(entity) || Vec.DistanceSquared(item.Position, station.Home.Position) > rules.OperatingRadius*rules.OperatingRadius {
			return
		}

		seen[id] = true
		items = append(items, pickupItem{ID: id, Position: item.Position, Name: item.Name})

		if station.Seen[id] && radius > 0 {
			cell := cellAt(item.Position)
			groups[cell] = append(groups[cell], item.Position)
		}
	}

	s.World.Entities.ForEach(visit)
	s.Environment.Sleeping(visit)

	items = slices.DeleteFunc(items, func(item pickupItem) bool {
		if station.Seen[item.ID] {
			return false
		}

		if len(groups) > 0 {
			cell := cellAt(item.Position)

			for x := -1; x <= 1; x++ {
				for y := -1; y <= 1; y++ {
					for _, position := range groups[Vec.Add(cell, Vec.Create(float64(x), float64(y)))] {
						if Vec.DistanceSquared(item.Position, position) <= radius*radius {
							return false
						}
					}
				}
			}
		}

		return true
	})

	station.Seen = seen
	return items
}

/*
An item collected and dropped again loses its earlier age. It can still join a
nearby older item's group, just like any other freshly dropped item.
*/
func (s *Manager) ItemsCollected(events []protocol.SimulationEvent) {
	for _, event := range events {
		if pickup, ok := event.(protocol.ItemCollected); ok {

			markTaken := func(items []pickupItem) {
				for i := range items {
					if items[i].ID == pickup.ItemID {
						items[i].Taken = true
					}
				}
			}

			for _, npc := range s.Collectors {
				markTaken(npc.Items)
			}

			for _, station := range s.Stations {
				delete(station.Seen, pickup.ItemID)

				for _, items := range station.Queue {
					markTaken(items)
				}
			}
		}
	}
}

/*
A station does not send another worker for an unfinished assignment. Other
stations remain independent; returning or stranded workers release their lists.
Reservations are derived from the saved lists, so they need no separate state.
*/
func (s *Manager) assignedItems(homeID int64, station *dispatchStation) map[int64]bool {
	assigned := make(map[int64]bool)

	include := func(items []pickupItem) {
		for _, item := range items {
			if !item.Taken {
				assigned[item.ID] = true
			}
		}
	}

	for _, npc := range s.Collectors {
		if npc.HomeID == homeID && !npc.ship.Dead && (npc.State == collecting || npc.State == inspecting) {
			include(npc.Items)
		}
	}

	for _, items := range station.Queue {
		include(items)
	}

	return assigned
}
