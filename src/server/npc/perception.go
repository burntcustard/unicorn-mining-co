package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type obstacle struct {
	station, asteroid  bool
	position, velocity Vec.Vector
	acceleration       Vec.Vector
	radius             float64
	spin               float64
	inverseRotation    Vec.Vector
	polygon            *obstacleGeometry
}

type obstacleSnapshot struct {
	objects  []obstacle
	geometry map[any]*obstacleGeometry
	motion   map[int64]motionObservation
}

type motionObservation struct {
	velocity, acceleration Vec.Vector
	tick                   uint64
}

/*
accelerationAt retains same-tick observations and discards stale velocity changes.
Target observations leave acceleration unset so a repeated target decision does
not reuse its previous acceleration; obstacle snapshots retain it explicitly.
*/
func (previous motionObservation) accelerationAt(ship *objects.Ship, velocity Vec.Vector) Vec.Vector {
	dt := float64(ship.World.Tick-previous.tick) * ship.Catalog.Simulation.SimulationStep

	if dt > 0 && dt <= ship.Catalog.NPCMovement.DecisionInterval*2 {
		return Vec.Scale(Vec.Subtract(velocity, previous.velocity), 1/dt)
	}

	if dt == 0 {
		return previous.acceleration
	}

	return Vec.Vector{}
}

/*
positionAt extrapolates a maneuvering ship's observed turning and braking.
*/
func (o obstacle) positionAt(seconds float64) Vec.Vector {
	speed := Vec.Length(o.velocity)

	if speed < 1 {
		return o.position
	}

	if Vec.LengthSquared(o.acceleration) == 0 {
		return Vec.AddScaled(o.position, o.velocity, seconds)
	}

	direction := Vec.Scale(o.velocity, 1/speed)
	tangent := Vec.Dot(o.acceleration, direction)
	turn := Vec.Cross(o.velocity, o.acceleration) / (speed * speed)

	if tangent < 0 {
		seconds = min(seconds, -speed/tangent)
	}

	if math.Abs(turn) < .001 {
		return Vec.AddScaled(o.position, direction, speed*seconds+tangent*seconds*seconds*.5)
	}

	sine, cosine := math.Sincos(turn * seconds)
	x := speed*sine/turn + tangent*(seconds*sine/turn+(cosine-1)/(turn*turn))
	y := speed*(1-cosine)/turn + tangent*(-seconds*cosine/turn+sine/(turn*turn))
	return Vec.Add(o.position, Vec.Add(Vec.Scale(direction, x), Vec.Scale(Vec.Create(-direction.Y, direction.X), y)))
}

/*
navigationRadius encloses the ship's physical fixtures, including polygon skin.
Decorative models, pickup contacts and the broad replication radius do not set it.
*/
func navigationRadius(ship *objects.Ship) float64 {
	return max(1, physicalRadius(ship))
}

/*
physicalRadius encloses collidable fixtures rather than decorative object bounds.
An empty physical hitbox excludes docked ships, portals and other triggers.
*/
func physicalRadius(entity simulation.Entity) float64 {
	radius := 0.0
	object := entity.Base()

	for _, collider := range entity.Hitbox() {
		if collider.Physics != nil && !*collider.Physics || collider.Collides != nil && !*collider.Collides {
			continue
		}

		center := simulation.RotatePoint(Vec.Subtract(collider.Position, object.Position), -object.Rotation)

		if collider.LocalPosition != nil {
			center = *collider.LocalPosition
		}

		if len(collider.ShapeOutline) == 0 {
			radius = max(radius, Vec.Length(center)+collider.Radius)
			continue
		}

		margin := 2 * object.World.Specification.Simulation.LinearSlop

		if collider.CollisionMargin != nil {
			margin = *collider.CollisionMargin
		}

		rotation := collider.GetRotation() - object.Rotation

		for _, point := range collider.ShapeOutline {
			local := Vec.Create(point[0], point[1])

			if rotation != 0 {
				local = simulation.RotatePoint(local, rotation)
			}

			radius = max(radius, Vec.Length(Vec.Add(center, local))+margin)
		}
	}

	return radius
}

