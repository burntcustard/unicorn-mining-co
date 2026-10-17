package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

// Passage has no health, docking, inventory or propulsion. Access is authorized
// by the session; an open passage can be crossed by any nearby piloted ship.
type Passage struct {
	*simulation.GameObject
	*passageMotion
	DestinationSector, DestinationName string
	TravelRadius                       float64
	Spec                               specs.JumpGate
	Segments                           []*simulation.Segment
	Sides                              []float64
	ConnectionID                       string
	Connected                          *Passage
}

// Linked gates share one motion state, advanced once by the session per tick.
type passageMotion struct {
	Opening, OpeningTarget, CloseAfter         float64
	stateHoldRemaining, requestedOpeningTarget float64
}

type JumpGate struct{ *Passage }

type Wormhole struct{ *Passage }

type PassageEntity interface {
	simulation.Entity
	PassageBase() *Passage
}

type PassageOptions struct {
	ID                                 int64
	Position                           Vec.Vector
	DestinationSector, DestinationName string
	Wormhole                           bool
}

func NewPassage(world *simulation.World, options PassageOptions) PassageEntity {
	p := &Passage{GameObject: simulation.NewGameObject(simulation.ObjectProperties{World: world, ID: &options.ID, Position: options.Position}, world.Specification.Simulation), DestinationSector: options.DestinationSector, DestinationName: options.DestinationName}
	p.passageMotion = &passageMotion{}
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

func (p *Passage) PassageBase() *Passage { return p }

func (p *Passage) Connect(other *Passage) {
	p.Connected, other.Connected = other, p

	if p.Kind == "jumpGate" {
		other.passageMotion = p.passageMotion
	}
}

// Requests wait for the current movement and minimum settled-state hold.
func (p *Passage) RequestOpening(target float64) {
	p.requestedOpeningTarget = target

	if p.Opening == p.OpeningTarget && p.stateHoldRemaining == 0 {
		p.OpeningTarget = target
	}
}

func (p *Passage) Update(dt float64) {
	if p.Connected == nil {
		p.Advance(dt)
	}
}

func (p *Passage) Advance(dt float64) {
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

			p.OpeningTarget = p.requestedOpeningTarget
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
		}
	}
}

func (p *Passage) Hitbox() []*collision.Collider {
	result := make([]*collision.Collider, 0, len(p.Segments))
	distance := p.Spec.HalfTravel * utilities.EaseProgress(utilities.EaseProgress(p.Opening))

	for i, segment := range p.Segments {
		offset := Vec.Create(p.Sides[i]*distance+segment.Middle[0], segment.Middle[1])

		if segment.Collider == nil {
			segment.Collider = &collision.Collider{Owner: p.Self, Segment: segment, Physics: new(true), Collides: new(true), Radius: segment.Radius(segment), Friction: p.Friction}

			// Ships emerging from the aperture can pass outward through the open frame.
			segment.Collider.ContactFilter = func(_, other *collision.Collider) bool {
				owner, ok := other.Owner.(interface{ ShipBase() *Ship })

				if !ok || p.Opening < 1 {
					return true
				}

				ship := owner.ShipBase()
				return Vec.Dot(Vec.Subtract(ship.Position, p.Position), ship.Velocity) <= 0
			}

		}

		if segment.Collider.ShapeOutline == nil {
			for _, point := range segment.Points.Points {
				segment.Collider.ShapeOutline = append(segment.Collider.ShapeOutline, []float64{point[0] - segment.Middle[0], point[1] - segment.Middle[1]})
			}
		}

		segment.Collider.LocalPosition = &offset
		segment.Collider.Position = Vec.Add(p.Position, simulation.RotatePoint(offset, p.Rotation))
		segment.Collider.Rotation = p.Rotation
		result = append(result, segment.Collider)
	}

	return result
}

// Sweeping the ship center prevents a fast crossing from skipping the trigger.
func (p *Passage) Crossed(from, to Vec.Vector) bool {
	// The aperture permits travel independently of the gate's access-controlled frame.
	delta := Vec.Subtract(to, from)
	length := Vec.LengthSquared(delta)
	t := 0.0

	if length > 0 {
		t = max(0, min(1, Vec.Dot(Vec.Subtract(p.Position, from), delta)/length))
	}

	return Vec.DistanceSquared(Vec.AddScaled(from, delta, t), p.Position) <= p.TravelRadius*p.TravelRadius
}
