// Port of src/client/objects/ship.ts.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	"math"
	"slices"
)

type Ship struct{ *Craft }

func newShip(props Properties, plans []*simulation.SegmentPlan, catalog definitions.Catalog) *Ship {
	s := &Ship{NewCraft(props, plans, catalog)}
	s.Self = s
	s.Kind = "ship"
	s.AngularInertiaScale = catalog.Simulation.Flight.AngularInertiaScale

	if props.AngularInertiaScale != nil {
		s.AngularInertiaScale = *props.AngularInertiaScale
	}

	return s
}

func (s *Ship) Cargo() *[]simulation.Entity { return &s.CargoContents }

func (s *Ship) CargoCapacity() int { return s.CargoSpace }

func (s *Ship) HandleContacts(contacts []collision.Contact, events *[]protocol.SimulationEvent, world *simulation.World, dt float64) {
	type drillContact struct {
		contact       collision.Contact
		drill, target *collision.Collider
	}

	drills := utilities.NewOrderedMap[*simulation.Segment, drillContact]()

	for _, contact := range contacts {
		var own *collision.Collider

		if contact.Collider.Owner == s.Self {
			own = contact.Collider
		} else if contact.Other.Owner == s.Self {
			own = contact.Other
		}

		if own == nil {
			continue
		}

		segment, _ := own.Segment.(*simulation.Segment)

		if segment == nil {
			continue
		}

		if hatch, ok := segment.Module.(*modules.CargoHatch); ok {
			hatch.Collect(s, contact, events, world)
		}

		if _, ok := segment.Module.(*modules.HornDrill); !ok || own.Role != "hornDrill" {
			continue
		}

		target := contact.Collider

		if target == own {
			target = contact.Other
		}

		current, ok := drills.Get(segment)

		if !ok || contact.Depth > current.contact.Depth {
			drills.Set(segment, drillContact{contact, own, target})
		}
	}

	drills.ForEach(func(value drillContact, segment *simulation.Segment) {
		segment.Module.(*modules.HornDrill).Drill(s, segment, value.target, value.contact.Point, events, world, dt, Damage, func(c *collision.Collider) string { return collision.OutlineColorOf(c, s.Catalog.Colors) })
	})
}

func (s *Ship) HullHealthTotal() float64 {
	sum := 0.0

	for _, segment := range s.Segments {
		if segment.Hull {
			sum += segment.Health
		}
	}

	return sum
}

func (s *Ship) HullMaxHealth() float64 {
	sum := 0.0

	for _, plan := range s.HullSegments {
		if plan.Health != nil {
			sum += *plan.Health
		}
	}

	return sum
}

func integer32(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}

	return float64(int32(uint32(int64(math.Mod(math.Trunc(value), 4294967296)))))
}

func (s *Ship) RepairCost(mount *simulation.Mount) float64 {
	if mount == nil {
		return s.HullMaxHealth() - integer32(s.HullHealthTotal())
	}

	if mount.Module != nil {
		return mount.Module.Base().Health - integer32(mount.Health)
	}

	return 0
}

