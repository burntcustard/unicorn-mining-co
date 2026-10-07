// Port of src/client/objects/asteroid.ts.
package simulation

import (
	"math"
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/random"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type AsteroidSegment struct {
	Contents     []int         `json:"contents"`
	Health       float64       `json:"health"`
	Mass         float64       `json:"mass"`
	MaxHealth    float64       `json:"maxHealth"`
	ShapeOutline *ShapeOutline `json:"shapeOutline"`
}

type Asteroid struct {
	specWorld *World
	*GameObject
	Contents               []int
	MaxHealth              float64
	segmentList            []*AsteroidSegment
	uncutContents          []int
	uncutHealth, uncutMass float64
	uncutLocked            bool
	lockedOutline          *ShapeOutline
	lockedSegmentList      []*AsteroidSegment
	geometrySource         *asteroidGeometry
	cachedSource           *asteroidGeometry
	cachedColliders        []*collision.Collider
	cachedSegments         []*AsteroidSegment
	collisionOutline       *ShapeOutline
	collisionOutlineSource *ShapeOutline
}

type asteroidShapeKey struct {
	id           int64
	count        int
	radius, even float64
	hasEven      bool
}

type asteroidGeometry struct{ identity byte }

type AsteroidProperties struct {
	ObjectProperties
	Contents   []int
	MaxHealth  *float64
	PointCount int
	RadiusEven *float64
	Segments   []*AsteroidSegment
}

func PointCountFor(radius, scale float64) int {
	return int(utilities.RoundTiesUp(math.Sqrt(radius)*scale))*2 - 1
}

func roundPoint(p Point) Point { return Point{utilities.Round(p[0]), utilities.Round(p[1])} }

func withoutCollinearPoints(points []Point) []Point {
	out := make([]Point, 0, len(points))

	for i, p := range points {
		before, next := points[(i+len(points)-1)%len(points)], points[(i+1)%len(points)]

		if (p[0]-before[0])*(next[1]-p[1]) != (p[1]-before[1])*(next[0]-p[0]) {
			out = append(out, p)
		}
	}

	return out
}

func ShapeOutlineOf(asteroid *Asteroid) *ShapeOutline {
	if asteroid.ShapeOutline != nil {
		return asteroid.ShapeOutline
	}

	key := asteroidShapeKey{id: asteroid.ID, count: asteroid.PointCount, radius: asteroid.Radius}

	if asteroid.RadiusEven != nil {
		key.even = *asteroid.RadiusEven
		key.hasEven = true
	}

	cache := asteroid.specWorld.shapeOutlines

	if cache == nil {
		cache = make(map[asteroidShapeKey]*ShapeOutline)
		asteroid.specWorld.shapeOutlines = cache
	}

	outline := cache[key]

	if outline == nil {
		rules := asteroid.specWorld.Specification.RegionGeneration
		count := asteroid.PointCount

		if count == 0 {
			count = PointCountFor(asteroid.Radius, rules.AsteroidPointCountScale)
		}

		outline = CreatePolygon(PolygonOptions{PointCount: count, Radius: asteroid.Radius, RadiusEven: asteroid.RadiusEven, Random: random.CreateRandom(float64(asteroid.ID)).Next, Variance: rules.AsteroidVariance})

		for i, p := range outline.Points {
			outline.Points[i] = roundPoint(p)
		}

		if len(cache) > 5000 {
			clear(cache)
		}

		cache[key] = outline
	}

	return &ShapeOutline{Points: withoutCollinearPoints(outline.Points)}
}

func splitTriangle(triangle []Point) [][]Point {
	center, from, to := triangle[0], triangle[1], triangle[2]

	between := func(a, b Point) Point { return Point{(a[0] + b[0]) / 2, (a[1] + b[1]) / 2} }

	left, outer, right := between(center, from), between(from, to), between(to, center)
	return [][]Point{{center, left, right}, {left, from, outer}, {left, outer, right}, {outer, to, right}}
}

