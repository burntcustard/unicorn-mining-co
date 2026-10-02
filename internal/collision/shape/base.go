// Shape-specific construction and manifolds use the shared collision geometry.
package shape

import (
	"github.com/burntcustard/unicorn-mining-co/internal/collision"
	Vec "github.com/burntcustard/unicorn-mining-co/internal/vector"
)

type Shape interface {
	Base() *collision.BaseShape
	ComputeAABB(*collision.AABB, Vec.TransformValue)
}
