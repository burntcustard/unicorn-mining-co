package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type obstacle struct {
	station            bool
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
	radius := 0.0

	for _, collider := range ship.HitboxColliding() {
		if collider.Physics != nil && !*collider.Physics {
			continue
		}

		center := *collider.LocalPosition

		if len(collider.ShapeOutline) == 0 {
			radius = max(radius, Vec.Length(center)+collider.Radius)
			continue
		}

		margin := 2 * ship.Catalog.Simulation.LinearSlop

		if collider.CollisionMargin != nil {
			margin = *collider.CollisionMargin
		}

		for _, point := range collider.ShapeOutline {
			radius = max(radius, Vec.Length(Vec.Add(center, Vec.Create(point[0], point[1])))+margin)
		}
	}

	return max(1, radius)
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
	}

	if len(s.geometry) > ship.World.Entities.Len()*2+32 {
		// Bound references retained from unloaded regions and mined parent hulls.
		clear(s.geometry)
	}

	ship.World.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		object := entity.Base()

		if object.ID == ship.ID || object.ID == ignore || object.Dead || object.Buried || object.Kind != "asteroid" && object.Kind != "station" && object.Kind != "jumpGate" && !(object.Kind == "item" && len(ship.CargoContents) >= ship.CargoSpace) {
			return
		}

		value := obstacle{station: object.Kind == "station", position: object.Position, velocity: object.Velocity, radius: object.Radius, spin: object.Spin}

		if asteroid, ok := entity.(*simulation.Asteroid); ok {
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

func segmentDistanceSquared(a, b, c, d Vec.Vector) float64 {
	ab, cd := Vec.Subtract(b, a), Vec.Subtract(d, c)
	denominator := Vec.Cross(ab, cd)

	if denominator != 0 {
		offset := Vec.Subtract(c, a)
		u, v := Vec.Cross(offset, cd)/denominator, Vec.Cross(offset, ab)/denominator

		if u >= 0 && u <= 1 && v >= 0 && v <= 1 {
			return 0
		}
	}

	return min(pointSegmentDistanceSquared(a, c, d), pointSegmentDistanceSquared(b, c, d), pointSegmentDistanceSquared(c, a, b), pointSegmentDistanceSquared(d, a, b))
}