func segmentsOf(contents []int, health, mass float64, outline *ShapeOutline, radiusEven *float64, next func() float64) []*AsteroidSegment {
	var triangles [][]Point
	inset := radiusEven != nil && *radiusEven != 0

	if inset {
		points := []Point{}

		for i, p := range outline.Points {
			if i%2 == 0 {
				points = append(points, p)
			}
		}

		triangles = append(triangles, points)

		for i, p := range points {
			triangles = append(triangles, []Point{p, outline.Points[i*2+1], points[(i+1)%len(points)]})
		}
	} else if len(outline.Points) > 3 {
		for i, p := range outline.Points {
			triangles = append(triangles, []Point{{0, 0}, p, outline.Points[(i+1)%len(outline.Points)]})
		}
	} else {
		triangles = [][]Point{outline.Points}
	}

	segmentsPerFace := 4

	if inset {
		segmentsPerFace = 1
	}

	leaves := make([][][]Point, len(triangles))

	for i, triangle := range triangles {
		if inset {
			leaves[i] = [][]Point{triangle}
		} else {
			leaves[i] = splitTriangle(triangle)
		}
	}

	segmentHealth := health * 2 / float64(len(triangles)*segmentsPerFace)
	segmentMass := mass / float64(len(triangles)*segmentsPerFace)
	segments := make([]*AsteroidSegment, 0, len(triangles)*segmentsPerFace)

	for corner := 0; corner < segmentsPerFace; corner++ {
		for _, leaf := range leaves {
			points := make([]Point, len(leaf[corner]))

			for i, p := range leaf[corner] {
				points[i] = roundPoint(p)
			}

			segments = append(segments, &AsteroidSegment{Contents: []int{}, Health: segmentHealth, Mass: segmentMass, MaxHealth: segmentHealth, ShapeOutline: &ShapeOutline{Points: points}})
		}
	}

	empty := slices.Clone(segments)

	for _, resource := range contents {
		value := next()
		index := int(math.Floor(value * value * float64(len(empty))))
		target := segments[0]

		if len(empty) > 0 {
			target = empty[index]
			empty = slices.Delete(empty, index, index+1)
		}

		target.Contents = append(target.Contents, resource)
	}

	return segments
}

func groupsOf(segments []*AsteroidSegment) [][]*AsteroidSegment {
	outlines := make([]*ShapeOutline, len(segments))

	for i, segment := range segments {
		outlines[i] = segment.ShapeOutline
	}

	indices := OuterEdges(outlines)
	groups := make([][]*AsteroidSegment, len(indices))

	for i, group := range indices {
		for _, index := range group {
			groups[i] = append(groups[i], segments[index])
		}
	}

	return groups
}

func shapeOutlinesFromMarked(segments []*AsteroidSegment) []*ShapeOutline {
	type edge struct{ from, to Point }

	outer := []edge{}

	for _, segment := range segments {
		outline := segment.ShapeOutline

		for i, from := range outline.Points {
			if len(outline.Edges) > i && outline.Edges[i] {
				outer = append(outer, edge{from, outline.Points[(i+1)%len(outline.Points)]})
			}
		}
	}

	outlines := []*ShapeOutline{}

	for len(outer) > 0 {
		first := outer[0]
		outer = outer[1:]
		points := []Point{first.from}
		current := first

		for current.to != first.from {
			at := current.to
			reverse := math.Atan2(current.from[1]-at[1], current.from[0]-at[0])
			nextIndex := -1
			smallestTurn := math.Inf(1)

			for index, candidate := range outer {
				if candidate.from != at {
					continue
				}

				direction := math.Atan2(candidate.to[1]-at[1], candidate.to[0]-at[0])
				clockwise := math.Mod(reverse-direction+math.Pi*2, math.Pi*2)

				if clockwise < smallestTurn {
					smallestTurn = clockwise
					nextIndex = index
				}
			}

			if nextIndex < 0 {
				break
			}

			points = append(points, at)
			current = outer[nextIndex]
			outer = slices.Delete(outer, nextIndex, nextIndex+1)
		}

		outlines = append(outlines, &ShapeOutline{Points: withoutCollinearPoints(points)})
	}

	return outlines
}

