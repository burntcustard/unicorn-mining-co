package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

/*
ReturnMovement flies toward a station's saved location until its region loads,
then uses the same bay approach for every NPC hull and role.
*/
func (p *Pilot) ReturnMovement(ship *objects.Ship, home Movement) Movement {
	if entity, ok := ship.World.Entities.Get(home.TargetID); ok {
		if station, ok := entity.(*objects.Station); ok {
			return p.DockingMovement(ship, station)
		}
	}

	return home
}

/*
DockingMovement commits to a bay, routes around the hull, then enters its corridor.
The station remains an obstacle until the ship lines up outside that bay.
*/
func (p *Pilot) DockingMovement(ship *objects.Ship, station *objects.Station) Movement {
	if len(station.DockingBays) == 0 {
		return Movement{Position: station.Position, IgnoreID: station.ID}
	}

	if p.dockingID != station.ID {
		p.dockingID, p.enteringDock = station.ID, false
		best := math.Inf(1)

		for index, bay := range station.DockingBays {
			angle := station.Rotation + bay
			point := Vec.AddScaled(station.Position, Vec.Create(math.Cos(angle), math.Sin(angle)), station.Radius+150)

			if d := Vec.DistanceSquared(ship.Position, point); d < best {
				p.dockingBay, best = index, d
			}
		}
	}

	relative := Vec.Subtract(ship.Position, station.Position)
	spin := station.Spin

	// Local movement already carries the ship around its station.
	if ship.LocalMovementParent == station {
		spin *= 1 - ship.LocalMovementRate
	}

	angle := station.Rotation + station.DockingBays[p.dockingBay]
	direction := Vec.Create(math.Cos(angle), math.Sin(angle))
	across, along := math.Abs(Vec.Cross(relative, direction)), Vec.Dot(relative, direction)
	velocity := Vec.Add(station.Velocity, Vec.Scale(Vec.Create(-relative.Y, relative.X), spin))
	drift := Vec.Subtract(ship.Velocity, velocity)
	// Crossing the centerline is not enough: residual drift must also fit the
	// corridor before navigation stops treating the station as an obstacle.
	coastAcross := across + math.Abs(Vec.Cross(drift, direction))/max(.001, ship.Drag)
	aligned := Vec.Dot(Vec.Create(math.Cos(ship.Rotation), math.Sin(ship.Rotation)), direction) < -.9

	if across > 65 || along < 0 || Vec.Length(relative) > station.Radius+280 {
		p.enteringDock = false
	}

	if coastAcross < 35 && along > station.Radius && along < station.Radius+240 {
		p.enteringDock = true
	}

	if p.enteringDock {
		// Coast while facing inward. Thrust during this turn would push an
		// otherwise safe approach sideways into the docking bay walls.
		return Movement{Position: station.Position, Velocity: velocity, IgnoreID: station.ID, Coasting: !aligned}
	}

	// Lead the moving bay while still outside its approach corridor.
	lead := min(2, Vec.Distance(ship.Position, station.Position)/max(70, Vec.Length(ship.Velocity)))
	angle += spin * lead
	outside := Vec.AddScaled(station.Position, Vec.Create(math.Cos(angle), math.Sin(angle)), station.Radius+150)
	// Use ordinary arrival braking to settle at the staging point before entry.
	return Movement{Position: outside, Velocity: Vec.Add(station.Velocity, Vec.Scale(Vec.Create(-direction.Y, direction.X), spin*(station.Radius+150))), FollowDistance: 10}
}

// Search advances around an expanding spiral, retaining reachable legs through detours.
type Search struct {
	Origin  Vec.Vector
	Heading float64
	Angle   float64
}

/*
Movement advances with the ship rather than time. Skip points inside obstacles
so an unreachable waypoint cannot trap the search in small circles.
Switching reachable legs before arriving keeps the ship moving around the area.
*/
func (s *Search) movement(ship *objects.Ship, obstacles []obstacle) Movement {
	waypoint := func() Vec.Vector {
		angle := s.Heading + s.Angle
		return Vec.AddScaled(s.Origin, Vec.Create(math.Cos(angle), math.Sin(angle)), 120+55*s.Angle)
	}

	target := waypoint()
	speed := Vec.Length(ship.Velocity)
	lookahead := speed * ship.Catalog.NPCMovement.DecisionInterval
	turnRate := ship.TurnRate * ship.RotationalThrust() / ship.Rules.Flight.SpinDivisor

	if turnRate > 0 {
		lookahead += speed / turnRate
	}

	lookahead = max(70, lookahead)
	radius := navigationRadius(ship) + ship.Catalog.NPCMovement.ClearanceDistance

	for Vec.Distance(ship.Position, target) < lookahead || !clearSegment(target, target, radius, obstacles, false) {
		s.Angle += math.Pi / 32
		target = waypoint()
	}

	return Movement{Position: target}
}

