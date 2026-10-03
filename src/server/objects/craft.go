// Port of src/client/objects/ts. Rendering hooks are omitted.
package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/physics"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

type Properties struct {
	DefinitionID string
	simulation.ObjectProperties
	Segments      []*simulation.Segment
	HullSegments  []*simulation.SegmentPlan
	CargoContents []simulation.Entity
	Shades        []string
	Credits       float64
	DockedTo      *int64
	Launching     float64
}

type geometrySource struct{ identity byte }

type Craft struct {
	HasCredits, HasLaunching bool
	*simulation.GameObject
	Catalog                                             definitions.Catalog
	Segments                                            []*simulation.Segment
	HullSegments                                        []*simulation.SegmentPlan
	CargoContents                                       []simulation.Entity
	Cockpit                                             *simulation.Segment
	DockedTo                                            *int64
	Launching, Forward, Turn, TurnRate, Credits, ZIndex float64
	CargoSpace                                          int
	source                                              *geometrySource
	colliders                                           []*collision.Collider
	spareColliders                                      []*collision.Collider
}

func (*Craft) IsCraft() {}

func NewCraft(props Properties, plans []*simulation.SegmentPlan, catalog definitions.Catalog) *Craft {
	c := &Craft{GameObject: simulation.NewGameObject(props.ObjectProperties, catalog.Simulation), Catalog: catalog, CargoContents: props.CargoContents, HullSegments: plans, DockedTo: props.DockedTo, Launching: props.Launching, Credits: props.Credits}
	c.Self = c
	c.Kind = "craft"
	c.Friction = definitions.CraftFriction
	c.Health = definitions.CraftHealth
	c.Shades = catalog.Colors["white"]
	c.ApplyProperties(props.ObjectProperties)

	if props.Shades != nil {
		c.Shades = props.Shades
	}

	if props.Segments != nil {
		c.Segments = props.Segments
		c.HullSegments = props.HullSegments
		c.Decay = definitions.WreckageDecay
		c.Health = definitions.WreckageHealth + c.Random.Next()
		c.Mass = float64(len(c.Segments))
		return c
	}

	if props.HullSegments != nil {
		c.HullSegments = props.HullSegments
	}

	c.Segments = []*simulation.Segment{}
	c.FixHull()
	return c
}

func centerOf(segments []*simulation.Segment) Vec.Vector {
	center := Vec.Vector{}

	for _, s := range segments {
		center = Vec.Add(center, Vec.Create(s.Middle[0], s.Middle[1]))
	}

	return Vec.Scale(center, 1/float64(len(segments)))
}

func outlinesOf(segments []*simulation.Segment) []*simulation.ShapeOutline {
	outlines := []*simulation.ShapeOutline{}

	for _, s := range segments {
		if s.Points != nil {
			outlines = append(outlines, s.Points)
		}
	}

	return outlines
}

func makeSegment(c *Craft, module simulation.Module, plan *simulation.SegmentPlan, mount *simulation.Mount) *simulation.Segment {
	s := &simulation.Segment{SegmentPlan: *plan, Hull: mount == nil, Module: module, Mount: mount, Health: math.NaN()}

	if module == nil {
		s.HullPlan = plan
	}

	if plan.Health != nil {
		s.Health = *plan.Health
	}

	duration := plan.ActivationDuration
	definition := s.ModuleDefinition()

	if duration == 0 {
		duration = definition.ActivationDuration
	}

	if duration == 0 {
		duration = definitions.DefaultActivationDuration
	}

	s.Rate = 1 / duration

	if plan.Points != nil {
		if plan.Points.Edges == nil {
			plan.Points.Edges = make([]bool, len(plan.Points.Points))

			for i := range plan.Points.Edges {
				plan.Points.Edges[i] = true
			}
		}

		if len(plan.Points.Points) > 0 {
			middle, reach := simulation.ShapeOutlineExtent(plan.Points.Points)
			s.Middle = &middle

			if s.Radius == nil {
				s.Radius = func(*simulation.Segment) float64 { return reach }
			}
		}
	}

	s.Shades = c.Shades

	if module != nil && module.Base().Shades != nil {
		s.Shades = module.Base().Shades
	} else if module == nil && plan.Shades != nil {
		s.Shades = plan.Shades
	}

	s.LocalPosition = plan.LocalPosition

	if mount != nil {
		s.LocalPosition = mount.LocalPosition
	}

	s.LocalPosition = Vec.Add(s.LocalPosition, Vec.Create(0, plan.ThrusterNozzleSide*definition.Offset))
	s.ZIndex = plan.ZIndex

	if s.ZIndex == 0 {
		s.ZIndex = definition.ZIndex
	}

	if s.ZIndex == 0 {
		s.ZIndex = c.ZIndex
	}

	return s
}

