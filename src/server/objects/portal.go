package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

// Portal has no health, docking, inventory or propulsion. Access is authorized
// by the session; an open portal can be crossed by any nearby piloted ship.
type Portal struct {
	*simulation.GameObject
	Opening, OpeningTarget, CloseAfter         float64
	stateHoldRemaining, requestedOpeningTarget float64
	previousOpening                            float64
	BlockedBeams                               uint8
	colliders                                  []*collision.Collider
	source                                     *geometrySource
	OnClosing                                  func()
	DestinationSector, DestinationName         string
	TravelRadius                               float64
	Spec                                       specs.JumpGate
	Segments                                   []*simulation.Segment
	Sides                                      []float64
	ConnectionID                               string
	TargetLabel                                string
	Connected                                  *Portal
}

type JumpGate struct{ *Portal }

type Wormhole struct{ *Portal }

type PortalEntity interface {
	simulation.Entity
	PortalBase() *Portal
}

type PortalOptions struct {
	ID                                 int64
	Position                           Vec.Vector
	DestinationSector, DestinationName string
	Wormhole                           bool
}

func NewPortal(world *simulation.World, options PortalOptions) PortalEntity {
	p := &Portal{GameObject: simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: &options.ID, Position: options.Position}, world.Specification.Simulation), DestinationSector: options.DestinationSector, DestinationName: options.DestinationName}
	p.Mass = math.Inf(1)
	p.Health = math.NaN()
	p.Physics = false
	p.Kind, p.Name, p.Radius, p.TravelRadius = "wormhole", "Wormhole", world.Specification.WormholeSpec.Radius, world.Specification.WormholeSpec.TravelRadius
	p.Opening, p.OpeningTarget = 1, 1

	if options.Wormhole {
		result := &Wormhole{p}
		p.Self = result
		return result
	}

	p.Spec = world.Specification.JumpGateSpec
	p.Kind, p.Name, p.Radius, p.TravelRadius = "jumpGate", "Jump Gate", p.Spec.Radius, p.Spec.TravelRadius
	p.Physics = true
	p.Opening, p.OpeningTarget = 0, 0
	p.stateHoldRemaining = p.Spec.StateHoldDuration / 1000
	// Hull construction is shared with stations, without inheriting their gameplay.
	p.Shades = world.Specification.Colors["white"]

	for i, plan := range hullPlans(world.Specification.JumpGateHull) {
		p.Segments = append(p.Segments, makeSegment(p.GameObject, 9, nil, plan, nil))
		p.Sides = append(p.Sides, world.Specification.JumpGateHull[i].Side)
	}

	result := &JumpGate{p}
	p.Self = result
	return result
}

func (p *Portal) PortalBase() *Portal { return p }

func (p *Portal) Connect(other *Portal) {
	p.Connected, other.Connected = other, p
}

// Requests wait for the current movement and minimum settled-state hold.
func (p *Portal) RequestOpening(target float64) {
	p.requestedOpeningTarget = target

	if p.Opening == p.OpeningTarget && p.stateHoldRemaining == 0 {
		p.setOpeningTarget(target)
	}
}

func (p *Portal) setOpeningTarget(target float64) {
	if p.OpeningTarget == target {
		return
	}

	p.OpeningTarget = target

	if target == 0 && p.OnClosing != nil {
		p.OnClosing()
	}
}

// Safety overrides queued access changes and reverses the existing motion in place.
func (p *Portal) InterruptClosing(beams uint8) {
	p.BlockedBeams |= beams
	p.OpeningTarget, p.requestedOpeningTarget = 1, 1
	p.stateHoldRemaining = 0
}

// Sweep the ship's bounds against each finite beam, including fast crossings.
func (p *Portal) CrossedBeams(from, to Vec.Vector, radius float64) uint8 {
	path := collision.BaseShape{Count: 2, Vertices: []Vec.Vector{
		simulation.RotatePoint(Vec.Subtract(from, p.Position), -p.Rotation),
		simulation.RotatePoint(Vec.Subtract(to, p.Position), -p.Rotation),
	}}

	span := p.Spec.HalfTravel*utilities.EaseProgress(utilities.EaseProgress(max(p.Opening, p.previousOpening))) + p.Spec.BeamInset
	blocked := uint8(0)

	for index, y := range p.Spec.BeamOffsets {
		beam := collision.BaseShape{Count: 2, Vertices: []Vec.Vector{Vec.Create(-span, y), Vec.Create(span, y)}}
		var distance collision.DistanceOutput
		var cache collision.SimplexCache
		collision.ComputeDistance(&distance, &cache, collision.DistanceInput{ProxyA: &path, ProxyB: &beam, TransformA: Vec.Transform(0, 0, 0), TransformB: Vec.Transform(0, 0, 0)})

		if distance.Distance <= radius {
			blocked |= 1 << index
		}
	}

	return blocked
}