/*
Search advances the spiral and steers through the same captured scene.
Only its semantic spiral state is retained separately from the pilot.
*/
func (p *Pilot) Search(ship *objects.Ship, search *Search) (float64, float64) {
	obstacles := p.obstacles.capture(ship, 0)
	destination := search.movement(ship, obstacles)

	if ship.Launching > 0 {
		return 1, 0
	}

	return p.steer(ship, destination, nil, obstacles)
}

type routePlan struct {
	points    []Vec.Vector
	obstacles []obstacle
	target    Vec.Vector
	tick      uint64
	partial   bool
}

/*
waypoint keeps a route around whole clusters rather than reacting to one rock.
Every shortcut checks circle bounds and precise outlines before following it.
*/
func (p *routePlan) waypoint(ship *objects.Ship, target Vec.Vector, obstacles []obstacle) (Vec.Vector, bool) {
	rules := ship.Catalog.NPCMovement
	radius := navigationRadius(ship) + rules.ClearanceDistance
	clear(p.obstacles)
	p.obstacles = p.obstacles[:0]

	// Keep terrain outlines in the route even when mined fragments drift.
	// Moving circle obstacles belong in the swept forecast; routing around
	// their current positions can send opposing ships onto the same detour.
	for _, object := range obstacles {
		if object.polygon != nil || Vec.LengthSquared(object.velocity) < ship.Rules.Motion.MinimumSpeedSquared {
			p.obstacles = append(p.obstacles, object)
		}
	}

	obstacles = p.obstacles

	if clearSegment(ship.Position, target, radius, obstacles, true) {
		p.points = nil
		p.partial = false
		return target, false
	}

	stale := float64(ship.World.Tick-p.tick)*ship.Catalog.Simulation.SimulationStep > 4
	arrived := p.partial && len(p.points) > 0 && Vec.Distance(ship.Position, p.points[len(p.points)-1]) < 25

	if len(p.points) == 0 || stale || arrived || Vec.Distance(p.target, target) > rules.ReplanDistance || !clearSegment(ship.Position, p.points[0], radius, obstacles, true) {
		p.points = planRoute(ship.Position, target, radius, obstacles)
		p.target, p.tick = target, ship.World.Tick
		p.partial = Vec.Distance(ship.Position, target) > 1800
	}

	if len(p.points) == 0 {
		return ship.Position, true
	}

	next := 0

	for index := len(p.points) - 1; index >= 0; index-- {
		if clearSegment(ship.Position, p.points[index], radius, obstacles, true) {
			next = index
			break
		}
	}

	p.points = p.points[next:]
	waypoint := p.points[0]
	offset := Vec.Subtract(waypoint, ship.Position)
	distance := Vec.Length(offset)

	if distance > rules.RouteLookahead {
		waypoint = Vec.AddScaled(ship.Position, offset, rules.RouteLookahead/distance)
	}

	return waypoint, true
}

/*
planRoute searches a bounded grid with swept edges, including diagonal edges.
If the exact destination is obstructed, it returns its closest reachable approach.
*/
func planRoute(from, target Vec.Vector, radius float64, obstacles []obstacle) []Vec.Vector {
	if offset := Vec.Subtract(target, from); Vec.Length(offset) > 1800 {
		target = Vec.AddScaled(from, Vec.Normalize(offset), 1800)
	}

	cell := max(24, min(48, radius))
	path := gridRoute(from, target, radius, cell, obstacles, false)
	length := math.Inf(1)
	remaining := math.Inf(1)

	choose := func(candidate []Vec.Vector) {
		if len(candidate) == 0 {
			return
		}

		candidateLength, previous := 0., from

		for _, point := range candidate {
			candidateLength += Vec.Distance(previous, point)
			previous = point
		}

		candidateRemaining := Vec.Distance(previous, target)

		if candidateRemaining < remaining-1 || math.Abs(candidateRemaining-remaining) <= 1 && candidateLength < length {
			path, length, remaining = candidate, candidateLength, candidateRemaining
		}
	}

	choose(path)

	incomplete := func() bool { return remaining > cell*2 && clearSegment(target, target, radius, obstacles, false) }

	if len(path) == 0 || incomplete() || length > Vec.Distance(from, target)*1.4 {
		choose(gridRoute(from, target, radius, cell*.5, obstacles, false))
	}

	// Resolve long or disconnected circle routes with precise outline nodes.
	if len(path) == 0 || incomplete() || length > Vec.Distance(from, target)*1.4 {
		for _, object := range obstacles {
			if object.polygon != nil {
				choose(gridRoute(from, target, radius, cell*.5, obstacles, true))
				break
			}
		}
	}

	return path
}

