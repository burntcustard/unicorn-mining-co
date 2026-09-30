// Port of the server collision contract in src/shared/collision/types.ts.
package collision

import Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"

type Collider struct {
	Segment         any
	LocalPosition   *Vec.Vector
	Collides        *bool
	DockSegment     bool
	Speed           float64
	AsteroidSegment any
	// ReadPose mirrors live property getters on TypeScript asteroid colliders.
	ReadPose func() (Vec.Vector, float64, float64, float64)

	Owner                       any
	Role                        string
	PickupPoint                 bool
	ContactFilter               func(self, other *Collider) bool
	Position                    Vec.Vector
	Rotation, Radius, Friction  float64
	Bounciness, CollisionMargin *float64
	Physics                     *bool
	ShapeOutline                [][]float64
}

func CollidersCanContact(a, b *Collider) bool {
	if a.ContactFilter == nil && b.ContactFilter == nil {
		return true
	}
	return (a.ContactFilter == nil || a.ContactFilter(a, b)) && (b.ContactFilter == nil || b.ContactFilter(b, a))
}

// Accessors preserve TypeScript's live collider properties. Static colliders
// return their stored values; asteroid colliders read their current owner.
func (c *Collider) GetPosition() Vec.Vector {
	if c.ReadPose != nil {
		position, _, _, _ := c.ReadPose()
		return position
	}
	return c.Position
}
func (c *Collider) GetRotation() float64 {
	if c.ReadPose != nil {
		_, rotation, _, _ := c.ReadPose()
		return rotation
	}
	return c.Rotation
}
func (c *Collider) GetFriction() float64 {
	if c.ReadPose != nil {
		_, _, friction, _ := c.ReadPose()
		return friction
	}
	return c.Friction
}
func (c *Collider) GetRadius() float64 {
	if c.ReadPose != nil {
		_, _, _, radius := c.ReadPose()
		return radius
	}
	return c.Radius
}

type Contact struct {
	Collider, Other *Collider
	Depth           float64
	Normal, Point   Vec.Vector
}

// The accessors replace property reads across Go package boundaries.
type outlineOwner interface {
	OutlineShades() []string
	ObjectKind() string
	ResourceID() int
}
type outlineSegment interface{ OutlineShades() []string }

func OutlineColorOf(collider *Collider, colors map[string][]string) string {
	fallback := colors["white"][2]
	if segment, ok := collider.Segment.(outlineSegment); ok {
		shades := segment.OutlineShades()
		if len(shades) > 2 && shades[2] != "" {
			return shades[2]
		}
		return fallback
	}
	owner := collider.Owner.(outlineOwner)
	if owner.ObjectKind() == "asteroid" {
		if owner.ResourceID() == 1 {
			return colors["violet"][2]
		}
		return fallback
	}
	shades := owner.OutlineShades()
	if len(shades) > 2 && shades[2] != "" {
		return shades[2]
	}
	return fallback
}
