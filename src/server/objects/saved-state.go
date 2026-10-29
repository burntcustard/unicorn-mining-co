package objects

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/random"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"log"
	"math"
	"slices"
)

// SavedObject contains mechanics, never live pointers, caches, or callbacks.
// Gob preserves the NaN defaults used by the simulation and is versioned by
// the database schema. Capture runs on the world owner; encoding runs elsewhere.
// Label is the legacy on-disk key for Name; keep it compatible with existing gob saves.
type SavedObject struct {
	ID                                                       int64
	Kind, DefinitionID, Label, Unlock                        string
	Position, Velocity                                       Vec.Vector
	Rotation, Spin, Radius, AngularDrag, AngularInertiaScale float64
	Mass, Friction, Drag, SpeedLimit                         float64
	PendingUpdateTime, Health, Decay, Price                  float64
	Physics, Dead, Buried, Ballistic                         bool
	HasPaint, HasResource, Item, Mined                       bool
	Paint, PointCount, Resource                              int
	RadiusEven, Bounciness                                   *float64
	Message                                                  *string
	PlayerID                                                 *int64
	Shades                                                   []string
	ShapeOutline                                             *simulation.ShapeOutline
	LocalMovementParent                                      int64
	LocalMovementRate                                        float64
	RandomState                                              float64
	SharedRandom                                             bool
}

type SavedEntity struct {
	TransitTime float64
	TransitGate int64
	Fuel        float64
	StoredPower float64
	// Gob omits zero-valued pointers; an empty battery needs explicit presence.
	HasPower                    bool
	ThrusterPower, SystemsPower float64
	Rounds                      *int
	Object                      SavedObject
	ModuleType                  string
	Contents                    []int
	MaxHealth                   float64
	AsteroidSegments            []*simulation.AsteroidSegment
	HullHealth                  []float64
	HullEdges                   [][]bool
	Modules                     []ModuleState
	ModuleTypes                 []string
	CargoContents               []SavedEntity
	Wreckage                    []WreckageSegment
	UnstrokedWreckage           []int
	ZeroFillWreckage            []int
	DockedTo                    *int64
	Launching, Forward, Turn    float64
	HasLaunching                bool
}

func savedPointer[T any](p *T) *T {
	if p == nil {
		return nil
	}

	v := *p
	return &v
}

func savedOutline(p *simulation.ShapeOutline) *simulation.ShapeOutline {
	if p == nil {
		return nil
	}

	return &simulation.ShapeOutline{Points: slices.Clone(p.Points), Edges: slices.Clone(p.Edges)}
}