func (c *Craft) sortSegments() {
	slices.SortStableFunc(c.Segments, func(a, b *simulation.Segment) int {
		if a.ZIndex < b.ZIndex {
			return -1
		}

		if a.ZIndex > b.ZIndex {
			return 1
		}

		return 0
	})
}

func (c *Craft) Mounts() []*simulation.Mount {
	return c.AppendMounts([]*simulation.Mount{})
}

func (c *Craft) AppendMounts(mounts []*simulation.Mount) []*simulation.Mount {
	for _, s := range c.Segments {
		mounts = append(mounts, s.Mounts...)
	}

	return mounts
}

func (c *Craft) SegmentsAtMount(mount *simulation.Mount) []*simulation.Segment {
	out := []*simulation.Segment{}

	for _, s := range c.Segments {
		if s.Mount == mount {
			out = append(out, s)
		}
	}

	return out
}

func (c *Craft) Modules() []simulation.Module {
	return c.AppendModules([]simulation.Module{})
}

func (c *Craft) AppendModules(out []simulation.Module) []simulation.Module {
	for _, s := range c.Segments {
		for _, mount := range s.Mounts {
			if mount.Module != nil {
				out = append(out, mount.Module)
			}
		}
	}

	for _, object := range c.CargoContents {
		if module, ok := object.(simulation.Module); ok {
			out = append(out, module)
		}
	}

	return out
}

func (c *Craft) Fit(module simulation.Module, mount *simulation.Mount) {
	if mount == nil && module != nil {
		for _, candidate := range c.Mounts() {
			if candidate.Module == nil && slices.Contains(candidate.Fits, module.ModuleBase().Type) {
				mount = candidate
				break
			}
		}
	}

	if mount == nil || mount.Module == module {
		return
	}

	if module != nil && module.ModuleBase().Mount != nil && module.ModuleBase().Mount != mount {
		c.Fit(nil, module.ModuleBase().Mount)
	}

	c.Segments = slices.DeleteFunc(c.Segments, func(s *simulation.Segment) bool { return s.Mount == mount })

	if mount.Module != nil {
		mount.Module.ModuleBase().Mount = nil
		c.CargoContents = append(c.CargoContents, mount.Module)
	}

	mount.Module = module
	mount.Health = 0

	if module != nil {
		mount.Health = module.Base().Health

		c.CargoContents = slices.DeleteFunc(c.CargoContents, func(e simulation.Entity) bool { return e == module })

		module.ModuleBase().Mount = mount

		if module.Base().Shades == nil {
			module.Base().Shades = c.Shades
		}

		for _, plan := range module.ModuleBase().Model {
			c.Segments = append(c.Segments, makeSegment(c, module, plan, mount))
		}
	}

	c.sortSegments()
}

func (c *Craft) FixHull() {
	hulls := []*simulation.Segment{}

	for _, s := range c.Segments {
		if s.Hull {
			hulls = append(hulls, s)
		}
	}

	for _, plan := range c.HullSegments {
		var found *simulation.Segment

		for _, s := range hulls {
			if s.HullPlan == plan {
				found = s
				break
			}
		}

		if found != nil {
			found.Health = math.NaN()

			if plan.Health != nil {
				found.Health = *plan.Health
			}
		} else {
			s := makeSegment(c, nil, plan, nil)
			s.Mounts = []*simulation.Mount{}

			for _, mount := range plan.Mounts {
				copy := *mount
				copy.Hull = s
				s.Mounts = append(s.Mounts, &copy)
			}

			hulls = append(hulls, s)
			c.Segments = append(c.Segments, s)
		}
	}

	c.sortSegments()
	simulation.OuterEdges(outlinesOf(hulls))
	c.Cockpit = nil

	for _, s := range hulls {
		if s.Core {
			c.Cockpit = s
			break
		}
	}
}

func (c *Craft) Launch() {
	c.DockedTo = nil
	c.Launching = c.Rules.Flight.LaunchDuration
	c.HasLaunching = true
}

