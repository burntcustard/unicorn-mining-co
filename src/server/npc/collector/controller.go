package collector

import (
	"encoding/json"
	"math"
	"slices"

	ai "github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/persistence"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

const (
	collecting = "Collecting"
	inspecting = "Inspecting"
	returning  = "Returning"
	stranded   = "Stranded"
)

type pickupItem struct {
	ID       int64
	Position Vec.Vector
	Name     string
	Taken    bool
}

type inspection struct {
	pickupItem
	ArrivedAt float64
	StartedAt float64
	Announced bool
}

type state struct {
	Home                         protocol.StationDescription
	HomeID                       int64
	Credits                      float64
	State                        string
	Items                        []pickupItem
	TargetID                     int64
	AttemptStartedAt, ThinkAfter float64
	Attempts                     map[int64]float64 `json:"Attempts,omitempty"`
	Missing                      int
	Inspect                      *inspection
	Inspected                    map[int64]bool
	HullSegments, Modules        int
}

type collector struct {
	state
	ship  *objects.Ship
	pilot ai.Pilot
	input protocol.Input
}

type dispatchStation struct {
	Home     protocol.StationDescription
	CheckAt  uint64
	Seen     map[int64]bool
	Queue    [][]pickupItem
	LaunchAt uint64
}

type Manager struct {
	World       *simulation.World
	Environment ai.Environment
	Collectors  []*collector
	Stations    map[int64]*dispatchStation
	Regions     map[Vec.Vector]bool
	DiscoverAt  uint64
}

func New(environment ai.Environment) *Manager {
	return &Manager{World: environment.World(), Environment: environment}
}

func (s *Manager) spawn(home protocol.StationDescription, items []pickupItem) *collector {
	rules := s.World.Specification.CollectorSpec
	npc := &collector{state: state{Home: home, HomeID: s.Environment.StationID(home), Items: slices.Clone(items), State: collecting, Inspected: make(map[int64]bool)}}
	npc.ship = ai.Spawn(s.Environment, ai.SpawnOptions{DefinitionID: rules.Ship, Name: ai.DialogText(rules.Names), Home: home, Credits: &npc.Credits})
	npc.HullSegments, npc.Modules = ai.Equipment(npc.ship)
	npc.ship.NPCState = npc.State
	s.Collectors = append(s.Collectors, npc)
	s.chat(npc, s.World.Specification.CollectorDialog.Departure)
	return npc
}

func (s *Manager) chat(npc *collector, lines []string, replacements ...string) {
	ai.Chat(s.Environment, npc.ship, "friendly", lines, replacements...)
}

func (s *Manager) returnHome(npc *collector, lines []string) {
	npc.State, npc.Inspect = returning, nil
	s.chat(npc, lines)
}

func (s *Manager) Update() {
	world := s.World
	now := float64(world.Tick) * world.Specification.Simulation.SimulationStep

	s.Collectors = slices.DeleteFunc(s.Collectors, func(npc *collector) bool {
		ship := npc.ship

		if ship.Dead || !world.Entities.Has(ship.ID) || ship.DockedTo != nil {
			if !ship.Dead && ship.DockedTo != nil {
				ai.SellCargo(ship, &npc.Credits, nil)
			}

			ai.Remove(s.Environment, ship)
			return true
		}

		if now+1e-9 >= npc.ThinkAfter {
			npc.ThinkAfter = now + world.Specification.NPCMovement.DecisionInterval
			npc.input = s.inputFor(npc, now)
			ship.NPCState = npc.State
		}

		s.Environment.SetInput(*ship.PlayerID, npc.input)
		return false
	})
}

func (s *Manager) ForEachShip(visit func(*objects.Ship)) {
	for _, npc := range s.Collectors {
		visit(npc.ship)
	}
}

func (s *Manager) entity(id int64) simulation.Entity {
	entity := s.Environment.Entity(id)

	if entity != nil && Eligible(entity) {
		return entity
	}

	return nil
}

func (npc *collector) finishItem(id int64) {
	npc.Inspected[id] = true
	delete(npc.Attempts, id)

	npc.Items = slices.DeleteFunc(npc.Items, func(item pickupItem) bool { return item.ID == id })

	if npc.TargetID == id {
		npc.TargetID, npc.AttemptStartedAt = 0, 0
	}
}

/*
Keep nearby pickups stable, but leave a flung item when another assignment is
substantially easier to reach. Suspended attempts retain the time already spent.
Taken or missing items still require a visit to their last recorded position.
*/
func (s *Manager) pickupTarget(npc *collector, now float64) (*pickupItem, simulation.Entity) {
	items := npc.Items
	var positionStorage [10]Vec.Vector
	var entityStorage [10]simulation.Entity
	positions, entities := positionStorage[:], entityStorage[:]

	if len(items) > len(positions) {
		positions = make([]Vec.Vector, len(items))
		entities = make([]simulation.Entity, len(items))
	}

	positions, entities = positions[:len(items)], entities[:len(items)]
	current := -1

	for index := range items {
		item := &items[index]
		positions[index] = item.Position

		if !item.Taken {
			entities[index] = s.entity(item.ID)

			if entities[index] != nil {
				positions[index] = entities[index].Base().Position
			}
		}

		if item.ID == npc.TargetID {
			current = index
			item.Position = positions[index]
		}
	}

	selectedIndex := current

	if current < 0 {
		selectedIndex = pickupRoute(npc.ship, npc.Home.Position, positions)
	} else if entities[current] != nil {
		distance := Vec.Distance(npc.ship.Position, positions[current])
		best := ai.PickupDeparture(npc.ship, positions[current]) / 1.3

		if distance > max(300, npc.ship.Radius*6) {
			for index, position := range positions {
				if index == current || entities[index] == nil || distance < Vec.Distance(npc.ship.Position, position)*1.8+120 {
					continue
				}

				if duration := ai.PickupDeparture(npc.ship, position); duration < best {
					selectedIndex, best = index, duration
				}
			}
		}
	}

	selected, target := &items[selectedIndex], entities[selectedIndex]

	if npc.TargetID != selected.ID {
		if npc.Attempts == nil {
			npc.Attempts = make(map[int64]float64)
		}

		if npc.TargetID != 0 {
			npc.Attempts[npc.TargetID] = now - npc.AttemptStartedAt
		}

		npc.TargetID, npc.AttemptStartedAt = selected.ID, now-npc.Attempts[selected.ID]
	}

	return selected, target
}

/*
pickupRoute compares complete pickup orders ending at the projected return bay.
The first leg uses the ship's actual heading and momentum. Larger assignments
keep a linear scan so custom cargo capacities cannot make planning unbounded.
*/
func pickupRoute(ship *objects.Ship, home Vec.Vector, positions []Vec.Vector) int {
	speed := max(1, ship.MaxSpeed())
	elapsed := float64(len(positions)) * ship.Radius / speed

	for _, position := range positions {
		elapsed += Vec.Distance(home, position) / speed
	}

	bays := returnWaypoints(ship, home, elapsed, nil)
	n := len(positions)
	selected, best := 0, math.Inf(1)

	if n > 12 {
		for index, position := range positions {
			if cost := ai.PickupDeparture(ship, position); cost < best {
				selected, best = index, cost
			}
		}

		return selected
	}

	count := 1 << n
	// Each entry starts at index, visits the set in mask, then reaches a bay.
	costs := make([]float64, count*n)

	for mask := 1; mask < count; mask++ {
		for index, position := range positions {
			if mask&(1<<index) == 0 {
				continue
			}

			remaining := mask ^ (1 << index)
			cost := math.Inf(1)

			if remaining == 0 {
				for _, bay := range bays {
					cost = min(cost, Vec.Distance(position, bay)/speed)
				}
			} else {
				for next, target := range positions {
					if remaining&(1<<next) != 0 {
						cost = min(cost, Vec.Distance(position, target)/speed+costs[remaining*n+next])
					}
				}
			}

			costs[mask*n+index] = cost
		}
	}

	for index, position := range positions {
		if cost := ai.PickupDeparture(ship, position) + costs[(count-1)*n+index]; cost < best {
			selected, best = index, cost
		}
	}

	return selected
}

/*
returnWaypoints projects the rotating bay approaches. A supplied departure point
limits the first leg to the station's tangent; nil retains the full bay approach
for comparing pickup routes.
*/
func returnWaypoints(ship *objects.Ship, home Vec.Vector, elapsed float64, from *Vec.Vector) []Vec.Vector {
	var station *objects.Station

	for _, entity := range ship.World.Entities.ReadValues() {
		if candidate, ok := entity.(*objects.Station); ok && !candidate.Dead && len(candidate.DockingBays) > 0 && Vec.DistanceSquared(candidate.Position, home) < 1 {
			station = candidate
			break
		}
	}

	if station == nil {
		return []Vec.Vector{home}
	}

	positions := make([]Vec.Vector, 0, len(station.DockingBays))

	for _, bay := range station.DockingBays {
		angle := station.Rotation + bay + station.Spin*elapsed

		if from != nil {
			offset := Vec.Subtract(*from, station.Position)
			bearing := math.Atan2(offset.Y, offset.X)
			limit := math.Acos(min(1, (station.Radius+ship.Radius)/max(1, Vec.Length(offset))))
			angle = bearing + max(-limit, min(limit, math.Remainder(angle-bearing, 2*math.Pi)))
		}

		positions = append(positions, Vec.AddScaled(station.Position, Vec.Create(math.Cos(angle), math.Sin(angle)), station.Radius+150))
	}

	return positions
}

func (s *Manager) inputFor(npc *collector, now float64) protocol.Input {
	ship := npc.ship
	rules := s.World.Specification.CollectorSpec
	dialog := s.World.Specification.CollectorDialog

	if ship.Stranded() {
		if npc.State != stranded {
			npc.State = stranded
			s.chat(npc, dialog.Stranded)
		}

		return protocol.Input{}
	}

	if npc.State == stranded {
		npc.State = returning
	}

	if npc.State != returning {
		hull, modules := ai.Equipment(ship)

		switch {
		case len(ship.CargoContents) >= ship.CargoSpace:
			s.returnHome(npc, dialog.CargoFull)
		case hull < npc.HullSegments || modules < npc.Modules:
			s.returnHome(npc, dialog.Damaged)
		case Vec.DistanceSquared(ship.Position, npc.Home.Position) > rules.OperatingRadius*rules.OperatingRadius:
			s.returnHome(npc, dialog.OutsideRadius)
		}
	}

	if npc.State == returning {
		return npc.steer(npc.pilot.ReturnMovement(ship, ai.Movement{Position: npc.Home.Position, TargetID: npc.HomeID}))
	}

	// Remove only our own pickups; missing targets still require an on-site visit.
	for _, cargo := range ship.CargoContents {
		npc.finishItem(cargo.Base().ID)
	}

	if len(npc.Items) == 0 {
		s.returnHome(npc, dialog.Finished)
		return npc.steer(npc.pilot.ReturnMovement(ship, ai.Movement{Position: npc.Home.Position, TargetID: npc.HomeID}))
	}

	if ship.Launching > 0 {
		return protocol.Input{Thrust: 1, CargoHatch: true}
	}

	if npc.Inspect != nil {
		return s.inspectItem(npc, now)
	}

	item, entity := s.pickupTarget(npc, now)

	if now-npc.AttemptStartedAt+1e-9 >= rules.PickupTimeout {
		s.chat(npc, dialog.Unreachable, "{item_name}", item.Name)
		npc.finishItem(item.ID)
		return protocol.Input{}
	}

	if entity != nil {
		item.Position = entity.Base().Position
	}

	s.noticeItem(npc, now, Vec.DistanceSquared(ship.Position, item.Position))

	if npc.Inspect != nil {
		return s.inspectItem(npc, now)
	}

	if entity == nil {
		if Vec.DistanceSquared(ship.Position, item.Position) > rules.ArrivalDistance*rules.ArrivalDistance {
			return npc.steer(ai.Movement{Position: item.Position})
		}

		npc.Missing++
		lines := [][]string{dialog.MissingFirst, dialog.MissingSecond, dialog.MissingThird, dialog.MissingFourth, dialog.MissingFifth, dialog.MissingSixth}
		s.chat(npc, lines[min(npc.Missing, len(lines))-1])
		npc.finishItem(item.ID)

		if len(npc.Items) == 0 {
			npc.State = returning
		}

		return protocol.Input{}
	}

	nextPositions := make([]Vec.Vector, 0, len(npc.Items))

	for _, remaining := range npc.Items {
		if remaining.ID != item.ID && !remaining.Taken {
			if entity := s.entity(remaining.ID); entity != nil && !entity.Base().Dead {
				nextPositions = append(nextPositions, entity.Base().Position)
			}
		}
	}

	if len(nextPositions) == 0 {
		nextPositions = returnWaypoints(ship, npc.Home.Position, (Vec.Distance(ship.Position, item.Position)+ship.Radius)/max(1, ship.MaxSpeed()), &item.Position)
	}

	return npc.steer(ai.Movement{Position: item.Position, Velocity: entity.Base().Velocity, IgnoreID: item.ID, Collect: true, NextPositions: nextPositions})
}

/*
Unlisted items are inspected once per trip, with the hatches closed. They never
replace the saved pickup list or restart its grace period.
*/
func (s *Manager) noticeItem(npc *collector, now, targetDistanceSquared float64) {
	rangeSquared := min(targetDistanceSquared, s.World.Specification.CollectorSpec.InspectionRange*s.World.Specification.CollectorSpec.InspectionRange)
	var nearest simulation.Entity

	s.World.Entities.ForEach(func(entity simulation.Entity, id int64) {
		if !Eligible(entity) || npc.Inspected[id] || slices.ContainsFunc(npc.Items, func(item pickupItem) bool { return item.ID == id && !item.Taken }) {
			return
		}

		if distance := Vec.DistanceSquared(npc.ship.Position, entity.Base().Position); distance < rangeSquared {
			nearest, rangeSquared = entity, distance
		}
	})

	if nearest != nil {
		item := nearest.Base()
		npc.Inspect = &inspection{pickupItem: pickupItem{ID: item.ID, Position: item.Position, Name: item.Name}, StartedAt: now}
		npc.Inspected[item.ID] = true
		npc.State = inspecting
	}
}

func (s *Manager) inspectItem(npc *collector, now float64) protocol.Input {
	inspection := npc.Inspect
	rules := s.World.Specification.CollectorSpec
	entity := s.entity(inspection.ID)
	distance := npc.ship.Radius + rules.InspectionDistance
	velocity := Vec.Vector{}

	if inspection.ArrivedAt == 0 && now-inspection.StartedAt+1e-9 >= rules.PickupTimeout {
		s.chat(npc, s.World.Specification.CollectorDialog.Unreachable, "{item_name}", inspection.Name)
		npc.AttemptStartedAt += now - inspection.StartedAt
		npc.Inspect, npc.State = nil, collecting
		return protocol.Input{}
	}

	if entity != nil {
		inspection.Position = entity.Base().Position
		distance += entity.Base().Radius
		velocity = entity.Base().Velocity
	}

	if inspection.ArrivedAt == 0 && Vec.Distance(npc.ship.Position, inspection.Position) <= distance+5 && Vec.Length(Vec.Subtract(npc.ship.Velocity, velocity)) < 10 {
		inspection.ArrivedAt = now
	}

	if inspection.ArrivedAt > 0 {
		if !inspection.Announced && now-inspection.ArrivedAt+1e-9 >= rules.InspectionDelay {
			inspection.Announced = true
			s.chat(npc, s.World.Specification.CollectorDialog.Unlisted)
		}

		if now-inspection.ArrivedAt+1e-9 >= rules.InspectionDuration {
			// Looking at an unexpected item does not consume the pickup attempt.
			if npc.TargetID != 0 {
				npc.AttemptStartedAt += now - inspection.StartedAt
			}

			npc.Inspect, npc.State = nil, collecting
			return protocol.Input{}
		}
	}

	return npc.steer(ai.Movement{Position: inspection.Position, Velocity: velocity, FollowDistance: distance, TargetID: inspection.ID, Waiting: inspection.ArrivedAt > 0})
}

func (npc *collector) steer(movement ai.Movement) protocol.Input {
	input := protocol.Input{CargoHatch: movement.Collect && ai.CollectionHatch(npc.ship, movement.Position)}

	if npc.State == returning {
		input.Thrust, input.Turn = npc.pilot.Steer(npc.ship, movement)
	} else {
		input.Thrust, input.Turn = npc.pilot.SteerWithin(npc.ship, movement, npc.Home.Position, npc.ship.World.Specification.CollectorSpec.OperatingRadius)
	}

	return input
}

func (s *Manager) Capture() []persistence.NPC {
	var result []persistence.NPC

	for _, npc := range s.Collectors {
		if !npc.ship.Dead && s.World.Entities.Has(npc.ship.ID) {
			data, _ := json.Marshal(npc.state)
			result = append(result, persistence.NPC{Kind: "collector", ID: npc.ship.ID, State: data})
		}
	}

	return result
}

func (s *Manager) Restore(ship *objects.Ship, data json.RawMessage) error {
	npc := &collector{ship: ship}

	if err := json.Unmarshal(data, &npc.state); err != nil {
		return err
	}

	npc.ThinkAfter = 0
	ship.NPCState = npc.State
	s.Collectors = append(s.Collectors, npc)
	ai.Observe(s.Environment, ship, &npc.Credits)
	return nil
}

func (s *Manager) CaptureDispatch() json.RawMessage {
	data, _ := json.Marshal(s.Stations)
	return data
}

func (s *Manager) RestoreDispatch(data json.RawMessage) error {
	if len(data) == 0 {
		return nil
	}

	return json.Unmarshal(data, &s.Stations)
}