func CaptureEntity(entity simulation.Entity) SavedEntity {
	o := entity.Base()

	s := SavedEntity{Object: SavedObject{
		ID: o.ID, Kind: o.Kind, DefinitionID: o.DefinitionID, Label: o.Name, Unlock: o.Unlock,
		Position: Vec.Create(math.Round(o.Position.X), math.Round(o.Position.Y)), Velocity: o.Velocity, Rotation: o.Rotation, Spin: o.Spin, Radius: o.Radius,
		AngularDrag: o.AngularDrag, AngularInertiaScale: o.AngularInertiaScale, Mass: o.Mass, Friction: o.Friction,
		Drag: o.Drag, SpeedLimit: o.SpeedLimit, PendingUpdateTime: o.PendingUpdateTime, Health: o.Health, Decay: o.Decay, Price: o.Price,
		Physics: o.Physics, Dead: o.Dead, Buried: o.Buried, Ballistic: o.Ballistic, HasPaint: o.HasPaint, HasResource: o.HasResource, Item: o.Item, Mined: o.Mined,
		Paint: o.Paint, PointCount: o.PointCount, Resource: o.Resource, RadiusEven: savedPointer(o.RadiusEven), Bounciness: savedPointer(o.Bounciness),
		Message: savedPointer(o.Message), PlayerID: savedPointer(o.PlayerID), Shades: slices.Clone(o.Shades), ShapeOutline: savedOutline(o.ShapeOutline),
		LocalMovementRate: o.LocalMovementRate,
	}}

	if o.LocalMovementParent != nil {
		s.Object.LocalMovementParent = o.LocalMovementParent.Base().ID
	}

	if o.Random != nil {
		s.Object.RandomState = o.Random.State
		s.Object.SharedRandom = o.World != nil && o.Random == o.World.Random

		if s.Object.SharedRandom {
			s.Object.RandomState = 0
		}
	}

	if m, ok := entity.(simulation.Module); ok {
		s.ModuleType = m.ModuleBase().Type
	}

	if item, ok := entity.(*Item); ok {
		s.Rounds = savedPointer(item.Rounds)
	}

	if a, ok := entity.(*simulation.Asteroid); ok {
		s.Contents, s.MaxHealth = slices.Clone(a.Contents), a.MaxHealth

		if a.ShapeOutline != nil || a.Damaged() {
			for _, segment := range a.Segments() {
				v := *segment
				v.Contents, v.ShapeOutline = slices.Clone(segment.Contents), savedOutline(segment.ShapeOutline)
				s.AsteroidSegments = append(s.AsteroidSegments, &v)
			}
		}
	}

	if c := craftOf(entity); c != nil {
		s.HullHealth = c.HullHealth()

		for _, plan := range c.HullSegments {
			var edges []bool

			if plan.Points != nil {
				edges = slices.Clone(plan.Points.Edges)
			}

			s.HullEdges = append(s.HullEdges, edges)
		}

		s.Modules = c.ModuleStates()

		if o.Kind == "station" {
			s.Modules = slices.DeleteFunc(s.Modules, func(m ModuleState) bool { return m.Mount < 0 })
		}

		for i := range s.Modules {
			m := &s.Modules[i]
			s.ModuleTypes = append(s.ModuleTypes, c.Catalog.ModuleIDs[m.Type])
			// ModuleStates owns its pointers and segments; shades still reference
			// the live module and need an isolated copy for the writer.
			m.Shades = slices.Clone(m.Shades)
		}

		for _, item := range c.CargoContents {
			if _, module := item.(simulation.Module); o.Kind == "station" && module {
				continue
			}

			// Modules are restored by SetModuleStates; preserve their cargo order below.
			s.CargoContents = append(s.CargoContents, CaptureEntity(item))
		}

		s.Wreckage = c.Wreckage()

		for i := range s.Wreckage {
			w := &s.Wreckage[i]

			// Gob collapses an empty slice to nil. Retain the distinction between
			// an empty stroke and the default stroke around the whole shape.
			if w.Stroke != nil && len(w.Stroke) == 0 {
				s.UnstrokedWreckage = append(s.UnstrokedWreckage, i)
			}

			// A pointer to zero is also omitted by Gob, but shade zero is the
			// explicit dark fill rather than the hull renderer's default shade.
			if w.FillShade != nil && *w.FillShade == 0 {
				s.ZeroFillWreckage = append(s.ZeroFillWreckage, i)
			}

			w.ShapeOutline, w.FillShade = slices.Clone(w.ShapeOutline), savedPointer(w.FillShade)
			w.Stroke = slices.Clone(w.Stroke)

			for j := range w.Stroke {
				w.Stroke[j] = slices.Clone(w.Stroke[j])

				for k := range w.Stroke[j] {
					w.Stroke[j][k] = slices.Clone(w.Stroke[j][k])
				}
			}
		}

		s.DockedTo = savedPointer(c.DockedTo)
		s.Launching, s.Forward, s.Turn = c.Launching, c.Forward, c.Turn
		s.HasLaunching = c.HasLaunching
		s.TransitTime, s.TransitGate = c.TransitTime, c.TransitGate
	}

	if ship, ok := entity.(*Ship); ok {
		s.Fuel = ship.Fuel
		s.StoredPower, s.HasPower = ship.StoredPower, true
		s.ThrusterPower, s.SystemsPower = ship.ThrusterPower, ship.SystemsPower
	}

	return s
}

func craftOf(entity simulation.Entity) *Craft {
	switch c := entity.(type) {
	case *Ship:
		return c.Craft
	case *Station:
		return c.Craft
	case *Craft:
		return c
	}

	return nil
}

