package collision

import (
	"encoding/json"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"os"
	"reflect"
	"testing"
)

type recordedFixture struct{ id, owner int }

func TestTypeScriptBroadPhaseLifecycle(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/broad-phase.json")
	if err != nil {
		t.Fatal(err)
	}
	var records []struct {
		Kind             string
		ID, Owner        *int
		Bounds, Nested   AABB
		Displacement     Vec.Vector
		Limit            int
		Pairs            [][2]int
		Hits, NestedHits []int
		Proxies          []struct {
			ID      int
			ProxyID uint64
			Bounds  AABB
		}
	}
	if err = json.Unmarshal(data, &records); err != nil {
		t.Fatal(err)
	}
	if len(records) < 500 {
		t.Fatal("incomplete TypeScript lifecycle fixture")
	}
	spec, err := definitions.Load()
	if err != nil {
		t.Fatal(err)
	}
	broad := NewBroadPhase[*recordedFixture](spec.Simulation.Physics, func(f *recordedFixture) any { return f.owner })
	proxies := map[int]*SpatialProxy[*recordedFixture]{}
	for step, op := range records {
		pairs := [][2]int{}
		hits, nestedHits := []int{}, []int{}
		switch op.Kind {
		case "create":
			proxies[*op.ID] = broad.CreateProxy(op.Bounds, &recordedFixture{id: *op.ID, owner: *op.Owner})
		case "move":
			broad.MoveProxy(proxies[*op.ID], op.Bounds, op.Displacement)
		case "destroy":
			broad.DestroyProxy(proxies[*op.ID])
			delete(proxies, *op.ID)
		case "buffer":
			broad.BufferMove(proxies[*op.ID])
		case "pairs":
			broad.UpdatePairs(func(a, b *recordedFixture) { pairs = append(pairs, [2]int{a.id, b.id}) })
		case "query":
			var owner any
			if op.Owner != nil {
				owner = *op.Owner
			}
			broad.Grid.Query(op.Bounds, func(p *SpatialProxy[*recordedFixture]) bool {
				hits = append(hits, p.UserData.id)
				if len(hits) == 1 {
					broad.Grid.Query(op.Nested, func(p *SpatialProxy[*recordedFixture]) bool {
						nestedHits = append(nestedHits, p.UserData.id)
						return true
					}, nil)
				}
				return op.Limit == 0 || len(hits) < op.Limit
			}, owner)
		default:
			t.Fatalf("unknown operation %q", op.Kind)
		}
		if !reflect.DeepEqual(pairs, op.Pairs) || !reflect.DeepEqual(hits, op.Hits) || !reflect.DeepEqual(nestedHits, op.NestedHits) {
			t.Fatalf("step %d %s: pairs %v want %v; hits %v want %v; nested %v want %v", step, op.Kind, pairs, op.Pairs, hits, op.Hits, nestedHits, op.NestedHits)
		}
		if len(proxies) != len(op.Proxies) {
			t.Fatalf("step %d proxy count", step)
		}
		for _, want := range op.Proxies {
			got := proxies[want.ID]
			if got == nil || got.ID != want.ProxyID || got.AABB != want.Bounds {
				t.Fatalf("step %d proxy %d: %+v want %+v", step, want.ID, got, want)
			}
		}
	}
}