func (s *Ship) ApplyDockAction(action protocol.DockAction) (protocol.DockAction, bool) {
	mounts := s.Mounts()
	var mount *simulation.Mount

	if action.HasMount && action.Mount >= 0 && action.Mount < int64(len(mounts)) {
		mount = mounts[action.Mount]
	}

	switch action.Action {
	case "sell":
		ids := action.ObjectIDs

		if len(ids) == 0 || len(ids) > len(s.CargoContents) {
			return action, false
		}

		seen := map[int64]bool{}
		objects := []simulation.Entity{}

		for _, id := range ids {
			if seen[id] {
				return action, false
			}

			seen[id] = true
			var found simulation.Entity

			for _, e := range s.CargoContents {
				if e.Base().ID == id {
					found = e
					break
				}
			}

			if found == nil {
				return action, false
			}

			_, module := found.(simulation.Module)

			if !module && !found.Base().Item {
				return action, false
			}

			objects = append(objects, found)
		}

		s.CargoContents = slices.DeleteFunc(s.CargoContents, func(e simulation.Entity) bool { return seen[e.Base().ID] })

		sum := 0.0

		for _, e := range objects {
			price := e.Base().Price

			if !math.IsNaN(price) {
				sum += price
			}
		}

		s.Credits += sum
	case "buy":
		if action.Module < 0 || action.Module >= int64(len(s.Catalog.ModuleIDs)) {
			return action, false
		}

		id := s.Catalog.ModuleIDs[action.Module]
		d := s.Catalog.ModuleDefinitions[id]

		if s.Credits < d.Price || len(s.CargoContents) >= s.CargoSpace {
			return action, false
		}

		props := simulation.ObjectProperties{}

		if action.HasModuleID {
			props.ID = &action.ModuleID
		}

		module := modules.Create(id, props, s.Catalog)
		s.Credits -= d.Price
		s.CargoContents = append(s.CargoContents, module)
		action.ModuleID = module.Base().ID
		action.HasModuleID = true
	case "equip":
		var module simulation.Module

		for _, m := range s.Modules() {
			if m.Base().ID == action.ModuleID {
				module = m
				break
			}
		}

		if mount == nil || module == nil || !slices.Contains(mount.Fits, module.ModuleBase().Type) {
			return action, false
		}

		s.Fit(module, mount)
	case "repair":
		if !action.HasMount {
			if action.HasModuleID {
				return action, false
			}

			cost := s.RepairCost(nil)

			if !(cost > 0) || s.Credits < cost {
				return action, false
			}

			s.Credits -= cost
			s.FixHull()
		} else {
			if mount == nil || mount.Module == nil || mount.Module.Base().ID != action.ModuleID {
				return action, false
			}

			cost := s.RepairCost(mount)

			if !(cost > 0) || s.Credits < cost {
				return action, false
			}

			s.Credits -= cost
			mount.Health = mount.Module.Base().Health
		}
	case "paint":
		if action.Paint < 0 || action.Paint >= int64(len(s.Catalog.PaintColors)) {
			return action, false
		}

		var module simulation.Module

		if action.HasModuleID {
			if action.HasMount {
				if mount != nil {
					module = mount.Module
				}
			} else {
				for _, m := range s.Modules() {
					if m.Base().ID == action.ModuleID {
						module = m
						break
					}
				}
			}
		}

		if action.HasMount && (mount == nil || mount.Module == nil || mount.Module.Base().ID != action.ModuleID) || action.HasModuleID && module == nil {
			return action, false
		}

		shades := s.Catalog.PaintColors[action.Paint]

		if module != nil {
			module.Base().Shades = shades
		} else {
			s.Shades = shades
		}

		for _, segment := range s.Segments {
			if module != nil && segment.Module == module || module == nil && segment.Hull {
				segment.Shades = shades
			}
		}
	case "remove":
		if mount == nil {
			return action, false
		}

		s.Fit(nil, mount)
	default:
		return action, false
	}

	return action, true
}

func (s *Ship) Engine() simulation.Module {
	for _, segment := range s.Segments {
		for _, m := range segment.Mounts {
			module := m.Module

			if module != nil && module.ModuleBase().Definition.ForwardThrust != 0 && module.ModuleBase().Mount != nil && !(module.ModuleBase().Mount.Health < 1) {
				return module
			}
		}
	}

	for _, e := range s.CargoContents {
		if m, ok := e.(simulation.Module); ok && m.ModuleBase().Definition.ForwardThrust != 0 && m.ModuleBase().Mount != nil && !(m.ModuleBase().Mount.Health < 1) {
			return m
		}
	}

	return nil
}

func (s *Ship) LaunchThrottle() float64 {
	f := s.Rules.Flight

	if s.Launching > f.LaunchHalfThreshold && s.Launching <= f.LaunchHalfEnd {
		return f.LaunchThrottle
	}

	return 1
}

func (s *Ship) ForwardThrust() float64 {
	engine := s.Engine()

	if engine == nil {
		return 0
	}

	throttle := s.LaunchThrottle()
	return engine.ModuleBase().Definition.ForwardThrust * (throttle * throttle)
}