// RestoreEntity returns nil without an error for definitions removed from the catalog.
func RestoreEntity(s SavedEntity, world *simulation.World) (simulation.Entity, error) {
	o := s.Object

	for _, index := range s.UnstrokedWreckage {
		if index < 0 || index >= len(s.Wreckage) {
			return nil, fmt.Errorf("invalid saved wreckage stroke index %d", index)
		}

		s.Wreckage[index].Stroke = [][][]float64{}
	}

	for _, index := range s.ZeroFillWreckage {
		if index < 0 || index >= len(s.Wreckage) {
			return nil, fmt.Errorf("invalid saved wreckage fill index %d", index)
		}

		fill := 0.0
		s.Wreckage[index].FillShade = &fill
	}

	props := simulation.ObjectProperties{ID: &o.ID, World: world, Random: random.CreateRandom(float64(o.ID))}
	var entity simulation.Entity

	if s.ModuleType != "" {
		if _, ok := world.Specification.ModuleSpecs[s.ModuleType]; !ok {
			log.Printf("Warning: skipping unknown saved module %q (ID %d)", s.ModuleType, o.ID)
			return nil, nil
		}

		entity = modules.Create(s.ModuleType, props, world.Specification)
	} else {
		switch o.Kind {
		case "projectile":
			if _, ok := world.Specification.ModuleSpecs[o.DefinitionID]; !ok {
				log.Printf("Warning: skipping saved projectile for unknown module %q (ID %d)", o.DefinitionID, o.ID)
				return nil, nil
			}

			entity = NewProjectile(o.DefinitionID, props, world.Specification)
		case "asteroid":
			props.Radius, props.Health, props.Mass, props.Resource, props.ShapeOutline = &o.Radius, &o.Health, &o.Mass, &o.Resource, o.ShapeOutline
			entity = simulation.CreateAsteroid(world, simulation.AsteroidProperties{ObjectProperties: props, Contents: s.Contents, MaxHealth: &s.MaxHealth, PointCount: o.PointCount, RadiusEven: o.RadiusEven, Segments: s.AsteroidSegments}).LockGeometry()
		case "item":
			id := ""

			if o.HasResource && o.Resource >= 0 && o.Resource < len(world.Specification.ItemIDs) {
				id = world.Specification.ItemIDs[o.Resource]
			}

			if _, ok := world.Specification.ItemSpecs[id]; o.HasResource && !ok {
				log.Printf("Warning: skipping unknown saved item resource %d (ID %d)", o.Resource, o.ID)
				return nil, nil
			}

			item := NewItem(id, props, world.Specification)

			if s.Rounds != nil {
				item.Rounds = savedPointer(s.Rounds)
			}

			entity = item
		case "ship", "station", "craft":
			p := Properties{ObjectProperties: props, DefinitionID: o.DefinitionID, Shades: o.Shades}

			if s.Wreckage != nil {
				entity = CreateWreckage(p, s.Wreckage, world.Specification)
			} else if o.Kind == "station" {
				id := o.DefinitionID

				if id == "" {
					id = "corral-5"
				}

				if _, ok := world.Specification.StationSpecs[id]; !ok {
					log.Printf("Warning: skipping unknown saved station %q (ID %d)", id, o.ID)
					return nil, nil
				}

				p.CargoContents = []simulation.Entity{}
				entity = CreateStation(p, world.Specification)
			} else {
				id := o.DefinitionID

				if id == "" {
					id = "mustang"
				}

				if _, ok := world.Specification.ShipSpecs[id]; !ok {
					log.Printf("Warning: skipping unknown saved ship %q (ID %d)", id, o.ID)
					return nil, nil
				}

				entity = NewShip(id, p, world.Specification)
			}
		default:
			entity = simulation.NewGameObject(props, world.Specification.Simulation)
		}
	}

	if c := craftOf(entity); c != nil {
		if s.Wreckage == nil {
			c.SetHullHealth(s.HullHealth)

			states := []ModuleState{}

			for i, m := range s.Modules {
				if i >= len(s.ModuleTypes) {
					return nil, fmt.Errorf("missing saved module type")
				}

				id := s.ModuleTypes[i]
				m.Type = slices.Index(c.Catalog.ModuleIDs, id)

				if _, exists := c.Catalog.ModuleSpecs[id]; !exists || m.Type < 0 {
					log.Printf("Warning: skipping unknown saved module %q on craft %d", id, o.ID)
					continue
				}

				states = append(states, m)
			}

			c.SetModuleStates(states)

			for i, plan := range c.HullSegments {
				if plan.Points != nil && i < len(s.HullEdges) {
					plan.Points.Edges = slices.Clone(s.HullEdges[i])
				}
			}

		}

		c.CargoContents = nil

		for _, cargo := range s.CargoContents {
			item, err := RestoreEntity(cargo, world)

			if err != nil {
				return nil, err
			}

			if item != nil {
				c.CargoContents = append(c.CargoContents, item)
			}
		}

		c.DockedTo, c.Launching, c.Forward, c.Turn = s.DockedTo, s.Launching, s.Forward, s.Turn
		c.HasLaunching = s.HasLaunching
		c.TransitTime, c.TransitGate = s.TransitTime, s.TransitGate
	}

	if ship, ok := entity.(*Ship); ok {
		ship.Fuel = s.Fuel

		if s.HasPower {
			ship.StoredPower = min(s.StoredPower, ship.PowerCapacity())
			ship.ThrusterPower, ship.SystemsPower = s.ThrusterPower, s.SystemsPower
		} else {
			ship.StoredPower = ship.PowerCapacity()
		}
	}

	b := entity.Base()
	b.ID, b.Kind, b.DefinitionID, b.Unlock = o.ID, o.Kind, o.DefinitionID, o.Unlock

	if o.Label != "" {
		b.Name = o.Label
	}

	b.Position, b.Velocity, b.Rotation, b.Spin, b.Radius = o.Position, o.Velocity, o.Rotation, o.Spin, o.Radius
	b.AngularDrag, b.AngularInertiaScale, b.Mass, b.Friction = o.AngularDrag, o.AngularInertiaScale, o.Mass, o.Friction
	b.Drag, b.SpeedLimit, b.PendingUpdateTime, b.Health, b.Decay, b.Price = o.Drag, o.SpeedLimit, o.PendingUpdateTime, o.Health, o.Decay, o.Price
	b.Physics, b.Dead, b.Buried, b.Ballistic, b.HasPaint, b.HasResource, b.Item, b.Mined = o.Physics, o.Dead, o.Buried, o.Ballistic, o.HasPaint, o.HasResource, o.Item, o.Mined
	b.Paint, b.PointCount, b.Resource, b.RadiusEven, b.Bounciness = o.Paint, o.PointCount, o.Resource, o.RadiusEven, o.Bounciness
	b.Message, b.PlayerID, b.Shades, b.ShapeOutline = o.Message, o.PlayerID, o.Shades, o.ShapeOutline
	b.LocalMovementRate = o.LocalMovementRate
	b.Random = random.CreateRandom(o.RandomState)

	if o.SharedRandom {
		b.Random = world.Random
	}

	return entity, nil
}