func gridRoute(from, target Vec.Vector, radius, cell float64, obstacles []obstacle, outline bool) []Vec.Vector {
	offset := Vec.Subtract(target, from)

	margin := 900.0
	left, top := int(math.Floor((min(0, offset.X)-margin)/cell)), int(math.Floor((min(0, offset.Y)-margin)/cell))
	right, bottom := int(math.Ceil((max(0, offset.X)+margin)/cell)), int(math.Ceil((max(0, offset.Y)+margin)/cell))
	width, height := right-left+1, bottom-top+1
	count := width * height

	point := func(index int) Vec.Vector {
		return Vec.Add(from, Vec.Create(float64(index%width+left)*cell, float64(index/width+top)*cell))
	}

	nearby := make([]obstacle, 0, len(obstacles))
	boxMin := Vec.Add(from, Vec.Create(float64(left)*cell, float64(top)*cell))
	boxMax := Vec.Add(from, Vec.Create(float64(right)*cell, float64(bottom)*cell))

	for _, object := range obstacles {
		reach := object.radius + radius

		if object.position.X+reach >= boxMin.X && object.position.X-reach <= boxMax.X && object.position.Y+reach >= boxMin.Y && object.position.Y-reach <= boxMax.Y {
			nearby = append(nearby, object)
		}
	}

	cost, parent := make([]float64, count), make([]int, count)
	passable, closed := make([]int8, count), make([]bool, count)

	for index := range cost {
		cost[index], parent[index] = math.Inf(1), -1
	}

	free := func(index int) bool {
		if passable[index] == 0 {
			passable[index] = 1
			position := point(index)

			for _, object := range nearby {
				reach := object.radius + radius

				if Vec.DistanceSquared(position, object.position) < reach*reach && (!outline || object.distance(position) < radius) {
					passable[index] = -1
					break
				}
			}
		}

		return passable[index] == 1
	}

	start := -left - top*width
	cost[start] = 0
	queue := routeQueue{{index: start, score: Vec.Distance(from, target)}}
	best, closest := start, Vec.Distance(from, target)
	finished := false

	for len(queue) > 0 {
		current := queue.pop().index

		if closed[current] {
			continue
		}

		closed[current] = true
		position := point(current)
		distance := Vec.Distance(position, target)

		if distance < closest {
			best, closest = current, distance
		}

		if distance < cell*2 && clearSegment(position, target, radius, nearby, current == start) {
			best, finished = current, true
			break
		}

		reach := 1

		if current == start {
			reach = 4
		}

		for dy := -reach; dy <= reach; dy++ {
			for dx := -reach; dx <= reach; dx++ {
				if dx == 0 && dy == 0 {
					continue
				}

				x, y := current%width+dx, current/width+dy

				if x < 0 || x >= width || y < 0 || y >= height {
					continue
				}

				next := y*width + x

				if closed[next] || !free(next) {
					continue
				}

				to := point(next)
				candidate := cost[current] + Vec.Distance(position, to)

				if candidate >= cost[next] || !clearSegment(position, to, radius, nearby, current == start) {
					continue
				}

				cost[next], parent[next] = candidate, current
				queue.push(routeNode{next, candidate + Vec.Distance(to, target)})
			}
		}
	}

	if best == start {
		return nil
	}

	var reverse []Vec.Vector

	if finished {
		reverse = append(reverse, target)
	}

	for current := best; current != start && current >= 0; current = parent[current] {
		reverse = append(reverse, point(current))
	}

	slices.Reverse(reverse)
	return reverse
}

type routeNode struct {
	index int
	score float64
}

type routeQueue []routeNode

/*
The typed heap retains A* ordering without boxing every queued and popped node.
*/
func (q *routeQueue) push(value routeNode) {
	queue := append(*q, value)

	for child := len(queue) - 1; child > 0; {
		parent := (child - 1) / 2

		if !(queue[child].score < queue[parent].score) {
			break
		}

		queue[child], queue[parent] = queue[parent], queue[child]
		child = parent
	}

	*q = queue
}

func (q *routeQueue) pop() routeNode {
	queue := *q
	value := queue[0]
	last := len(queue) - 1
	queue[0] = queue[last]
	queue = queue[:last]

	for parent := 0; ; {
		child := parent*2 + 1

		if child >= last {
			break
		}

		if child+1 < last && queue[child+1].score < queue[child].score {
			child++
		}

		if !(queue[child].score < queue[parent].score) {
			break
		}

		queue[parent], queue[child] = queue[child], queue[parent]
		parent = child
	}

	*q = queue
	return value
}