func ShapeOutlinesFrom(segments []*AsteroidSegment) []*ShapeOutline {
	outlines := make([]*ShapeOutline, len(segments))

	for i, s := range segments {
		outlines[i] = s.ShapeOutline
	}

	OuterEdges(outlines)
	return shapeOutlinesFromMarked(segments)
}

func CenterOf(outline *ShapeOutline) Vec.Vector {
	area, x, y := 0.0, 0.0, 0.0

	for i, p := range outline.Points {
		next := outline.Points[(i+1)%len(outline.Points)]
		cross := p[0]*next[1] - next[0]*p[1]
		area += cross
		x += (p[0] + next[0]) * cross
		y += (p[1] + next[1]) * cross
	}

	return Vec.Create(x/(area*3), y/(area*3))
}

func cloneOutline(outline *ShapeOutline) *ShapeOutline {
	if outline == nil {
		return nil
	}

	return &ShapeOutline{Points: slices.Clone(outline.Points)}
}

func NewAsteroid(props AsteroidProperties, world *World) *Asteroid {
	object := NewGameObject(props.ObjectProperties, world.Specification.Simulation)
	object.Friction = 0.2
	object.AngularDrag = 0
	object.ApplyProperties(props.ObjectProperties)
	object.Kind = "asteroid"
	// createAsteroid's factory does not attach its world until addEntity. Keep
	// the spec context separately from gameplay membership.
	asteroid := &Asteroid{GameObject: object, Contents: append([]int{}, props.Contents...), MaxHealth: object.Health}
	asteroid.specWorld = world
	object.Self = asteroid

	if props.MaxHealth != nil {
		asteroid.MaxHealth = *props.MaxHealth
	}

	object.ShapeOutline = cloneOutline(props.ShapeOutline)
	object.PointCount, object.RadiusEven = props.PointCount, props.RadiusEven

	if props.Segments != nil {
		asteroid.segmentList = make([]*AsteroidSegment, len(props.Segments))

		for i, s := range props.Segments {
			copy := *s
			copy.Contents = append([]int{}, s.Contents...)
			copy.ShapeOutline = cloneOutline(s.ShapeOutline)
			asteroid.segmentList[i] = &copy
		}
	}

	if props.ShapeOutline == nil && props.Segments == nil {
		asteroid.uncutContents = append([]int{}, props.Contents...)
		asteroid.uncutHealth, asteroid.uncutMass = object.Health, object.Mass
	}

	return asteroid
}

func (a *Asteroid) Segments() []*AsteroidSegment {
	if a.uncutContents != nil {
		contents, locked, source := a.uncutContents, a.uncutLocked, a.geometrySource
		a.uncutContents = nil
		a.uncutLocked = false
		a.segmentList = segmentsOf(contents, a.uncutHealth, a.uncutMass, ShapeOutlineOf(a), a.RadiusEven, random.CreateRandom(float64(a.ID+1)).Next)

		if locked {
			a.LockGeometry()
			a.geometrySource = source
		}
	}

	return a.segmentList
}

func (a *Asteroid) SetSegments(segments []*AsteroidSegment) {
	a.uncutContents = nil
	a.uncutLocked = false

	if len(a.segmentList) != len(segments) || (len(segments) > 0 && &a.segmentList[0] != &segments[0]) {
		a.lockedSegmentList = nil
		a.geometrySource = nil
	}

	a.segmentList = segments
}

func (a *Asteroid) Damaged() bool {
	if a.uncutContents != nil {
		return false
	}

	for _, s := range a.segmentList {
		if s.Health != s.MaxHealth {
			return true
		}
	}

	return false
}