func (c *Craft) HullHealth() []float64 { return c.AppendHullHealth(nil) }

func (c *Craft) AppendHullHealth(values []float64) []float64 {
	if values == nil {
		values = make([]float64, 0, len(c.HullSegments))
	} else {
		values = values[:0]
	}

	for _, plan := range c.HullSegments {
		health := 0.0

		if plan.Health == nil {
			health = -1
		} else {
			for _, segment := range c.Segments {
				if segment.Hull && segment.HullPlan == plan {
					if !math.IsNaN(segment.Health) {
						health = segment.Health
					}

					break
				}
			}
		}

		values = append(values, health)
	}

	return values
}

func (c *Craft) SetHullHealth(values []float64) {
	current := c.HullHealth()
	unchanged := slices.Equal(current, values)

	for _, s := range c.Segments {
		target := s

		if !s.Hull && s.Mount != nil && s.Mount.Hull != nil {
			target = s.Mount.Hull
		}

		if target.Health < 1 {
			unchanged = false
		}
	}

	if unchanged {
		return
	}

	c.FixHull()

	for i, plan := range c.HullSegments {
		for _, s := range c.Segments {
			if s.Hull && s.HullPlan == plan && plan.Health != nil {
				s.Health = math.NaN()

				if i < len(values) {
					s.Health = values[i]
				}

				break
			}
		}
	}

	c.Segments = slices.DeleteFunc(c.Segments, func(s *simulation.Segment) bool {
		target := s

		if !s.Hull && s.Mount != nil && s.Mount.Hull != nil {
			target = s.Mount.Hull
		}

		return target.Health < 1
	})

	c.Cockpit = nil

	for _, s := range c.Segments {
		if s.Hull && s.Core {
			c.Cockpit = s
			break
		}
	}
}

func (c *Craft) ModuleStates() []ModuleState {
	mounts := c.Mounts()
	states := []ModuleState{}

	for _, module := range c.Modules() {
		d := module.ModuleBase()
		id := module.Base().ID
		health := module.Base().Health

		if d.Mount != nil {
			health = d.Mount.Health
		}

		state := ModuleState{ID: &id, Type: slices.Index(c.Catalog.ModuleIDs, d.Type), Mount: slices.Index(mounts, d.Mount), Health: &health, Shades: module.Base().Shades, Segments: []ModuleSegmentState{}}

		for _, s := range c.SegmentsAtMount(d.Mount) {
			if s.Module == module {
				state.Segments = append(state.Segments, ModuleSegmentState{s.Active, s.ActivationProgress})
			}
		}

		states = append(states, state)
	}

	return states
}

func (c *Craft) SetModuleStates(states []ModuleState) {
	previous, mounts := c.Modules(), c.Mounts()
	unchanged := len(previous) == len(states)

	if unchanged {
		for i, s := range states {
			m := previous[i]

			if s.ID != nil && m.Base().ID != *s.ID || slices.Index(c.Catalog.ModuleIDs, m.ModuleBase().Type) != s.Type || slices.Index(mounts, m.ModuleBase().Mount) != s.Mount {
				unchanged = false
				break
			}
		}
	}

	if !unchanged {
		for _, mount := range mounts {
			c.Fit(nil, mount)
		}

		c.CargoContents = slices.DeleteFunc(c.CargoContents, func(e simulation.Entity) bool { _, ok := e.(simulation.Module); return ok })
	}

	for i, state := range states {
		if state.Type < 0 || state.Type >= len(c.Catalog.ModuleIDs) {
			panic("Unknown ship module")
		}

		var module simulation.Module

		if unchanged {
			module = previous[i]
		} else {
			module = modules.Create(c.Catalog.ModuleIDs[state.Type], simulation.ObjectProperties{}, c.Catalog)
		}

		object := module.Base()

		if state.ID != nil {
			object.ID = *state.ID
		}

		if state.Mount >= 0 {
			object.Health = module.ModuleBase().Definition.Health
		} else {
			object.Health = math.NaN()

			if state.Health != nil {
				object.Health = *state.Health
			}
		}

		if state.Shades != nil {
			object.Shades = state.Shades
		}

		if state.Mount >= 0 {
			if state.Mount < len(mounts) {
				mount := mounts[state.Mount]

				if !unchanged {
					c.Fit(module, mount)
				}

				mount.Health = math.NaN()

				if state.Health != nil {
					mount.Health = *state.Health
				}

				for at, s := range c.SegmentsAtMount(mount) {
					if at < len(state.Segments) {
						s.Active = state.Segments[at].Active
						s.ActivationProgress = state.Segments[at].ActivationProgress
					}

					s.Shades = object.Shades

					if s.Shades == nil {
						s.Shades = c.Shades
					}
				}
			}
		} else if !unchanged {
			c.CargoContents = append(c.CargoContents, module)
		}
	}
}