/*
capture keeps circle bounds for every obstacle and shares immutable local asteroid
outlines. Exact geometry is inspected only after the circle rejects a query.
Only locked geometry sources are cached; mutable outlines are rebuilt on capture.
*/
func (s *obstacleSnapshot) capture(ship *objects.Ship, ignore int64) []obstacle {
	clear(s.objects)
	s.objects = s.objects[:0]

	if s.geometry == nil {
		s.geometry = make(map[any]*obstacleGeometry)
		s.motion = make(map[int64]motionObservation)
	}

	if len(s.geometry) > ship.World.Entities.Len()*2+32 {
		// Bound references retained from unloaded regions and mined parent hulls.
		clear(s.geometry)
	}

	if len(s.motion) > ship.World.Entities.Len()*2+32 {
		clear(s.motion)
	}

	ship.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		object := entity.Base()

		if object.ID == ship.ID || object.ID == ignore || object.Dead || object.Buried || object.Item && len(ship.CargoContents) < ship.CargoSpace {
			return
		}

		value := obstacle{station: object.Kind == "station", position: object.Position, velocity: object.Velocity, radius: object.Radius, spin: object.Spin}

		if asteroid, ok := entity.(*simulation.Asteroid); ok {
			if !object.Physics {
				return
			}

			value.asteroid = true
			source := asteroid.GeometrySource()
			geometry := s.geometry[source]

			if source == nil || geometry == nil {
				geometry = newObstacleGeometry(simulation.ShapeOutlineOf(asteroid).Points)

				if source != nil {
					s.geometry[source] = geometry
				}
			}

			if geometry != nil {
				value.polygon = geometry
				value.radius = max(value.radius, geometry.radius)
				sine, cosine := math.Sincos(-object.Rotation)
				value.inverseRotation = Vec.Create(cosine, sine)
			}
		} else {
			value.radius = physicalRadius(entity)

			if value.radius == 0 {
				return
			}

			if value.station {
				value.radius = max(value.radius, object.Radius)
			}
		}

		previous, observed := s.motion[object.ID]

		if observed || Vec.LengthSquared(object.Velocity) >= ship.Rules.Motion.MinimumSpeedSquared {
			if observed {
				value.acceleration = previous.accelerationAt(ship, object.Velocity)
			}

			s.motion[object.ID] = motionObservation{velocity: object.Velocity, acceleration: value.acceleration, tick: ship.World.Tick}
		}

		s.objects = append(s.objects, value)
	})

	return s.objects
}

func (o obstacle) local(point Vec.Vector) Vec.Vector {
	local := Vec.Subtract(point, o.position)

	if o.inverseRotation != (Vec.Vector{}) {
		return Vec.Create(local.X*o.inverseRotation.X-local.Y*o.inverseRotation.Y, local.X*o.inverseRotation.Y+local.Y*o.inverseRotation.X)
	}

	return local
}

/*
distance is the signed distance to the physical outline, before ship inflation.
*/
func (o obstacle) distance(point Vec.Vector) float64 {
	local := o.local(point)

	if o.polygon == nil {
		return Vec.Length(local) - o.radius
	}

	return o.polygon.distance(local)
}

/*
clearSegment checks the entire swept circle against every obstacle.
An escape can leave an existing overlap only while its clearance keeps improving.
*/
func clearSegment(from, to Vec.Vector, radius float64, obstacles []obstacle, escape bool) bool {
	left, right := min(from.X, to.X), max(from.X, to.X)
	top, bottom := min(from.Y, to.Y), max(from.Y, to.Y)
	direction := Vec.Subtract(to, from)

	for _, object := range obstacles {
		reach := object.radius + radius

		if object.position.X < left-reach || object.position.X > right+reach || object.position.Y < top-reach || object.position.Y > bottom+reach || pointSegmentDistanceSquared(object.position, from, to) >= reach*reach {
			continue
		}

		if object.polygon != nil && object.polygon.clear(object.local(from), object.local(to), radius) {
			continue
		}

		if !escape {
			return false
		}

		if object.polygon == nil {
			offset := Vec.Subtract(from, object.position)
			initial := Vec.Length(offset)

			if initial >= reach || Vec.Dot(offset, direction) < 0 || Vec.DistanceSquared(to, object.position) <= (initial+.01)*(initial+.01) {
				return false
			}

			continue
		}

		initial := object.distance(from)

		if initial >= radius {
			return false
		}

		previous := initial
		steps := max(2, int(math.Ceil(Vec.Length(direction)/max(10, radius*.25))))

		for step := 1; step <= steps; step++ {
			distance := object.distance(Vec.AddScaled(from, direction, float64(step)/float64(steps)))

			if distance < previous-.01 {
				return false
			}

			previous = distance
		}

		if previous <= initial+.01 {
			return false
		}
	}

	return true
}

