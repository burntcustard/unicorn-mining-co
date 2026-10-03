// Port of src/client/collision/game-collisions.ts. This leaf package joins
// gameplay and physics; the collision primitives cannot import their users.
package gameplay

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/physics"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"os"
	"slices"
)

type BodyRecord struct {
	Object                    *simulation.GameObject
	visited                   uint64
	Body                      *physics.Body
	Entity                    simulation.Entity
	Fixtures                  []*physics.Fixture
	Geometry, RoundedGeometry []float64
	GeometrySource            any
	Velocity                  Vec.Vector
	Spin                      float64
	Previous, SweepStart      simulation.Pose
	Radius                    float64
	Deferred                  *simulation.Asteroid
	SyncPending, Ballistic    bool
}
type impactRecord struct {
	contact collision.Contact
	impact  float64
}

var limitCollisionNeighbors = os.Getenv("GO_SERVER_COLLISION_NEIGHBORS") != "unlimited"

type GameCollisions struct {
	visit          uint64
	world          *physics.World
	catalog        definitions.Catalog
	manifold       collision.WorldManifold
	bodies         *utilities.OrderedMap[int64, *BodyRecord]
	contacts       []collision.Contact
	visiting       []simulation.Entity
	motions, found []*BodyRecord
	bounds         []float64
	sortOrder      []int
	free           []bool
	impacts        *utilities.OrderedMap[*physics.Contact, impactRecord]
}