func (c *Craft) Wreckage() []WreckageSegment {
	if c.Decay == 0 {
		return nil
	}

	out := []WreckageSegment{}

	for _, s := range c.Segments {
		record := WreckageSegment{Offset: s.LocalPosition, Health: *s.TargetHealth(), FillShade: s.FillShade, Stroke: s.Stroke}

		if p := s.Outline(); p != nil {
			record.ShapeOutline = p.Points
		}

		if s.Radius != nil {
			record.Radius = s.Radius(s)
		}

		out = append(out, record)
	}

	return out
}

func (c *Craft) ModuleActive(id string) bool {
	for _, s := range c.Segments {
		if s.Module != nil && s.Module.ModuleBase().Type == id && !(*s.TargetHealth() < 1) && s.Active != 0 {
			return true
		}
	}

	return false
}

func (c *Craft) SetModuleActive(id string, enabled bool) {
	value := 0.0

	if enabled {
		value = 1
	}

	for _, s := range c.Segments {
		if s.Module != nil && s.Module.ModuleBase().Type == id {
			s.Active = value
		}
	}
}

func (c *Craft) Toggle(id string) {
	for _, s := range c.Segments {
		if s.Module != nil && s.Module.ModuleBase().Type == id {
			s.Active = 1 - s.Active
		}
	}
}

func (c *Craft) UpdateModules(dt float64) {
	for _, s := range c.Segments {
		if c.DockedTo != nil && *c.DockedTo != 0 {
			s.Active = 0
		}

		target := s.Active

		if *s.TargetHealth() < 1 {
			target = 0
		}

		previous := s.ActivationProgress
		s.ActivationProgress = utilities.Approach(previous, target, s.Rate*dt)

		if s.Covers && s.ActivationProgress > previous {
			if c.World != nil {
				tick := c.World.Tick
				s.ExpandingTick = &tick
			} else {
				s.ExpandingTick = nil
			}
		}
	}
}

func (c *Craft) Momentum(position Vec.Vector) Vec.Vector {
	offset := Vec.Subtract(position, c.Position)
	return Vec.Create(-offset.Y*c.Spin, offset.X*c.Spin)
}

func (c *Craft) Spawn(origin Vec.Vector, segments []*simulation.Segment, own func(*simulation.Segment), shades []string, away Vec.Vector) *Craft {
	position := Vec.Add(c.Position, simulation.RotatePoint(origin, c.Rotation))
	velocity := Vec.Add(c.Velocity, c.Momentum(position))
	var id *int64

	if c.World != nil {
		value := simulation.EntityID(c.World)
		id = &value
	}

	copies := make([]*simulation.Segment, len(segments))

	for i, s := range segments {
		copy := *s
		copy.LocalPosition = Vec.Subtract(s.LocalPosition, origin)

		if own != nil {
			own(&copy)
		}

		copy.Collider = nil
		copy.DrillCollider = nil
		copies[i] = &copy
	}

	if shades == nil {
		shades = c.Shades
	}

	fragment := NewCraft(Properties{ID: id, World: c.World, Collections: c.Collections, Random: c.Random, Position: position, Velocity: velocity, Rotation: c.Rotation, Spin: c.Spin, Shades: shades, Segments: copies}, nil, c.Catalog)
	physics.ApplyForce(fragment, Vec.Scale(Vec.Normalize(simulation.RotatePoint(away, c.Rotation)), 30), c.Random.Next()-0.5)
	fragment.Add()
	return fragment
}