func (a *Asteroid) Extent() float64 {
	extent := 0.0

	measure := func(points []Point) {
		for _, p := range points {
			extent = max(extent, math.Sqrt(p[0]*p[0]+p[1]*p[1]))
		}
	}

	if a.uncutContents != nil {
		measure(ShapeOutlineOf(a).Points)
	} else {
		for _, c := range a.Hitbox() {
			for _, p := range c.ShapeOutline {
				extent = max(extent, math.Sqrt(p[0]*p[0]+p[1]*p[1]))
			}
		}
	}

	return extent
}

func (a *Asteroid) LockGeometry() *Asteroid {
	if a.uncutContents != nil {
		a.uncutLocked = true

		if a.geometrySource == nil {
			a.geometrySource = &asteroidGeometry{}
		}

		return a
	}

	lock := func(outline *ShapeOutline) {
		if outline.Edges == nil {
			outline.Edges = make([]bool, len(outline.Points))

			for i := range outline.Edges {
				outline.Edges[i] = true
			}
		}
	}

	if a.ShapeOutline != nil {
		lock(a.ShapeOutline)
		a.lockedOutline = a.ShapeOutline
	}

	for _, s := range a.Segments() {
		lock(s.ShapeOutline)
	}

	if a.segmentList != nil {
		a.lockedSegmentList = slices.Clone(a.segmentList)
	}

	a.geometrySource = &asteroidGeometry{}
	return a
}

func (a *Asteroid) GeometrySource() any {
	if a.uncutContents != nil {
		if a.uncutLocked {
			return a.geometrySource
		}

		return nil
	}

	if len(a.segmentList) > 0 {
		if slices.Equal(a.segmentList, a.lockedSegmentList) {
			return a.geometrySource
		}

		return nil
	}

	if a.ShapeOutline != nil && a.ShapeOutline == a.lockedOutline {
		return a.geometrySource
	}

	return nil
}

func (a *Asteroid) Hitbox() []*collision.Collider {
	segments := a.Segments()
	source, _ := a.GeometrySource().(*asteroidGeometry)

	if source != nil && source == a.cachedSource {
		return a.cachedColliders
	}

	if len(segments) > 0 {
		colliders := make([]*collision.Collider, len(segments))

		for i, segment := range segments {
			if i < len(a.cachedSegments) && a.cachedSegments[i] == segment {
				colliders[i] = a.cachedColliders[i]
			} else {
				colliders[i] = a.collider(segment.ShapeOutline, segment)
			}
		}

		a.cachedSource, a.cachedColliders, a.cachedSegments = source, colliders, slices.Clone(segments)
		return colliders
	}

	outline := ShapeOutlineOf(a)
	collisionOutline := a.collisionOutline

	if a.collisionOutlineSource != outline || collisionOutline == nil {
		center := CenterOf(outline)
		collisionOutline = &ShapeOutline{Points: make([]Point, len(outline.Points))}

		for i, p := range outline.Points {
			offset := Vec.Subtract(Vec.Create(p[0], p[1]), center)
			length := Vec.Length(offset)

			if length == 0 {
				length = 1
			}

			point := Vec.AddScaled(center, offset, max(0.5, 1-0.1/length))
			collisionOutline.Points[i] = Point{point.X, point.Y}
		}

		if outline == a.lockedOutline {
			a.collisionOutlineSource, a.collisionOutline = outline, collisionOutline
		}
	}

	colliders := []*collision.Collider{a.collider(collisionOutline, nil)}

	if source != nil {
		a.cachedSource, a.cachedColliders, a.cachedSegments = source, colliders, nil
	}

	return colliders
}

func (a *Asteroid) collider(outline *ShapeOutline, segment *AsteroidSegment) *collision.Collider {
	bounciness, margin := 0.2, 0.0
	points := make([][]float64, len(outline.Points))

	for i, p := range outline.Points {
		points[i] = []float64{p[0], p[1]}
	}

	return &collision.Collider{Owner: a, AsteroidSegment: segment, Position: a.Position, Rotation: a.Rotation, Friction: a.Friction, Radius: a.Radius, Bounciness: &bounciness, CollisionMargin: &margin, ShapeOutline: points, ReadPose: func() (Vec.Vector, float64, float64, float64) { return a.Position, a.Rotation, a.Friction, a.Radius }}
}