// Exit access skips the settled-state hold, but never interrupts hull movement.
func (p *Portal) RequestExitOpening() {
	if p.Opening == 0 && p.OpeningTarget == 0 {
		p.stateHoldRemaining = 0
	}

	p.RequestOpening(1)
}

// The closed hull's inner octagon, measured in the gate's local coordinates.
func (p *Portal) ContainsInterior(position Vec.Vector) bool {
	local := simulation.RotatePoint(Vec.Subtract(position, p.Position), -p.Rotation)
	x, y := math.Abs(local.X), math.Abs(local.Y)
	return x < 189 && y < 202.5 && x+y < 274.5
}

func (p *Portal) Update(dt float64) {
	if p.Connected == nil {
		p.Advance(dt)
	}
}

func (p *Portal) Advance(dt float64) {
	p.previousOpening = p.Opening

	if p.Kind != "jumpGate" {
		return
	}

	for dt > 0 {
		if p.Opening == p.OpeningTarget {
			wait := min(dt, p.stateHoldRemaining)
			p.stateHoldRemaining -= wait
			dt -= wait

			if p.stateHoldRemaining > 0 || p.requestedOpeningTarget == p.OpeningTarget {
				return
			}

			p.setOpeningTarget(p.requestedOpeningTarget)
		}

		duration := p.Spec.ClosingDuration / 1000

		if p.OpeningTarget > p.Opening {
			duration = p.Spec.OpeningDuration / 1000
		}

		remaining := math.Abs(p.OpeningTarget-p.Opening) * duration
		step := min(dt, remaining)
		p.Opening = utilities.Approach(p.Opening, p.OpeningTarget, step/duration)
		dt -= step

		if step == remaining {
			p.Opening = p.OpeningTarget
			p.stateHoldRemaining = p.Spec.StateHoldDuration / 1000

			if p.Opening == 1 {
				p.BlockedBeams = 0
			}
		}
	}
}

func (p *Portal) Hitbox() []*collision.Collider {
	result := p.colliders[:0]
	changed := p.source == nil || len(p.colliders) != len(p.Segments)
	distance := p.Spec.HalfTravel * utilities.EaseProgress(utilities.EaseProgress(p.Opening))
	sine, cosine := math.Sincos(p.Rotation)

	for i, segment := range p.Segments {
		x, y := p.Sides[i]*distance+segment.Middle[0], segment.Middle[1]

		if segment.Collider == nil {
			segment.Collider = &collision.Collider{Owner: p.Self, Segment: segment, Physics: new(true), Collides: new(true), Radius: segment.Radius(segment), Friction: p.Friction}
		}

		if segment.Collider.ShapeOutline == nil {
			changed = true

			for _, point := range segment.Points.Points {
				segment.Collider.ShapeOutline = append(segment.Collider.ShapeOutline, []float64{point[0] - segment.Middle[0], point[1] - segment.Middle[1]})
			}
		}

		collider := segment.Collider
		changed = changed || i >= len(p.colliders) || p.colliders[i] != collider || collider.LocalPosition == nil || collider.LocalPosition.X != x || collider.LocalPosition.Y != y

		if collider.LocalPosition == nil {
			collider.LocalPosition = new(Vec.Vector)
		}

		*collider.LocalPosition = Vec.Create(x, y)
		collider.Position = Vec.Create(p.Position.X+(x*cosine-y*sine), p.Position.Y+(x*sine+y*cosine))
		segment.Collider.Rotation = p.Rotation
		result = append(result, collider)
	}

	if changed {
		p.source = &geometrySource{}
	}

	p.colliders = result
	return result
}

/*
GeometrySource identifies the local hull refreshed by Hitbox. Pose changes do
not rebuild fixtures; opening motion replaces the token when the hull slides.
*/
func (p *Portal) GeometrySource() any { return p.source }

// Sweeping the ship center prevents a fast crossing from skipping the trigger.
func (p *Portal) Crossed(from, to Vec.Vector) bool {
	// The aperture permits travel independently of the gate's access-controlled frame.
	delta := Vec.Subtract(to, from)
	length := Vec.LengthSquared(delta)
	t := 0.0

	if length > 0 {
		t = max(0, min(1, Vec.Dot(Vec.Subtract(p.Position, from), delta)/length))
	}

	return Vec.DistanceSquared(Vec.AddScaled(from, delta, t), p.Position) <= p.TravelRadius*p.TravelRadius
}