func (c *Craft) Detach(mount *simulation.Mount) {
	segments := []*simulation.Segment{}
	var wreckageMiddle *Vec.Vector
	mounted := c.SegmentsAtMount(mount)
	eligible := []*simulation.Segment{}

	for _, s := range mounted {
		if !s.NoWreckage {
			eligible = append(eligible, s)
		}
	}

	for _, s := range eligible {
		if s.Wreckage == nil {
			segments = append(segments, s)
			continue
		}

		plan := s.Wreckage
		outline := s.Outline()

		if plan.Points != nil {
			outline = plan.Points
		} else if plan.DynamicPoints != nil {
			outline = plan.DynamicPoints(s)
		}

		middle := simulation.Point{}
		radius := 0.0

		if outline != nil {
			if len(outline.Points) > 0 {
				middle, radius = simulation.ShapeOutlineExtent(outline.Points)
			} else {
				radius = math.Inf(-1)
			}
		}

		if len(eligible) == 1 {
			value := Vec.Create(middle[0], middle[1])
			wreckageMiddle = &value
		}

		copy := *s
		copy.DynamicPoints = nil

		if outline != nil {
			copy.Points = &simulation.ShapeOutline{Points: make([]simulation.Point, len(outline.Points))}

			for i, p := range outline.Points {
				copy.Points.Points[i] = simulation.Point{p[0] - middle[0], p[1] - middle[1]}
			}
		}

		copy.FillShade = plan.FillShade

		if copy.FillShade == nil {
			fill := 1.0

			if *s.TargetHealth() < s.Module.Base().Health/2 {
				fill = 0
			}

			copy.FillShade = &fill
		}

		copy.Radius = func(*simulation.Segment) float64 { return radius }

		segments = append(segments, &copy)
	}

	origin := mount.LocalPosition

	if wreckageMiddle != nil {
		origin = Vec.Add(origin, *wreckageMiddle)
	}

	destroyed := mount.Module
	c.Fit(nil, mount)

	if destroyed != nil {
		c.CargoContents = slices.DeleteFunc(c.CargoContents, func(e simulation.Entity) bool { return e == destroyed })
	}

	shades := c.Shades

	if destroyed != nil && destroyed.Base().Shades != nil {
		shades = destroyed.Base().Shades
	}

	detachedMount := &simulation.Mount{Health: 1, LocalPosition: mount.LocalPosition}

	c.Spawn(origin, segments, func(s *simulation.Segment) {
		s.Health = 1
		s.Mount = detachedMount
		s.Shades = shades

		if wreckageMiddle != nil {
			s.LocalPosition = Vec.Vector{}
		}
	}, shades, origin)
}

func (c *Craft) Fracture(hulls []*simulation.Segment, destroyed, wreckage bool) []*Craft {
	center := Vec.Vector{}

	if len(hulls) > 0 {
		center = centerOf(hulls)
	}

	groups := [][]int{}

	if destroyed {
		for i := range hulls {
			groups = append(groups, []int{i})
		}
	} else {
		groups = simulation.OuterEdges(outlinesOf(hulls))
	}

	core := -1

	if !destroyed {
		for i, g := range groups {
			if slices.Contains(g, slices.Index(hulls, c.Cockpit)) {
				core = i
				break
			}
		}
	}

	fragments := []*Craft{}

	for i, g := range groups {
		if i == core {
			continue
		}

		segments := []*simulation.Segment{}

		for _, at := range g {
			segments = append(segments, hulls[at])
		}

		middle := centerOf(segments)
		simulation.OuterEdges(outlinesOf(segments))

		fragments = append(fragments, c.Spawn(middle, segments, func(s *simulation.Segment) {
			if wreckage {
				s.Health = 1
			}
		}, nil, Vec.Subtract(middle, center)))
	}

	if wreckage {
		return fragments
	}

	kept := []*simulation.Segment{}

	if core >= 0 {
		for _, at := range groups[core] {
			kept = append(kept, hulls[at])
		}
	}

	if core >= 0 && len(fragments) > 0 {
		away := simulation.RotatePoint(Vec.Subtract(centerOf(kept), center), c.Rotation)
		physics.ApplyForce(c, Vec.Scale(Vec.Normalize(away), 30), c.Random.Next()-0.5)
	}

	c.Segments = slices.DeleteFunc(c.Segments, func(s *simulation.Segment) bool {
		return !slices.Contains(kept, s) && !(s.Mount != nil && slices.Contains(kept, s.Mount.Hull))
	})

	if len(kept) > 0 {
		simulation.OuterEdges(outlinesOf(kept))
	} else {
		contents := c.CargoContents
		c.CargoContents = nil

		for _, e := range contents {
			o := e.Base()
			o.World = c.World
			o.Position = c.Position
			o.Velocity = c.Velocity
			physics.ApplyForce(o, simulation.MovePoint(Vec.Vector{}, c.Random.Next()*math.Pi*2, 30), c.Random.Next()-0.5)
			o.Add()
		}

		c.Remove()
	}

	return fragments
}

