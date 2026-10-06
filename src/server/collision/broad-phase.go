// Port of src/client/collision/broad-phase.ts.
package collision

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

// The fixture type is a parameter to avoid the TypeScript physics/collision
// import cycle. GetOwner returns precisely the fixture's body pointer.
type BroadPhase[T any] struct {
	Grid       *SpatialGrid[T]
	MoveBuffer []*SpatialProxy[T]
	GetOwner   func(T) any
	callback   func(T, T)
	queryProxy *SpatialProxy[T]
}

func NewBroadPhase[T any](rules specs.Physics, getOwner func(T) any) *BroadPhase[T] {
	return &BroadPhase[T]{Grid: NewSpatialGrid[T](rules), GetOwner: getOwner}
}

func (b *BroadPhase[T]) TestOverlap(a, c *SpatialProxy[T]) bool { return TestOverlap(a.AABB, c.AABB) }

func (b *BroadPhase[T]) CreateProxy(aabb AABB, userData T) *SpatialProxy[T] {
	proxy := b.Grid.CreateProxy(aabb, userData, b.GetOwner(userData))
	b.BufferMove(proxy)
	return proxy
}

func (b *BroadPhase[T]) DestroyProxy(proxy *SpatialProxy[T]) {
	b.UnbufferMove(proxy)
	b.Grid.DestroyProxy(proxy)
}

func (b *BroadPhase[T]) MoveProxy(proxy *SpatialProxy[T], aabb AABB, displacement Vec.Vector) {
	if b.Grid.MoveProxy(proxy, aabb, displacement) {
		b.BufferMove(proxy)
	}
}

func (b *BroadPhase[T]) BufferMove(proxy *SpatialProxy[T]) {
	b.MoveBuffer = append(b.MoveBuffer, proxy)
}

func (b *BroadPhase[T]) UnbufferMove(proxy *SpatialProxy[T]) {
	for i, p := range b.MoveBuffer {
		if p == proxy {
			b.MoveBuffer[i] = nil
		}
	}
}

func (b *BroadPhase[T]) UpdatePairs(addPairCallback func(T, T)) {
	b.callback = addPairCallback

	for len(b.MoveBuffer) > 0 {
		i := len(b.MoveBuffer) - 1
		b.queryProxy = b.MoveBuffer[i]
		b.MoveBuffer[i] = nil
		b.MoveBuffer = b.MoveBuffer[:i]

		if b.queryProxy == nil {
			continue
		}

		b.Grid.Query(b.queryProxy.AABB, b.queryCallback, b.queryProxy.Owner)
	}
}

func (b *BroadPhase[T]) queryCallback(proxy *SpatialProxy[T]) bool {
	if proxy == b.queryProxy {
		return true
	}

	a, c := b.queryProxy, proxy

	if proxy.ID < b.queryProxy.ID {
		a, c = proxy, b.queryProxy
	}

	b.callback(a.UserData, c.UserData)
	return true
}
