// Port of src/shared/game-object.ts. The common mechanics share the simulation
// package with World and localMovement to resolve the TypeScript import cycle.
package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	"github.com/burntcustard/unicorn-mining-co/internal/random"
	"github.com/burntcustard/unicorn-mining-co/internal/specification"
	"github.com/burntcustard/unicorn-mining-co/internal/utilities"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
	"math"
	"slices"
	"sync/atomic"
)

var nextObjectID atomic.Int64

type GameObject struct {
	ReplicationState                                                         any
	HasPaint                                                                 bool
	HasResource                                                              bool
	Ballistic                                                                bool
	ID                                                                       int64
	Position, Velocity                                                       Vec.Vector
	Rotation, Spin, AngularDrag, AngularInertiaScale, Mass, Friction, Radius float64
	Physics, Dead, Buried                                                    bool
	PendingUpdateTime                                                        float64
	LocalMovementParent                                                      Entity
	LocalMovementRate                                                        float64
	Drag, SpeedLimit, Decay, Health                                          float64
	Label, Kind                                                              string
	Message                                                                  *string
	PlayerID                                                                 *int64
	Paint, PointCount, Resource                                              int
	RadiusEven                                                               *float64
	World                                                                    *World
	Collections                                                              []*[]Entity
	Random                                                                   *random.Random
	ShapeOutline                                                             *ShapeOutline
	Bounciness                                                               *float64
	Self                                                                     Entity
	Rules                                                                    specification.Simulation
	Shades                                                                   []string
	Price                                                                    float64
	Item                                                                     bool
	Unlock                                                                   string
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

func NewGameObject(props ObjectProperties, rules specification.Simulation) *GameObject {
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
	o := &GameObject{ID: id, Position: props.Position, Velocity: props.Velocity, Rotation: props.Rotation, Spin: props.Spin, AngularInertiaScale: 1, Mass: 6, Physics: true, Friction: 0.01, Drag: math.NaN(), SpeedLimit: math.NaN(), Health: math.NaN(), Price: math.NaN(), World: props.World, Collections: props.Collections, Random: r, Rules: rules}
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
	var outline [][]float64
	if o.ShapeOutline != nil {
		outline = make([][]float64, len(o.ShapeOutline.Points))
		for i, p := range o.ShapeOutline.Points {
			outline[i] = []float64{p[0], p[1]}
		}
	}
	return []*collision.Collider{{Owner: o.Self, Position: o.Position, Radius: o.Radius, Rotation: o.Rotation, ShapeOutline: outline, Bounciness: o.Bounciness, Friction: o.Friction, Physics: &o.Physics}}
}
func (o *GameObject) RoundMotion() {
	o.Position.X = utilities.Round(o.Position.X)
	o.Position.Y = utilities.Round(o.Position.Y)
	o.Velocity.X = utilities.Round(o.Velocity.X)
	o.Velocity.Y = utilities.Round(o.Velocity.Y)
	o.Rotation = utilities.Round(o.Rotation)
	o.Spin = utilities.Round(o.Spin)
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
		speed := math.Sqrt(speedSquared)
		var kept float64
		if speed > maxSpeed {
			kept = math.Max(maxSpeed, speed*math.Pow(o.Rules.Motion.MaxSpeedDrag, dt*60)) / speed
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
	LocalMovement(o.Self, movers, dt)
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