func (c *Craft) Update(dt float64) {
	c.UpdateModules(dt)
	c.GameObject.Update(dt)

	if c.DockedTo != nil && *c.DockedTo != 0 {
		if c.World != nil {
			if station, ok := c.World.Entities.Get(*c.DockedTo); ok {
				c.Position = station.Base().Position
				c.Rotation = station.Base().Rotation
			}
		}

		c.Velocity = Vec.Vector{}
		c.Spin = 0
	}

	if c.Cockpit == nil {
		return
	}

	brokenMount, brokenHull, cores := false, false, 0

	for _, s := range c.Segments {
		for _, m := range s.Mounts {
			brokenMount = brokenMount || m.Module != nil && m.Health < 1
		}

		if s.Hull {
			if s.Health < 1 {
				brokenHull = true
			} else if s.Core {
				cores++
			}
		}
	}

	if !brokenMount && cores >= 2 && !brokenHull {
		return
	}

	for _, m := range c.Mounts() {
		if m.Module != nil && m.Health < 1 {
			c.Detach(m)
		}
	}

	all, hulls, broken := []*simulation.Segment{}, []*simulation.Segment{}, []*simulation.Segment{}
	cores = 0

	for _, s := range c.Segments {
		if s.Hull {
			all = append(all, s)

			if s.Health < 1 {
				broken = append(broken, s)
			} else {
				hulls = append(hulls, s)

				if s.Core {
					cores++
				}
			}
		}
	}

	lost := cores < 2

	if lost || len(hulls) < len(all) {
		c.Fracture(broken, true, true)
		c.Fracture(hulls, lost, false)
	}
}

func (c *Craft) GeometrySource() any {
	if c.source == nil {
		return nil
	}

	return c.source
}

func (c *Craft) Hitbox() []*collision.Collider { return c.hitbox(false) }