func (s *Ship) RotationalThrust() float64 {
	engine := s.Engine()

	if engine == nil {
		return 0
	}

	throttle := s.LaunchThrottle()
	return engine.ModuleBase().Definition.RotationalThrust * (throttle * throttle)
}

func (s *Ship) MaxSpeed() float64 {
	if s.Cockpit != nil {
		speed := s.Rules.Flight.SpeedPerThrust * s.ForwardThrust()

		if speed != 0 {
			return speed
		}
	}

	return s.Rules.Flight.UncrewedMaxSpeed
}

func (s *Ship) Fly(forward, turn float64) {
	s.Forward, s.Turn = forward, turn

	for _, segment := range s.Segments {
		if segment.ModuleDefinition().ForwardThrust == 0 {
			continue
		}

		segment.Active = forward

		if turn != 0 && segment.ThrusterNozzleSide != 0 {
			if turn == -segment.ThrusterNozzleSide {
				segment.Active = 1
			} else {
				segment.Active = forward * s.Rules.Flight.SteeringEase
			}
		}

		segment.Active *= s.LaunchThrottle()
	}
}

func (s *Ship) Update(dt float64) {
	if s.Launching != 0 {
		s.Launching = max(0, s.Launching-dt)
		s.Fly(s.Forward, s.Turn)
	}

	if s.Cockpit != nil && (s.DockedTo == nil || *s.DockedTo == 0) {
		f := s.Rules.Flight
		push := ((f.ThrustScale * s.ForwardThrust()) / s.Mass) * s.Forward * dt
		thrust := s.RotationalThrust()
		throttle := s.LaunchThrottle()
		target := (s.Turn * s.TurnRate * thrust * (throttle * throttle)) / f.SpinDivisor
		s.Spin = utilities.Approach(s.Spin, target, thrust*dt)
		s.Velocity = simulation.MovePoint(s.Velocity, s.Rotation+s.Spin*dt, push)
	}

	s.Craft.Update(dt)
}

func (s *Ship) ShipBase() *Ship { return s }

func (s *Ship) ResetBiting() {
	for _, segment := range s.Segments {
		segment.Biting = false
	}
}

func NewShip(id string, props Properties, catalog definitions.Catalog) *Ship {
	d, ok := catalog.ShipDefinitions[id]

	if !ok {
		panic("Unknown ship definition: " + id)
	}

	if props.Drag == nil {
		props.Drag = &d.Drag
	}

	if props.Mass == nil {
		props.Mass = &d.Mass
	}

	if props.Radius == nil {
		props.Radius = &d.Radius
	}

	plans := make([]*simulation.SegmentPlan, len(d.HullSegments))

	for i, segment := range d.HullSegments {
		health := segment.Health
		p := make([]simulation.Point, len(segment.Points))

		for j, point := range segment.Points {
			p[j] = simulation.Point(point)
		}

		plan := &simulation.SegmentPlan{Health: health, Points: &simulation.ShapeOutline{Points: p}, Core: segment.Core, ZIndex: segment.ZIndex}

		for _, mount := range segment.Mounts {
			plan.Mounts = append(plan.Mounts, simulation.NewMount(mount.LocalPosition, mount.Fits))
		}

		plans[i] = plan
	}

	ship := newShip(props, plans, catalog)
	ship.Self = ship

	if id != "mustang" {
		ship.DefinitionID = id
	}

	ship.CargoSpace = d.CargoSpace
	ship.TurnRate = d.TurnRate
	return ship
}

func CreateShip(world *simulation.World, props Properties) *Ship {
	if props.ID == nil {
		id := simulation.EntityID(world)
		props.ID = &id
	}

	props.World = world

	if props.DefinitionID == "" {
		props.DefinitionID = "mustang"
	}

	props.Credits = world.Specification.ShipDefinitions[props.DefinitionID].StartingCredits
	ship := NewShip(props.DefinitionID, props, world.Specification)
	ship.HasCredits = true

	for _, id := range world.Specification.ShipDefinitions[props.DefinitionID].StartingModules {
		ship.Fit(modules.Create(id, simulation.ObjectProperties{}, world.Specification), nil)
	}

	return ship
}