func pointSegmentDistanceSquared(point, from, to Vec.Vector) float64 {
	direction := Vec.Subtract(to, from)
	length := Vec.LengthSquared(direction)

	if length == 0 {
		return Vec.DistanceSquared(point, from)
	}

	along := max(0, min(1, Vec.Dot(Vec.Subtract(point, from), direction)/length))
	return Vec.DistanceSquared(point, Vec.AddScaled(from, direction, along))
}

/*
crossesRay counts one crossing of a horizontal ray for polygon containment.
*/
func crossesRay(point, from, to Vec.Vector) bool {
	return (from.Y > point.Y) != (to.Y > point.Y) && point.X < (to.X-from.X)*(point.Y-from.Y)/(to.Y-from.Y)+from.X
}

// segmentsIntersect includes endpoint contacts and preserves the caller's parallel tolerance.
func segmentsIntersect(a, b, c, d Vec.Vector, tolerance float64) bool {
	ab, cd := Vec.Subtract(b, a), Vec.Subtract(d, c)
	denominator := Vec.Cross(ab, cd)

	if math.Abs(denominator) <= tolerance {
		return false
	}

	offset := Vec.Subtract(c, a)
	u, v := Vec.Cross(offset, cd)/denominator, Vec.Cross(offset, ab)/denominator
	return u >= 0 && u <= 1 && v >= 0 && v <= 1
}

func segmentDistanceSquared(a, b, c, d Vec.Vector) float64 {
	if segmentsIntersect(a, b, c, d, 0) {
		return 0
	}

	return min(pointSegmentDistanceSquared(a, c, d), pointSegmentDistanceSquared(b, c, d), pointSegmentDistanceSquared(c, a, b), pointSegmentDistanceSquared(d, a, b))
}

type obstacleGeometry struct {
	points              []simulation.Point
	minimum, maximum    Vec.Vector
	radius, innerRadius float64
}

/*
Cache local outline bounds once. Invalid outlines retain their circle obstacle.
The inner circle can reject blocked sweeps before any polygon edge inspection.
*/
func newObstacleGeometry(points []simulation.Point) *obstacleGeometry {
	if len(points) < 3 {
		return nil
	}

	g := &obstacleGeometry{points: points, minimum: Vec.Create(math.Inf(1), math.Inf(1)), maximum: Vec.Create(math.Inf(-1), math.Inf(-1)), innerRadius: math.Inf(1)}
	area := 0.
	previous := points[len(points)-1]

	for _, point := range points {
		area += previous[0]*point[1] - previous[1]*point[0]
		g.minimum.X = min(g.minimum.X, point[0])
		g.minimum.Y = min(g.minimum.Y, point[1])
		g.maximum.X = max(g.maximum.X, point[0])
		g.maximum.Y = max(g.maximum.Y, point[1])
		g.radius = max(g.radius, point[0]*point[0]+point[1]*point[1])
		g.innerRadius = min(g.innerRadius, pointSegmentDistanceSquared(Vec.Vector{}, Vec.Create(previous[0], previous[1]), Vec.Create(point[0], point[1])))
		previous = point
	}

	if area == 0 {
		return nil
	}

	g.radius = math.Sqrt(g.radius)

	if g.distance(Vec.Vector{}) >= 0 {
		g.innerRadius = 0
	} else {
		g.innerRadius = math.Sqrt(g.innerRadius)
	}

	return g
}

func (g *obstacleGeometry) distance(point Vec.Vector) float64 {
	nearest, inside := math.Inf(1), false
	previous := g.points[len(g.points)-1]
	from := Vec.Create(previous[0], previous[1])

	for _, vertex := range g.points {
		to := Vec.Create(vertex[0], vertex[1])
		nearest = min(nearest, pointSegmentDistanceSquared(point, from, to))

		if crossesRay(point, from, to) {
			inside = !inside
		}

		from = to
	}

	distance := math.Sqrt(nearest)

	if inside {
		return -distance
	}

	return distance
}