func NewGameCollisions(catalog definitions.Catalog) *GameCollisions {
	g := &GameCollisions{world: physics.NewWorld(catalog.Simulation), catalog: catalog, bodies: utilities.NewOrderedMap[int64, *BodyRecord](), impacts: utilities.NewOrderedMap[*physics.Contact, impactRecord]()}
	g.world.LimitCollisionNeighbors = limitCollisionNeighbors
	g.world.OnPreSolve(func(contact *physics.Contact) {
		a, b := contact.FixtureA.UserData.(*collision.Collider), contact.FixtureB.UserData.(*collision.Collider)
		manifold := contact.GetWorldManifold(&g.manifold)
		if manifold == nil || manifold.PointCount == 0 {
			return
		}
		point := manifold.Points[0]
		va, vb := contact.FixtureA.Body.GetLinearVelocityFromWorldPoint(point), contact.FixtureB.Body.GetLinearVelocityFromWorldPoint(point)
		physical := (a.Physics == nil || *a.Physics) && (b.Physics == nil || *b.Physics)
		surfaceSpeed, impact := 0.0, 0.0
		if physical {
			surfaceSpeed = a.Speed + b.Speed
			impact = surfaceSpeed - ((vb.X-va.X)*manifold.Normal.X + (vb.Y-va.Y)*manifold.Normal.Y)
			contact.SurfaceSpeed = surfaceSpeed
			contact.Friction = math.Sqrt(a.GetFriction() * b.GetFriction())
			contact.Restitution = 0
			if impact >= catalog.Simulation.ContactSpeedThreshold {
				ba, bb := 0.0, 0.0
				if a.Bounciness != nil {
					ba = *a.Bounciness
				}
				if b.Bounciness != nil {
					bb = *b.Bounciness
				}
				contact.Restitution = max(0, (ba+bb)/2)
			}
		}
		depth := max(0, -manifold.Separations[0])
		if manifold.PointCount > 1 {
			depth = max(depth, -manifold.Separations[1])
		}
		found := collision.Contact{Collider: a, Other: b, Depth: depth, Normal: manifold.Normal, Point: point}
		g.contacts = append(g.contacts, found)
		previous, _ := g.impacts.Get(contact)
		if physical && impact > previous.impact {
			g.impacts.Set(contact, impactRecord{found, impact})
		}
	})
	return g
}
func IsBallistic(entity simulation.Entity) bool { return entity.Base().Ballistic }
func markBallistic(record *BodyRecord) {
	if record.Ballistic {
		return
	}
	record.Ballistic = true
	record.Object.Ballistic = true
}
func inertiaPerMass(fixtures []*physics.Fixture) float64 {
	area, moment := 0.0, 0.0
	for _, f := range fixtures {
		if !f.Physics {
			continue
		}
		switch s := f.Shape.(type) {
		case *shape.CircleShape:
			r2 := s.Radius * s.Radius
			circleArea := math.Pi * r2
			p := s.Vertices[0]
			area += circleArea
			moment += circleArea * (r2/2 + p.X*p.X + p.Y*p.Y)
		case *shape.PolygonShape:
			for i, p := range s.Vertices {
				next := s.Vertices[(i+1)%len(s.Vertices)]
				cross := p.X*next.Y - next.X*p.Y
				area += cross / 2
				moment += (cross * (p.X*p.X + p.X*next.X + next.X*next.X + p.Y*p.Y + p.Y*next.Y + next.Y*next.Y)) / 12
			}
		}
	}
	if area > 0 {
		return moment / area
	}
	return 0
}
func rounded(value float64) float64 { return utilities.RoundTiesUp(value * 1e6) }
func same(a, b float64) bool        { return a == b || rounded(a) == rounded(b) }
func geometryFlags(c *collision.Collider) int {
	flags := len(c.ShapeOutline) << 4
	if c.Physics == nil || *c.Physics {
		flags |= 1
	}
	if c.CollisionMargin != nil {
		flags |= 2
	}
	if c.PickupPoint {
		flags |= 4
	}
	if c.Role == "cargoHatch" {
		flags |= 8
	}
	return flags
}
func (g *GameCollisions) CapturePoses(entities *utilities.OrderedMap[int64, simulation.Entity]) {
	entities.ForEach(func(e simulation.Entity, _ int64) {
		object := e.Base()
		if object.InactivePhysics {
			object.Ballistic = true
			return
		}
		record := g.recordFor(e)
		record.Previous = simulation.Pose{Position: object.Position, Rotation: object.Rotation}
	})
}
func (g *GameCollisions) Step(entities *utilities.OrderedMap[int64, simulation.Entity], dt float64, events *[]protocol.SimulationEvent) []collision.Contact {
	clear(g.contacts)
	g.contacts = g.contacts[:0]
	g.impacts.Clear()
	clear(g.visiting)
	g.visiting = g.visiting[:0]
	clear(g.found)
	g.found = g.found[:0]
	g.visit++
	live := 0
	park := false
	entities.ForEach(func(e simulation.Entity, _ int64) {
		object := e.Base()
		record, _ := object.CollisionState.(*BodyRecord)
		if record != nil && (record.Body.World != g.world || record.Body.Destroyed) {
			record = nil
		}
		if record != nil && record.Entity == e && record.Body.World == g.world && !record.Body.Destroyed {
			live++
			record.visited = g.visit
			park = park || object.InactivePhysics && !record.Body.Parked
		}
		if !object.InactivePhysics {
			g.visiting = append(g.visiting, e)
			g.found = append(g.found, record)
		}
	})
	visiting := g.visiting
	if park || live != g.bodies.Len() {
		g.bodies.ForEach(func(record *BodyRecord, id int64) {
			current := record.visited == g.visit || entities.Has(id)
			if current && record.Object.InactivePhysics {
				if !record.Body.Parked {
					record.Body.Park()
				}
			} else if !current {
				g.world.DestroyBody(record.Body)
				g.bodies.Delete(id)
			}
		})
	}
	clear(g.motions)
	g.motions = g.motions[:0]
	for index, e := range visiting {
		record := g.found[index]
		object := e.Base()
		if record != nil && record.Entity == e && record.Body.Parked && record.GeometrySource != nil && (object.Kind == "asteroid" || object.Kind == "station") {
			record.SyncPending = true
		} else {
			record = g.sync(e)
		}
		start := record.Previous
		if dt != 0 {
			record.Velocity = Vec.Scale(Vec.Subtract(object.Position, start.Position), 1/dt)
			record.Spin = (object.Rotation - start.Rotation) / dt
		} else {
			record.Velocity = Vec.Vector{}
			record.Spin = 0
		}
		record.SweepStart = start
		g.motions = append(g.motions, record)
	}
	free := g.findFree(g.motions)
	for i, record := range g.motions {
		body := record.Body
		if free[i] && body.ContactList == nil {
			if !body.Parked {
				body.Park()
			}
			markBallistic(record)
			continue
		}
		if record.SyncPending {
			record.SyncPending = false
			g.sync(record.Entity)
		}
		if record.Deferred != nil {
			g.syncDetailed(record.Deferred, record, record.GeometrySource)
			record.Deferred = nil
		}
		body.SetTransform(record.SweepStart.Position, record.SweepStart.Rotation)
		body.LinearVelocity = record.Velocity
		body.AngularVelocity = record.Spin
		if body.Parked {
			body.Unpark()
		}
	}
	rules := &g.catalog.Simulation
	g.world.Step(dt, rules.Physics.VelocityIterations, rules.Physics.PositionIterations)
	for _, record := range g.motions {
		if !record.Body.Parked {
			markBallistic(record)
		}
	}
	for _, contact := range g.contacts {
		g.touched(contact.Collider.Owner.(simulation.Entity))
		g.touched(contact.Other.Owner.(simulation.Entity))
	}
	for _, record := range g.motions {
		body, object, velocity, spin, start := record.Body, record.Object, record.Velocity, record.Spin, record.SweepStart
		if body.Parked {
			angle := start.Rotation
			if angle > math.Pi {
				angle -= 2 * math.Pi
			} else if angle < -math.Pi {
				angle += 2 * math.Pi
			}
			if !(math.Abs(angle) <= math.Pi) {
				angle = math.Atan2(math.Sincos(angle))
			}
			if dt > 0 {
				vx, vy, w := velocity.X, velocity.Y, spin
				tx, ty := vx*dt, vy*dt
				translation := tx*tx + ty*ty
				if translation > rules.Physics.MaxTranslation*rules.Physics.MaxTranslation {
					ratio := rules.Physics.MaxTranslation / math.Sqrt(translation)
					vx *= ratio
					vy *= ratio
				}
				rotation := dt * w
				if rotation*rotation > rules.Physics.MaxRotation*rules.Physics.MaxRotation {
					w *= rules.Physics.MaxRotation / math.Abs(rotation)
				}
				object.Position = Vec.Create(start.Position.X+vx*dt, start.Position.Y+vy*dt)
				angle += dt * w
				object.Velocity.X += vx - velocity.X
				object.Velocity.Y += vy - velocity.Y
				object.Spin += w - spin
			} else {
				object.Position = start.Position
			}
			object.Rotation = angle
			continue
		}
		object.Position = body.GetPosition()
		object.Rotation = body.GetAngle()
		object.Velocity.X += body.LinearVelocity.X - velocity.X
		object.Velocity.Y += body.LinearVelocity.Y - velocity.Y
		object.Spin += body.AngularVelocity - spin
	}
	g.impacts.ForEach(func(value impactRecord, _ *physics.Contact) {
		a, b, point, impact := value.contact.Collider, value.contact.Other, value.contact.Point, value.impact
		ao, bo := a.Owner.(simulation.Entity).Base(), b.Owner.(simulation.Entity).Base()
		inverseMass := 1/ao.Mass + 1/bo.Mass
		amount := max(0, utilities.RoundTiesUp((impact/inverseMass-rules.Physics.DamageBase)/rules.Physics.DamageScale))
		if amount != 0 {
			for _, pair := range [][2]*collision.Collider{{a, b}, {b, a}} {
				hit, by := pair[0], pair[1]
				owner := hit.Owner.(simulation.Entity)
				if owner.Base().Dead {
					continue
				}
				var part any = owner
				if s, ok := hit.AsteroidSegment.(*simulation.AsteroidSegment); ok && s != nil {
					part = s
				}
				if s, ok := hit.Segment.(*simulation.Segment); ok && s != nil {
					part = s
				}
				objects.Damage(part, amount)
				if asteroid, ok := owner.(*simulation.Asteroid); ok && asteroid.World != nil {
					segment, _ := hit.AsteroidSegment.(*simulation.AsteroidSegment)
					player := int64(0)
					if id := by.Owner.(simulation.Entity).Base().PlayerID; id != nil {
						player = *id
					}
					asteroid.Fracture(segment, player, events, asteroid.World)
				}
			}
		}
		*events = append(*events, protocol.CollisionEvent{A: ao.ID, B: bo.ID, Impact: impact, Colors: [2]string{collision.OutlineColorOf(a, g.catalog.Colors), collision.OutlineColorOf(b, g.catalog.Colors)}, Position: point})
	})
	return g.contacts
}
func (g *GameCollisions) findFree(motions []*BodyRecord) []bool {
	count := len(motions)
	if len(g.free) < count {
		g.free = make([]bool, count*2)
		g.bounds = make([]float64, count*8)
	}
	reuse := len(g.sortOrder) == count
	if !reuse {
		g.sortOrder = make([]int, count)
	}
	bounds, free, order := g.bounds, g.free, g.sortOrder
	for i, r := range motions {
		p, start := r.Object.Position, r.SweepStart.Position
		dx, dy := p.X-start.X, p.Y-start.Y
		travel := math.Sqrt(dx*dx + dy*dy)
		reach := r.Radius + travel + g.catalog.Simulation.Physics.WakeMargin
		x := start.X + dx/2
		bounds[i*4], bounds[i*4+1], bounds[i*4+2], bounds[i*4+3] = x-reach, x, start.Y+dy/2, reach
		free[i] = true
		if !reuse {
			order[i] = i
		}
	}
	if reuse {
		for i := 1; i < count; i++ {
			item := order[i]
			key := bounds[item*4]
			j := i - 1
			for j >= 0 && bounds[order[j]*4] > key {
				order[j+1] = order[j]
				j--
			}
			order[j+1] = item
		}
	} else {
		slices.SortFunc(order, func(a, b int) int {
			if bounds[a*4] < bounds[b*4] {
				return -1
			}
			if bounds[a*4] > bounds[b*4] {
				return 1
			}
			return 0
		})
	}
	for i := range count {
		a := order[i] * 4
		right := bounds[a+1] + bounds[a+3]
		for j := i + 1; j < count; j++ {
			b := order[j] * 4
			if bounds[b] > right {
				break
			}
			if !free[order[i]] && !free[order[j]] {
				continue
			}
			dx, dy := bounds[a+1]-bounds[b+1], bounds[a+2]-bounds[b+2]
			reach := bounds[a+3] + bounds[b+3]
			if dx*dx+dy*dy <= reach*reach {
				free[order[i]], free[order[j]] = false, false
			}
		}
	}
	return free
}
func (g *GameCollisions) touched(owner simulation.Entity) {
	record, _ := owner.Base().CollisionState.(*BodyRecord)
	if record != nil && record.Entity == owner {
		record.Ballistic = false
	}
	owner.Base().Ballistic = false
}
func (g *GameCollisions) recordFor(entity simulation.Entity) *BodyRecord {
	object := entity.Base()
	id := object.ID
	record, _ := object.CollisionState.(*BodyRecord)
	if record != nil && (record.Body.World != g.world || record.Body.Destroyed) {
		record = nil
	}
	if record != nil && record.Entity != entity {
		g.world.DestroyBody(record.Body)
		g.bodies.Delete(id)
		record = nil
	}
	if record == nil {
		record = &BodyRecord{Entity: entity, Object: object, Body: g.world.CreateBody(), Previous: simulation.Pose{Position: object.Position, Rotation: object.Rotation}}
		g.bodies.Set(id, record)
		object.CollisionState = record
	}
	return record
}
func geometryAt(values []float64, index int) float64 {
	if index >= len(values) {
		return math.NaN()
	}
	return values[index]
}
func (g *GameCollisions) sync(entity simulation.Entity) *BodyRecord {
	r := g.recordFor(entity)
	o := entity.Base()
	if asteroid, ok := entity.(*simulation.Asteroid); ok {
		source := asteroid.GeometrySource()
		if source != nil && source == r.GeometrySource && (r.Deferred != nil || same(o.Mass, geometryAt(r.Geometry, 0)) && same(o.AngularInertiaScale, geometryAt(r.Geometry, 1))) {
			return r
		}
		if source != nil && len(r.Fixtures) == 0 {
			r.Radius = asteroid.Extent() + 2*g.catalog.Simulation.LinearSlop
			r.GeometrySource = source
			r.Deferred = asteroid
			return r
		}
		r.Deferred = nil
		return g.syncDetailed(entity, r, source)
	}
	return g.syncDetailed(entity, r, nil)
}
func geometrySlices(values []float64) []int {
	starts := []int{}
	for at := 2; at < len(values); {
		starts = append(starts, at)
		length := (int(values[at]) >> 4) * 2
		if length == 0 {
			length = 3
		}
		at += 2 + length
	}
	return starts
}
func (g *GameCollisions) syncDetailed(entity simulation.Entity, record *BodyRecord, source any) *BodyRecord {
	var hitbox []*collision.Collider
	object := entity.Base()
	if c, ok := entity.(interface{ CraftBase() *objects.Craft }); ok {
		hitbox = c.CraftBase().HitboxColliding()
		source = c.CraftBase().GeometrySource()
		if source != nil && source == record.GeometrySource && same(object.Mass, geometryAt(record.Geometry, 0)) && same(object.AngularInertiaScale, geometryAt(record.Geometry, 1)) {
			return record
		}
	} else {
		hitbox = entity.Hitbox()
	}
	colliders := []*collision.Collider{}
	for _, c := range hitbox {
		if c.Collides != nil && !*c.Collides {
			continue
		}
		if c.ShapeOutline != nil {
			area := 0.0
			for i, p := range c.ShapeOutline {
				next := c.ShapeOutline[(i+1)%len(c.ShapeOutline)]
				area = area + p[0]*next[1] - next[0]*p[1]
			}
			if !(math.Abs(area) > 0.1) {
				continue
			}
		}
		colliders = append(colliders, c)
	}
	previous, quantized := record.Geometry, record.RoundedGeometry
	matches := func(value float64, index int) bool {
		return value == geometryAt(previous, index) || rounded(value) == geometryAt(quantized, index)
	}
	cursor := 2
	inverseSin, inverseCos := math.Sincos(-object.Rotation)
	unchanged := matches(object.Mass, 0) && matches(object.AngularInertiaScale, 1)
	if unchanged {
		for _, c := range colliders {
			position := c.GetPosition()
			dx, dy := position.X-object.Position.X, position.Y-object.Position.Y
			x, y := dx*inverseCos-dy*inverseSin, dx*inverseSin+dy*inverseCos
			angle := c.GetRotation() - object.Rotation
			sin, cos := math.Sincos(angle)
			start := cursor
			outline := c.ShapeOutline
			if outline != nil {
				cursor += 2 + len(outline)*2
			} else {
				cursor += 5
			}
			margin := 0.0
			if c.CollisionMargin != nil {
				margin = *c.CollisionMargin
			}
			if geometryAt(previous, start) != float64(geometryFlags(c)) || !matches(margin, start+1) {
				unchanged = false
				break
			}
			if outline != nil {
				for i, p := range outline {
					if !matches(x+(p[0]*cos-p[1]*sin), start+2+i*2) || !matches(y+(p[0]*sin+p[1]*cos), start+3+i*2) {
						unchanged = false
						break
					}
				}
			} else {
				unchanged = matches(x, start+2) && matches(y, start+3) && matches(c.GetRadius(), start+4)
			}
			if !unchanged {
				break
			}
		}
	}
	if unchanged && cursor == len(previous) {
		for i, f := range record.Fixtures {
			f.UserData = colliders[i]
		}
		record.GeometrySource = nil
		if len(hitbox) == len(record.Fixtures) {
			record.GeometrySource = source
		}
		return record
	}
	geometry := []float64{object.Mass, object.AngularInertiaScale}
	for _, c := range colliders {
		offset := simulation.RotatePoint(Vec.Subtract(c.GetPosition(), object.Position), -object.Rotation)
		angle := c.GetRotation() - object.Rotation
		sin, cos := math.Sincos(angle)
		margin := 0.0
		if c.CollisionMargin != nil {
			margin = *c.CollisionMargin
		}
		geometry = append(geometry, float64(geometryFlags(c)), margin)
		if c.ShapeOutline != nil {
			for _, p := range c.ShapeOutline {
				geometry = append(geometry, offset.X+(p[0]*cos-p[1]*sin), offset.Y+(p[0]*sin+p[1]*cos))
			}
		} else {
			geometry = append(geometry, offset.X, offset.Y, c.GetRadius())
		}
	}
	oldStarts := []int{}
	if len(previous) > 2 && matches(geometry[0], 0) && matches(geometry[1], 1) {
		oldStarts = geometrySlices(previous)
	}
	newStarts := geometrySlices(geometry)
	kept := make([]*physics.Fixture, len(colliders))
	for i := range colliders {
		if i >= len(record.Fixtures) || i >= len(oldStarts) || len(oldStarts) != len(record.Fixtures) {
			continue
		}
		from, to := oldStarts[i], newStarts[i]
		end := len(geometry)
		if i+1 < len(newStarts) {
			end = newStarts[i+1]
		}
		oldEnd := len(previous)
		if i+1 < len(oldStarts) {
			oldEnd = oldStarts[i+1]
		}
		length := end - to
		if oldEnd-from != length {
			continue
		}
		equal := true
		for offset := range length {
			if !matches(geometry[to+offset], from+offset) {
				equal = false
				break
			}
		}
		if equal {
			kept[i] = record.Fixtures[i]
		}
	}
	for i, f := range record.Fixtures {
		if i >= len(kept) || kept[i] != f {
			record.Body.DestroyFixture(f)
		}
	}
	fixtures := make([]*physics.Fixture, len(colliders))
	for i, c := range colliders {
		if kept[i] != nil {
			kept[i].UserData = c
			fixtures[i] = kept[i]
			continue
		}
		cursor := newStarts[i] + 2
		point := func() Vec.Vector { p := Vec.Create(geometry[cursor], geometry[cursor+1]); cursor += 2; return p }
		var s shape.Shape
		if c.ShapeOutline != nil {
			vertices := make([]Vec.Vector, len(c.ShapeOutline))
			for at := range vertices {
				vertices[at] = point()
			}
			s = shape.NewPolygon(vertices, c.CollisionMargin, g.catalog.Simulation.LinearSlop)
		} else {
			p := point()
			s = shape.NewCircle(p, geometry[cursor])
		}
		physical := c.Physics == nil || *c.Physics
		fixtures[i] = record.Body.CreateFixture(s, physics.FixtureOpt{Physics: &physical, UserData: c})
	}
	record.Fixtures = fixtures
	record.Geometry = geometry
	record.RoundedGeometry = make([]float64, len(geometry))
	for i, v := range geometry {
		record.RoundedGeometry[i] = rounded(v)
	}
	record.Radius = 0
	for _, f := range fixtures {
		extent := 0.0
		switch s := f.Shape.(type) {
		case *shape.PolygonShape:
			extent = math.Inf(-1)
			for _, v := range s.Vertices {
				extent = max(extent, Vec.Length(v))
			}
		case *shape.CircleShape:
			extent = Vec.Length(s.Vertices[0])
		}
		record.Radius = max(record.Radius, f.Shape.Base().Radius+extent)
	}
	record.Body.SetProxyRadius(record.Radius)
	record.Body.SetMass(object.Mass, object.Mass*object.AngularInertiaScale*inertiaPerMass(fixtures))
	record.GeometrySource = nil
	if len(hitbox) == len(fixtures) {
		record.GeometrySource = source
	}
	return record
}
