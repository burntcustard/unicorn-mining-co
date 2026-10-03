// Port of src/client/objects/game-object.ts. The common mechanics share the simulation
// package with World and localMovement to resolve the TypeScript import cycle.
package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/random"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"sync/atomic"
)

var nextObjectID atomic.Int64

type ObjectRules struct {
	Motion definitions.Motion
	Flight definitions.Flight
}
type GameObject struct {
	DefinitionID string
	// Keep IDs, motion and per-tick state together ahead of cold metadata.
	ID                                                                                            int64
	Position, Velocity                                                                            Vec.Vector
	Rotation, Spin, Radius                                                                        float64
	World                                                                                         *World
	CollisionState, ReplicationState                                                              any
	Kind                                                                                          string
	Physics, Dead, Buried, InactivePhysics, Ballistic, HasPaint, HasResource                      bool
	Self                                                                                          Entity
	AngularDrag, AngularInertiaScale, Mass, Friction, Drag, SpeedLimit, PendingUpdateTime, Health float64
	LocalMovementParent                                                                           Entity
	LocalMovementRate                                                                             float64
	hitboxes                                                                                      [2][]*collision.Collider
	hitboxIndex                                                                                   int
	gameplayContacts                                                                              []collision.Contact
	Decay                                                                                         float64
	Label                                                                                         string
	Message                                                                                       *string
	PlayerID                                                                                      *int64
	Paint, PointCount, Resource                                                                   int
	RadiusEven                                                                                    *float64
	Collections                                                                                   []*[]Entity
	Random                                                                                        *random.Random
	ShapeOutline                                                                                  *ShapeOutline
	Bounciness                                                                                    *float64
	Rules                                                                                         ObjectRules
	Shades                                                                                        []string
	Price                                                                                         float64
	Item                                                                                          bool
	Unlock                                                                                        string
}
type ObjectProperties struct {
	Points                                                   *[]Point
	Mass, AngularDrag, AngularInertiaScale, Friction, Radius *float64
	Drag, SpeedLimit, Decay, Health, Bounciness              *float64
	Physics, Buried                                          *bool
	ShapeOutline                                             *ShapeOutline
	Message                                                  *string
	PlayerID                                                 *int64
	Resource                                                 *int
	Label                                                    *string

	ID                 *int64
	Position, Velocity Vec.Vector
	Rotation, Spin     float64
	World              *World
	Random             *random.Random
	Collections        []*[]Entity
}