func (g *obstacleGeometry) clear(from, to Vec.Vector, radius float64) bool {
	if min(from.X, to.X) > g.maximum.X+radius || max(from.X, to.X) < g.minimum.X-radius || min(from.Y, to.Y) > g.maximum.Y+radius || max(from.Y, to.Y) < g.minimum.Y-radius {
		return true
	}

	if g.innerRadius > 0 && pointSegmentDistanceSquared(Vec.Vector{}, from, to) < (g.innerRadius+radius)*(g.innerRadius+radius) {
		return false
	}

	inside := false
	previous := g.points[len(g.points)-1]
	a := Vec.Create(previous[0], previous[1])

	for _, vertex := range g.points {
		b := Vec.Create(vertex[0], vertex[1])

		if segmentDistanceSquared(from, to, a, b) < radius*radius {
			return false
		}

		if crossesRay(from, a, b) {
			inside = !inside
		}

		a = b
	}

	return !inside
}

const SightRange = 1500.0

/*
CanSee detects nearby ships through cover, but requires clear sight beyond 1,000 units.
The outer limit is shared with the NPC's observer so unseen regions reveal no targets.
*/
func CanSee(ship, other *objects.Ship) bool {
	if ship == other || ship.World != other.World || other.Dead || other.DockedTo != nil || other.TransitTime != 0 || !ship.World.Entities.Has(other.ID) {
		return false
	}

	distance := Vec.DistanceSquared(ship.Position, other.Position)

	if distance <= 1000*1000 {
		return true
	}

	if distance > SightRange*SightRange {
		return false
	}

	blocked := false

	ship.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		object := entity.Base()

		if blocked || object.Dead || object.Buried || object.Kind != "asteroid" && object.Kind != "station" && object.Kind != "jumpGate" {
			return
		}

		// Test the broad circle before reading the remaining physical geometry.
		if pointSegmentDistanceSquared(object.Position, ship.Position, other.Position) > object.Radius*object.Radius {
			return
		}

		for _, collider := range entity.Hitbox() {
			segment, _ := collider.Segment.(*simulation.Segment)

			if collider.PickupPoint || collider.Physics != nil && !*collider.Physics && !(object.Kind == "station" && segment != nil && segment.Hull) {
				continue
			}

			if blocksSight(ship.Position, other.Position, collider) {
				blocked = true
				return
			}
		}
	})

	return !blocked
}

/*
blocksSight intersects the actual remaining colliders, including rotated and mined rock.
*/
func blocksSight(from, to Vec.Vector, collider *collision.Collider) bool {
	from = simulation.RotatePoint(Vec.Subtract(from, collider.GetPosition()), -collider.GetRotation())
	to = simulation.RotatePoint(Vec.Subtract(to, collider.GetPosition()), -collider.GetRotation())

	if len(collider.ShapeOutline) == 0 {
		return pointSegmentDistanceSquared(Vec.Vector{}, from, to) <= collider.GetRadius()*collider.GetRadius()
	}

	inside := false

	for index, point := range collider.ShapeOutline {
		next := collider.ShapeOutline[(index+1)%len(collider.ShapeOutline)]
		start, end := Vec.Create(point[0], point[1]), Vec.Create(next[0], next[1])

		if segmentsIntersect(from, to, start, end, 1e-9) {
			return true
		}

		if crossesRay(from, start, end) {
			inside = !inside
		}
	}

	return inside
}

/*
NearestEnemy chooses the closest visible player the controller is hostile to.
*/
func NearestEnemy(ship *objects.Ship, hostile map[int64]bool) *objects.Ship {
	var nearest *objects.Ship
	distance := math.Inf(1)

	if ship.DockedTo != nil {
		return nil
	}

	for id := range hostile {
		player, ok := ship.World.Players.Get(id)

		if !ok {
			delete(hostile, id)
			continue
		}

		entity, ok := ship.World.Entities.Get(player.ShipID)

		if !ok {
			continue
		}

		other, ok := entity.(*objects.Ship)

		if !ok {
			continue
		}

		d := Vec.DistanceSquared(ship.Position, other.Position)

		if (d < distance || d == distance && nearest != nil && other.ID < nearest.ID) && CanSee(ship, other) {
			nearest, distance = other, d
		}
	}

	return nearest
}
