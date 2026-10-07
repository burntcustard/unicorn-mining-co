package objects

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/random"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

// SavedObject contains mechanics, never live pointers, caches, or callbacks.
// Gob preserves the NaN defaults used by the simulation and is versioned by
// the database schema. Capture runs on the world owner; encoding runs elsewhere.
type SavedObject struct {
	ID                                                                                                                                  int64
	Kind, DefinitionID, Label, Unlock                                                                                                   string
	Position, Velocity                                                                                                                  Vec.Vector
	Rotation, Spin, Radius, AngularDrag, AngularInertiaScale, Mass, Friction, Drag, SpeedLimit, PendingUpdateTime, Health, Decay, Price float64
	Physics, Dead, Buried, Ballistic, HasPaint, HasResource, Item                                                                       bool
	Paint, PointCount, Resource                                                                                                         int
	RadiusEven, Bounciness                                                                                                              *float64
	Message                                                                                                                             *string
	PlayerID                                                                                                                            *int64
	Shades                                                                                                                              []string
	ShapeOutline                                                                                                                        *simulation.ShapeOutline
	LocalMovementParent                                                                                                                 int64
	LocalMovementRate                                                                                                                   float64
	RandomState                                                                                                                         float64
	SharedRandom                                                                                                                        bool
}

type SavedEntity struct {
	Rounds                   *int
	Object                   SavedObject
	ModuleType               string
	Contents                 []int
	MaxHealth                float64
	AsteroidSegments         []*simulation.AsteroidSegment
	HullHealth               []float64
	HullEdges                [][]bool
	Modules                  []ModuleState
	ModuleTypes              []string
	CargoContents            []SavedEntity
	Wreckage                 []WreckageSegment
	UnstrokedWreckage        []int
	ZeroFillWreckage         []int
	DockedTo                 *int64
	Launching, Forward, Turn float64
	HasLaunching             bool
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

func restoreModuleID(id string) string {
	switch id {
	case "shieldGenerator":
		return "shieldGeneratorSm"
	case "thrusterSingle":
		return "thrusterSingleMd"
	default:
		return id
	}
}

func CaptureEntity(entity simulation.Entity) SavedEntity {
	o := entity.Base()

	s := SavedEntity{Object: SavedObject{
		ID: o.ID, Kind: o.Kind, DefinitionID: o.DefinitionID, Label: o.Label, Unlock: o.Unlock,
		Position: Vec.Create(math.Round(o.Position.X), math.Round(o.Position.Y)), Velocity: o.Velocity, Rotation: o.Rotation, Spin: o.Spin, Radius: o.Radius,
		AngularDrag: o.AngularDrag, AngularInertiaScale: o.AngularInertiaScale, Mass: o.Mass, Friction: o.Friction,
		Drag: o.Drag, SpeedLimit: o.SpeedLimit, PendingUpdateTime: o.PendingUpdateTime, Health: o.Health, Decay: o.Decay, Price: o.Price,
		Physics: o.Physics, Dead: o.Dead, Buried: o.Buried, Ballistic: o.Ballistic, HasPaint: o.HasPaint, HasResource: o.HasResource, Item: o.Item,
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

		for i := range s.Modules {
			m := &s.Modules[i]
			s.ModuleTypes = append(s.ModuleTypes, c.Catalog.ModuleIDs[m.Type])
			m.ID, m.Health = savedPointer(m.ID), savedPointer(m.Health)
			m.Shades, m.Segments = slices.Clone(m.Shades), slices.Clone(m.Segments)
		}

		for _, item := range c.CargoContents {
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

func RestoreEntity(s SavedEntity, world *simulation.World) (simulation.Entity, error) {
	s.ModuleType = restoreModuleID(s.ModuleType)

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
			return nil, fmt.Errorf("unknown saved module %q", s.ModuleType)
		}

		entity = modules.Create(s.ModuleType, props, world.Specification)
	} else {
		switch o.Kind {
		case "projectile":
			entity = NewProjectile(o.DefinitionID, props, world.Specification)
		case "asteroid":
			props.Radius, props.Health, props.Mass, props.Resource, props.ShapeOutline = &o.Radius, &o.Health, &o.Mass, &o.Resource, o.ShapeOutline
			entity = simulation.CreateAsteroid(world, simulation.AsteroidProperties{ObjectProperties: props, Contents: s.Contents, MaxHealth: &s.MaxHealth, PointCount: o.PointCount, RadiusEven: o.RadiusEven, Segments: s.AsteroidSegments}).LockGeometry()
		case "item":
			id := ""

			if o.HasResource && o.Resource >= 0 && o.Resource < len(world.Specification.ItemIDs) {
				id = world.Specification.ItemIDs[o.Resource]
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

				if id == "" || id == "corral" {
					id = "corral-5"
				}

				if _, ok := world.Specification.StationSpecs[id]; !ok {
					return nil, fmt.Errorf("unknown saved station %q", id)
				}

				entity = CreateStation(p, world.Specification)
			} else {
				id := o.DefinitionID

				if id == "" {
					id = "mustang"
				}

				if _, ok := world.Specification.ShipSpecs[id]; !ok {
					return nil, fmt.Errorf("unknown saved ship %q", id)
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

			for i := range s.Modules {
				if i >= len(s.ModuleTypes) {
					return nil, fmt.Errorf("missing saved module type")
				}

				id := restoreModuleID(s.ModuleTypes[i])
				s.Modules[i].Type = slices.Index(c.Catalog.ModuleIDs, id)
				m := s.Modules[i]

				if m.Type < 0 || m.Type >= len(c.Catalog.ModuleIDs) {
					return nil, fmt.Errorf("unknown saved module index %d", m.Type)
				}
			}

			c.SetModuleStates(s.Modules)

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

			c.CargoContents = append(c.CargoContents, item)
		}

		c.DockedTo, c.Launching, c.Forward, c.Turn = s.DockedTo, s.Launching, s.Forward, s.Turn
		c.HasLaunching = s.HasLaunching
	}

	if o.Kind == "station" && o.DefinitionID == "corral" {
		o.DefinitionID = ""
	}

	b := entity.Base()
	b.ID, b.Kind, b.DefinitionID, b.Label, b.Unlock = o.ID, o.Kind, o.DefinitionID, o.Label, o.Unlock
	b.Position, b.Velocity, b.Rotation, b.Spin, b.Radius = o.Position, o.Velocity, o.Rotation, o.Spin, o.Radius
	b.AngularDrag, b.AngularInertiaScale, b.Mass, b.Friction = o.AngularDrag, o.AngularInertiaScale, o.Mass, o.Friction
	b.Drag, b.SpeedLimit, b.PendingUpdateTime, b.Health, b.Decay, b.Price = o.Drag, o.SpeedLimit, o.PendingUpdateTime, o.Health, o.Decay, o.Price
	b.Physics, b.Dead, b.Buried, b.Ballistic, b.HasPaint, b.HasResource, b.Item = o.Physics, o.Dead, o.Buried, o.Ballistic, o.HasPaint, o.HasResource, o.Item
	b.Paint, b.PointCount, b.Resource, b.RadiusEven, b.Bounciness = o.Paint, o.PointCount, o.Resource, o.RadiusEven, o.Bounciness
	b.Message, b.PlayerID, b.Shades, b.ShapeOutline = o.Message, o.PlayerID, o.Shades, o.ShapeOutline
	b.LocalMovementRate = o.LocalMovementRate
	b.Random = random.CreateRandom(o.RandomState)

	if o.SharedRandom {
		b.Random = world.Random
	}

	return entity, nil
}