func (a *Asteroid) Detach(segment *AsteroidSegment, world *World) []*Asteroid {
	remaining := []*AsteroidSegment{}
	groups := [][]*AsteroidSegment{{segment}}

	for _, candidate := range a.Segments() {
		if candidate != segment {
			if candidate.Health < 1 {
				groups = append(groups, []*AsteroidSegment{candidate})
			} else {
				remaining = append(remaining, candidate)
			}
		}
	}

	groups = append(groups, groupsOf(remaining)...)
	a.Remove()
	children := make([]*Asteroid, len(groups))

	for index, group := range groups {
		outline := group[0].ShapeOutline

		if len(group) > 1 {
			outlines := shapeOutlinesFromMarked(group)
			outline = outlines[0]

			for _, candidate := range outlines[1:] {
				if RadiusOf(candidate.Points, Point{}) > RadiusOf(outline.Points, Point{}) {
					outline = candidate
				}
			}
		}

		center := CenterOf(outline)
		offset := RotatePoint(center, a.Rotation)

		local := func(outline *ShapeOutline) *ShapeOutline {
			out := &ShapeOutline{Points: make([]Point, len(outline.Points))}

			for i, p := range outline.Points {
				out.Points[i] = roundPoint(Point{p[0] - center.X, p[1] - center.Y})
			}

			return out
		}

		childOutline := local(outline)
		childSegments := make([]*AsteroidSegment, len(group))
		contents := []int{}
		mass := 0.0

		for i, s := range group {
			copy := *s
			copy.Contents = append([]int{}, s.Contents...)
			copy.ShapeOutline = local(s.ShapeOutline)
			childSegments[i] = &copy
			contents = append(contents, s.Contents...)
			mass += s.Mass
		}

		radius := RadiusOf(childOutline.Points, Point{})
		props := AsteroidProperties{Health: &radius, Mass: &mass, ShapeOutline: childOutline, Position: Vec.Add(a.Position, offset), Radius: &radius, Rotation: a.Rotation, Spin: a.Spin, Velocity: Vec.AddScaled(a.Velocity, Vec.Create(-offset.Y, offset.X), a.Spin), Contents: contents, MaxHealth: &radius}

		if a.HasResource {
			props.Resource = &a.Resource
		}

		if len(group) == 1 && len(contents) == 0 {
			decay := 6.0
			props.Decay = &decay
		}

		if len(group) > 1 {
			props.Segments = childSegments
		}

		child := CreateAsteroid(world, props).LockGeometry()
		AddEntity(world, child)
		children[index] = child
	}

	inverseMass := 0.0

	for _, child := range children {
		inverseMass += 1 / child.Mass
	}

	force := 3 / inverseMass
	spin := ((random.CreateRandom(float64(a.ID)).Next() - 0.5) * force) / 3

	for i, child := range children {
		child.Velocity = Vec.Add(child.Velocity, Vec.Scale(Vec.Normalize(Vec.Subtract(child.Position, a.Position)), force/child.Mass))

		if len(groups[i]) == 1 {
			child.Spin += spin / child.Mass
		}
	}

	return children
}