func (c *Craft) hitbox(collidingOnly bool) []*collision.Collider {
	if c.DockedTo != nil && *c.DockedTo != 0 {
		c.source = nil
		c.colliders = nil
		return nil
	}

	changed := false
	sin, cos := math.Sincos(c.Rotation)
	colliders := c.spareColliders[:0]
	hatchOpen := c.Catalog.ModuleDefinitions["cargoHatch"].CargoGeometry.OpeningThreshold

	for _, s := range c.Segments {
		if s.Radius == nil || *s.TargetHealth() < 1 {
			continue
		}

		d := s.ModuleDefinition()
		physical := c.Physics && !d.DisablePhysics && !s.Catches && !(d.CollectsCargo && s.Active == 0 && s.ActivationProgress == 0)

		for _, m := range s.Mounts {
			if m.Module == nil || !m.Module.ModuleBase().Definition.CollectsCargo {
				continue
			}

			for _, at := range c.SegmentsAtMount(m) {
				if !(*at.TargetHealth() < 1) && at.ActivationProgress > hatchOpen {
					physical = false
					break
				}
			}
		}

		collides := physical || s.DockSegment || s.Catches && s.Active != 0 && s.ActivationProgress > hatchOpen

		if collidingOnly && !collides {
			continue
		}

		points := s.Outline()
		mx, my := 0.0, 0.0

		if s.Middle != nil {
			mx, my = s.Middle[0], s.Middle[1]
		}

		x, y := s.LocalPosition.X+mx, s.LocalPosition.Y+my
		collider := s.Collider

		if collider == nil {
			collider = &collision.Collider{Owner: c.Self, Segment: s}
			s.Collider = collider
			s.ColliderOutline = nil
		}

		position := Vec.Create(c.Position.X+(x*cos-y*sin), c.Position.Y+(x*sin+y*cos))
		radius := s.Radius(s)
		role := ""

		if s.Catches {
			role = "cargoHatch"
		}

		changed = changed || collider.LocalPosition == nil || collider.LocalPosition.X != x || collider.LocalPosition.Y != y || collider.Physics == nil || *collider.Physics != physical || collider.Role != role || collider.CollisionMargin != nil || collider.PickupPoint || collider.Radius != radius || (collider.ShapeOutline != nil) != (points != nil)

		if collider.LocalPosition == nil {
			collider.LocalPosition = &Vec.Vector{}
		}

		*collider.LocalPosition = Vec.Create(x, y)
		var outline [][]float64

		if points != nil {
			outline = collider.ShapeOutline

			if s.ColliderOutline != points || s.ColliderMiddle != (simulation.Point{mx, my}) {
				if len(outline) != len(points.Points) {
					changed = true
					outline = make([][]float64, len(points.Points))
				}

				if outline == nil {
					outline = [][]float64{}
					changed = true
				}

				for i, p := range points.Points {
					localX, localY := p[0]-mx, p[1]-my

					if len(outline[i]) != 2 {
						outline[i] = make([]float64, 2)
						changed = true
					}

					changed = changed || outline[i][0] != localX || outline[i][1] != localY
					outline[i][0], outline[i][1] = localX, localY
				}
			}
		}

		s.ColliderOutline, s.ColliderMiddle = points, simulation.Point{mx, my}
		bounce := d.Bounciness

		if s.Module != nil && s.Module.ModuleBase().Bounciness != nil {
			bounce = s.Module.ModuleBase().Bounciness(s)
		}

		value := definitions.HullBounciness

		if bounce != nil {
			value = *bounce
		}

		if collider.Bounciness == nil {
			collider.Bounciness = new(float64)
		}

		*collider.Bounciness = value
		collider.Friction = c.Friction

		if s.Module != nil {
			collider.Friction = s.Module.Base().Friction
		} else if d.Friction != nil {
			collider.Friction = *d.Friction
		}

		collider.DockSegment = s.DockSegment
		collider.Role = role
		collider.ShapeOutline = outline

		if collider.Collides == nil {
			collider.Collides = new(bool)
		}

		*collider.Collides = collides
		collider.ContactFilter = nil

		if s.Catches {
			collider.ContactFilter = modules.CargoContactAllowed
		}

		if collider.Physics == nil {
			collider.Physics = new(bool)
		}

		*collider.Physics = physical
		collider.Radius = radius
		collider.Rotation = c.Rotation
		collider.Speed = 0

		if s.ExpandingTick != nil && c.World != nil && *s.ExpandingTick == c.World.Tick {
			collider.Speed = 60
		}

		collider.Position = position

		if radius != 0 && !math.IsNaN(radius) {
			colliders = append(colliders, collider)
		}

		if d.DrillTip.Radius != 0 {
			tip := s.DrillCollider
			localX, localY := s.LocalPosition.X+d.DrillTip.Position.X, s.LocalPosition.Y+d.DrillTip.Position.Y

			if tip == nil {
				physical := false
				tip = &collision.Collider{Owner: c.Self, Segment: s, Role: "hornDrill", Physics: &physical, Friction: c.Friction}
				s.DrillCollider = tip
			}

			changed = changed || tip.LocalPosition == nil || tip.LocalPosition.X != localX || tip.LocalPosition.Y != localY || tip.Radius != d.DrillTip.Radius

			if tip.LocalPosition == nil {
				tip.LocalPosition = &Vec.Vector{}
			}

			*tip.LocalPosition = Vec.Create(localX, localY)
			tip.Position = Vec.Create(c.Position.X+(localX*cos-localY*sin), c.Position.Y+(localX*sin+localY*cos))
			tip.Radius = d.DrillTip.Radius
			tip.Rotation = c.Rotation
			tip.Friction = c.Friction

			if tip.Collides == nil {
				tip.Collides = new(bool)
			}

			*tip.Collides = collides
			colliders = append(colliders, tip)
		}
	}

	result := colliders

	for _, collider := range colliders {
		if collider.Segment.(*simulation.Segment).Covers && collider.Radius >= c.Radius {
			result = []*collision.Collider{collider}
			break
		}
	}

	if c.source == nil {
		c.source = &geometrySource{}
	}

	if changed || !slices.Equal(result, c.colliders) {
		c.source = &geometrySource{}
	}

	c.spareColliders = c.colliders
	c.colliders = result
	return result
}

func (c *Craft) HitboxColliding() []*collision.Collider { return c.hitbox(true) }

func (c *Craft) CraftBase() *Craft { return c }
