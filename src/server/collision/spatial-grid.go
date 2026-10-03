// Port of src/client/collision/spatial-grid.ts.
package collision

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

const cellSize = 256

type SpatialProxy[T any] struct {
	ID       uint64
	UserData T
	Owner    any
	AABB     AABB
}

type spatialGroup[T any] struct {
	nodes      []*SpatialProxy[T]
	cellIDs    []int32
	bounds     AABB
	queryStamp uint64
}

type queryScratch[T any] struct {
	candidates []*SpatialProxy[T]
}

// Owner must be comparable (a body pointer in the simulation); nil corresponds
// to JavaScript undefined. Slices preserve Set insertion order. Maps are lookup
// tables only and are never iterated to decide contact order.
type SpatialGrid[T any] struct {
	bodyGroups                    map[any]*spatialGroup[T]
	gridCells                     map[int32][]*spatialGroup[T]
	dirty                         []*spatialGroup[T]
	dirtySet                      map[*spatialGroup[T]]bool
	queryScratch                  []*queryScratch[T]
	queryDepth                    int
	queryStamp                    uint64
	nextID                        uint64
	aabbExtension, aabbMultiplier float64
}

func NewSpatialGrid[T any](rules definitions.Physics) *SpatialGrid[T] {
	return &SpatialGrid[T]{bodyGroups: make(map[any]*spatialGroup[T]), gridCells: make(map[int32][]*spatialGroup[T]), dirtySet: make(map[*spatialGroup[T]]bool), aabbExtension: rules.AabbExtension, aabbMultiplier: rules.AabbMultiplier}
}

func cellKeys(box AABB) []int32 {
	keys := []int32{}

	for x := int64(math.Floor(box.LowerBound.X / cellSize)); x <= int64(math.Floor(box.UpperBound.X/cellSize)); x++ {
		for y := int64(math.Floor(box.LowerBound.Y / cellSize)); y <= int64(math.Floor(box.UpperBound.Y/cellSize)); y++ {
			keys = append(keys, int32(uint32(x)*uint32(0x9e3779b1))^int32(y))
		}
	}

	return keys
}

func (g *SpatialGrid[T]) markDirty(group *spatialGroup[T]) {
	if !g.dirtySet[group] {
		g.dirtySet[group] = true
		g.dirty = append(g.dirty, group)
	}
}

func (g *SpatialGrid[T]) CreateProxy(box AABB, userData T, owner any) *SpatialProxy[T] {
	g.nextID++
	node := &SpatialProxy[T]{ID: g.nextID, UserData: userData, Owner: owner, AABB: box}
	bodyGroup := g.bodyGroups[owner]

	if bodyGroup == nil {
		bodyGroup = &spatialGroup[T]{}
		g.bodyGroups[owner] = bodyGroup
	}

	Extend(&node.AABB, g.aabbExtension)
	bodyGroup.nodes = append(bodyGroup.nodes, node)
	g.markDirty(bodyGroup)
	return node
}

func (g *SpatialGrid[T]) DestroyProxy(node *SpatialProxy[T]) {
	group := g.bodyGroups[node.Owner]

	group.nodes = slices.DeleteFunc(group.nodes, func(n *SpatialProxy[T]) bool { return n == node })

	g.markDirty(group)

	if len(group.nodes) == 0 {
		delete(g.bodyGroups, node.Owner)
	}
}

func (g *SpatialGrid[T]) MoveProxy(node *SpatialProxy[T], box AABB, displacement Vec.Vector) bool {
	if node.AABB.Contains(box) {
		return false
	}

	node.AABB = box
	Extend(&node.AABB, g.aabbExtension)
	node.AABB.LowerBound.X += min(0, displacement.X*g.aabbMultiplier)
	node.AABB.LowerBound.Y += min(0, displacement.Y*g.aabbMultiplier)
	node.AABB.UpperBound.X += max(0, displacement.X*g.aabbMultiplier)
	node.AABB.UpperBound.Y += max(0, displacement.Y*g.aabbMultiplier)
	g.markDirty(g.bodyGroups[node.Owner])
	return true
}

func (g *SpatialGrid[T]) Query(box AABB, callback func(*SpatialProxy[T]) bool, owner any) {
	for _, group := range g.dirty {
		group.bounds = AABB{Vec.Vector{X: math.Inf(1), Y: math.Inf(1)}, Vec.Vector{X: math.Inf(-1), Y: math.Inf(-1)}}

		for _, node := range group.nodes {
			group.bounds.Combine(group.bounds, node.AABB)
		}

		var keys []int32

		if len(group.nodes) > 0 {
			keys = cellKeys(group.bounds)
		}

		if slices.Equal(keys, group.cellIDs) {
			continue
		}

		for _, key := range group.cellIDs {
			cell := g.gridCells[key]

			cell = slices.DeleteFunc(cell, func(v *spatialGroup[T]) bool { return v == group })

			if len(cell) == 0 {
				delete(g.gridCells, key)
			} else {
				g.gridCells[key] = cell
			}
		}

		group.cellIDs = keys

		for _, key := range keys {
			cell := g.gridCells[key]

			if !slices.Contains(cell, group) {
				g.gridCells[key] = append(cell, group)
			}
		}
	}

	clear(g.dirty)
	g.dirty = g.dirty[:0]
	clear(g.dirtySet)
	depth := g.queryDepth
	g.queryDepth++

	if depth == len(g.queryScratch) {
		g.queryScratch = append(g.queryScratch, &queryScratch[T]{})
	}

	scratch := g.queryScratch[depth]

	defer func() {
		clear(scratch.candidates)
		scratch.candidates = scratch.candidates[:0]
		g.queryDepth--
	}()

	var ownGroup *spatialGroup[T]

	if owner != nil {
		ownGroup = g.bodyGroups[owner]
	}

	g.queryStamp++
	stamp := g.queryStamp
	fromX, toX := int64(math.Floor(box.LowerBound.X/cellSize)), int64(math.Floor(box.UpperBound.X/cellSize))
	fromY, toY := int64(math.Floor(box.LowerBound.Y/cellSize)), int64(math.Floor(box.UpperBound.Y/cellSize))

	for x := fromX; x <= toX; x++ {
		for y := fromY; y <= toY; y++ {
			key := int32(uint32(x)*uint32(0x9e3779b1)) ^ int32(y)

			for _, group := range g.gridCells[key] {
				if group == ownGroup || group.queryStamp == stamp {
					continue
				}

				group.queryStamp = stamp

				if !TestOverlap(group.bounds, box) {
					continue
				}

				for _, node := range group.nodes {
					if TestOverlap(node.AABB, box) {
						scratch.candidates = append(scratch.candidates, node)
					}
				}
			}
		}
	}

	slices.SortFunc(scratch.candidates, func(a, b *SpatialProxy[T]) int {
		if a.ID < b.ID {
			return -1
		}

		if a.ID > b.ID {
			return 1
		}

		return 0
	})

	for _, node := range scratch.candidates {
		if !callback(node) {
			break
		}
	}
}