func NewGameObject(props ObjectProperties, rules definitions.Simulation) *GameObject {
	id := int64(0)
	if props.ID != nil {
		id = *props.ID
	} else {
		id = nextObjectID.Add(-1)
	}
	r := props.Random
	if r == nil && props.World != nil {
		r = props.World.Random
	}
	if r == nil {
		r = random.CreateRandom(float64(uint32(id)))
	}
	o := &GameObject{ID: id, Position: props.Position, Velocity: props.Velocity, Rotation: props.Rotation, Spin: props.Spin, AngularInertiaScale: definitions.GameObjectAngularInertiaScale, Mass: definitions.GameObjectMass, Physics: true, Friction: definitions.GameObjectFriction, Drag: math.NaN(), SpeedLimit: math.NaN(), Health: math.NaN(), Price: math.NaN(), World: props.World, Collections: props.Collections, Random: r, Rules: ObjectRules{Motion: rules.Motion, Flight: rules.Flight}}
	o.Self = o
	o.ApplyProperties(props)
	return o
}
func (o *GameObject) Base() *GameObject { return o }
func (o *GameObject) MaxSpeed() float64 {
	if !math.IsNaN(o.SpeedLimit) {
		return o.SpeedLimit
	}
	return o.Rules.Motion.DefaultMaxSpeed
}
func (o *GameObject) Add() {
	o.Dead = false
	if o.World != nil {
		o.World.Entities.Set(o.ID, o.Self)
	}
	for _, list := range o.Collections {
		if !slices.Contains(*list, o.Self) {
			*list = append(*list, o.Self)
		}
	}
}
func (o *GameObject) Remove() {
	o.Dead = true
	if o.World != nil {
		resident, _ := o.World.Entities.Get(o.ID)
		if resident == o.Self {
			o.World.Entities.Delete(o.ID)
		}
	}
	for _, list := range o.Collections {
		if index := slices.Index(*list, o.Self); index >= 0 {
			*list = slices.Delete(*list, index, index+1)
		}
	}
}
func (o *GameObject) Hitbox() []*collision.Collider {
	if o.Dead || o.Buried || (o.Radius == 0 && o.ShapeOutline == nil) {
		return nil
	}
	o.hitboxIndex ^= 1
	body := o.hitboxes[o.hitboxIndex]
	if body == nil {
		body = make([]*collision.Collider, 1, 2)
		body[0] = &collision.Collider{}
		o.hitboxes[o.hitboxIndex] = body
	}
	c := body[0]
	outline := c.ShapeOutline
	if o.ShapeOutline == nil {
		outline = nil
	} else {
		if len(outline) != len(o.ShapeOutline.Points) {
			outline = make([][]float64, len(o.ShapeOutline.Points))
			for i := range outline {
				outline[i] = make([]float64, 2)
			}
		}
		for i, p := range o.ShapeOutline.Points {
			outline[i][0], outline[i][1] = p[0], p[1]
		}
	}
	*c = collision.Collider{Owner: o.Self, Position: o.Position, Radius: o.Radius, Rotation: o.Rotation, ShapeOutline: outline, Bounciness: o.Bounciness, Friction: o.Friction, Physics: &o.Physics}
	return body
}
func (o *GameObject) RoundMotion() {
	o.Position.X = utilities.RoundMotion(o.Position.X)
	o.Position.Y = utilities.RoundMotion(o.Position.Y)
	o.Velocity.X = utilities.RoundMotion(o.Velocity.X)
	o.Velocity.Y = utilities.RoundMotion(o.Velocity.Y)
	o.Rotation = utilities.RoundMotion(o.Rotation)
	o.Spin = utilities.RoundMotion(o.Spin)
}
func (o *GameObject) Update(dt float64) {
	if o.Dead || o.Buried {
		return
	}
	if o.Decay != 0 {
		o.Health -= o.Decay * dt
		if o.Health <= 0 {
			o.Remove()
			return
		}
	}
	if o.AngularDrag != 0 {
		o.Spin *= math.Exp(-o.AngularDrag * dt)
	}
	o.Rotation += o.Spin * dt
	drag := o.Drag
	if math.IsNaN(drag) {
		drag = o.Rules.Motion.DefaultDrag
	}
	maxSpeed := o.Self.MaxSpeed()
	speedSquared := o.Velocity.X*o.Velocity.X + o.Velocity.Y*o.Velocity.Y
	if speedSquared < o.Rules.Motion.MinimumSpeedSquared {
		o.Velocity = Vec.Vector{}
	} else {
		var kept float64
		if maxSpeed < 0 || speedSquared > maxSpeed*maxSpeed {
			speed := math.Sqrt(speedSquared)
			kept = max(maxSpeed, speed*math.Pow(o.Rules.Motion.MaxSpeedDrag, dt*60)) / speed
		} else {
			kept = math.Exp(-drag * dt)
		}
		o.Velocity = Vec.Scale(o.Velocity, kept)
	}
	o.Position = Vec.AddScaled(o.Position, o.Velocity, dt)
	var movers []Entity
	if o.World != nil {
		movers = o.World.MovementParents
		if movers == nil {
			movers = o.World.Entities.Values()
		}
	} else if len(o.Collections) > 1 {
		movers = *o.Collections[1]
	}
	var parents []movementParent
	if o.World != nil {
		parents = o.World.movementParents
	}
	localMovement(o.Self, movers, parents, dt)
	o.RoundMotion()
}

func (o *GameObject) ForceVelocity() *Vec.Vector { return &o.Velocity }
func (o *GameObject) ForceSpin() *float64        { return &o.Spin }
func (o *GameObject) ForceMass() float64         { return o.Mass }

// Class defaults precede instance properties in GameObject's Object.assign.
func (o *GameObject) ApplyProperties(props ObjectProperties) {
	if props.Mass != nil {
		o.Mass = *props.Mass
	}
	if props.AngularDrag != nil {
		o.AngularDrag = *props.AngularDrag
	}
	if props.AngularInertiaScale != nil {
		o.AngularInertiaScale = *props.AngularInertiaScale
	}
	if props.Friction != nil {
		o.Friction = *props.Friction
	}
	if props.Radius != nil {
		o.Radius = *props.Radius
	}
	if props.Drag != nil {
		o.Drag = *props.Drag
	}
	if props.SpeedLimit != nil {
		o.SpeedLimit = *props.SpeedLimit
	}
	if props.Decay != nil {
		o.Decay = *props.Decay
	}
	if props.Health != nil {
		o.Health = *props.Health
	}
	if props.Bounciness != nil {
		o.Bounciness = props.Bounciness
	}
	if props.Physics != nil {
		o.Physics = *props.Physics
	}
	if props.Buried != nil {
		o.Buried = *props.Buried
	}
	if props.ShapeOutline != nil {
		o.ShapeOutline = props.ShapeOutline
	}
	if props.Message != nil {
		o.Message = props.Message
	}
	if props.PlayerID != nil {
		o.PlayerID = props.PlayerID
	}
	if props.Resource != nil {
		o.Resource = *props.Resource
		o.HasResource = true
	}
	if props.Label != nil {
		o.Label = *props.Label
	}
}

func (o *GameObject) OutlineShades() []string { return o.Shades }
func (o *GameObject) ObjectKind() string      { return o.Kind }
func (o *GameObject) ResourceID() int         { return o.Resource }