func (a *Asteroid) Fracture(segment *AsteroidSegment, by int64, events *[]protocol.SimulationEvent, world *World) bool {
	if a.Dead {
		return false
	}

	if a.Health < 1 {
		a.Remove()
		random := random.CreateRandom(float64(a.ID))
		segments := a.Segments()

		if segments == nil {
			segments = []*AsteroidSegment{{Contents: a.Contents, ShapeOutline: ShapeOutlineOf(a)}}
		}

		for _, segment := range segments {
			offset := RotatePoint(CenterOf(segment.ShapeOutline), a.Rotation)
			points := segment.ShapeOutline.Points
			// Segment edges retain their direction when a fragment is recentered.
			rotation := math.Atan2(points[1][1]-points[0][1], points[1][0]-points[0][0])

			for index, resource := range segment.Contents {
				id := EntityID(world)
				item := world.ItemTypes[resource](ObjectProperties{World: world, ID: &id, Position: Vec.Add(a.Position, offset), Rotation: a.Rotation + rotation + float64(index), Spin: a.Spin + (random.Next()-0.5)*0.5, Velocity: Vec.AddScaled(a.Velocity, Vec.Create(-offset.Y, offset.X), a.Spin)})
				AddEntity(world, item)
			}
		}

		*events = append(*events, protocol.AsteroidDestroyed{AsteroidID: a.ID, By: by, Contents: a.Contents})
	} else if segment != nil && segment.Health < 1 {
		children := a.Detach(segment, world)
		ids := make([]int64, len(children))

		for i, child := range children {
			ids[i] = child.ID
		}

		*events = append(*events, protocol.AsteroidSplit{AsteroidID: a.ID, ChildIDs: ids})
	} else {
		return false
	}

	return true
}

func CreateAsteroid(world *World, props AsteroidProperties) *Asteroid {
	if props.ID == nil {
		id := EntityID(world)
		props.ID = &id
	}

	radius := 25.0

	if props.Radius != nil {
		radius = *props.Radius
	}

	props.Radius = &radius
	fullHealth := radius * 2

	if props.Health != nil {
		fullHealth = *props.Health
	}

	if props.MaxHealth != nil {
		fullHealth = *props.MaxHealth
	}

	props.MaxHealth = &fullHealth

	if props.Health == nil {
		health := fullHealth
		props.Health = &health
	}

	if props.Mass == nil {
		mass := 0.4 * (radius * radius)
		props.Mass = &mass
	}

	return NewAsteroid(props, world)
}

func insideShapeOutline(outline *ShapeOutline, local Vec.Vector) bool {
	count := len(outline.Points)
	turn := math.Atan2(local.Y, local.X) / (math.Pi * 2)
	face := int(math.Floor(math.Mod(math.Mod(turn, 1)+1, 1) * float64(count)))
	p, next := outline.Points[face], outline.Points[(face+1)%count]
	across := local.X*(next[1]-p[1]) - local.Y*(next[0]-p[0])
	return across == 0 || (p[0]*next[1]-p[1]*next[0])/across > 1
}

func AsteroidContact(asteroid *Asteroid, position Vec.Vector, radius float64) (normal Vec.Vector, overlap float64, ok bool) {
	outline := ShapeOutlineOf(asteroid)
	offset := Vec.Subtract(position, asteroid.Position)
	sine, cosine := math.Sincos(asteroid.Rotation)
	local := Vec.Create(offset.X*cosine+offset.Y*sine, offset.Y*cosine-offset.X*sine)
	closest, nearest := local, math.Inf(1)

	for i, p := range outline.Points {
		next := outline.Points[(i+1)%len(outline.Points)]
		edge := Vec.Create(next[0]-p[0], next[1]-p[1])
		denominator := Vec.Dot(edge, edge)

		if denominator == 0 {
			denominator = 1
		}

		along := min(1, max(0, Vec.Dot(Vec.Create(local.X-p[0], local.Y-p[1]), edge)/denominator))
		point := Vec.Create(p[0]+edge.X*along, p[1]+edge.Y*along)
		distance := Vec.Distance(point, local)

		if distance < nearest {
			nearest, closest = distance, point
		}
	}

	inside := insideShapeOutline(outline, local)
	overlap = radius - nearest

	if inside {
		overlap = radius + nearest
	}

	if overlap <= 0 {
		return Vec.Vector{}, overlap, false
	}

	away := Vec.Subtract(local, closest)

	if inside {
		away = Vec.Subtract(closest, local)
	}

	normal = Vec.Create(1, 0)

	if Vec.Length(away) != 0 {
		normal = Vec.Normalize(away)
	}

	return Vec.Create(normal.X*cosine-normal.Y*sine, normal.X*sine+normal.Y*cosine), overlap, true
}
