package simulation

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestReusableRegionalQueriesPreserveOwnedViewBytes(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	regions := NewRegionManager(25, catalog)
	var result []protocol.RegionalView

	for _, test := range []struct {
		positions []Vec.Vector
		limits    []float64
	}{
		{[]Vec.Vector{{}}, nil},
		{[]Vec.Vector{{X: 350, Y: -480}}, nil},
		{[]Vec.Vector{{}, {X: 3200, Y: 1500}, {X: -2000, Y: 1200}}, []float64{0, 900, 3500}},
		{[]Vec.Vector{{X: 9000, Y: -7000}}, []float64{1500}},
		{nil, nil},
		{[]Vec.Vector{{}}, nil},
	} {
		owned := regions.QueryMany(test.positions, nil, test.limits...)
		want, err := json.Marshal(owned)

		if err != nil {
			t.Fatal(err)
		}

		result = regions.QueryManyInto(result, test.positions, nil, test.limits...)
		got, err := json.Marshal(result)

		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("reused query changed regional bytes: %v", err)
		}

		if len(result) != 0 && len(result[0].Asteroids) != 0 {
			regions.Remove(result[0].Asteroids[0].ID)
		}

		result = regions.QueryManyInto(result, []Vec.Vector{{X: -1900}}, nil)
		after, err := json.Marshal(owned)

		if err != nil || !bytes.Equal(after, want) {
			t.Fatalf("later query or removal changed an earlier owned view: %v", err)
		}
	}
}

func TestReusableRegionalQueriesAvoidResultAllocations(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	regions := NewRegionManager(25, catalog)
	positions := []Vec.Vector{{}}
	result := regions.QueryManyInto(nil, positions, nil)

	if len(result[0].Asteroids) == 0 {
		t.Fatal("missing asteroid query fixture")
	}

	allocations := testing.AllocsPerRun(100, func() {
		result = regions.QueryManyInto(result, positions, nil)
	})

	if allocations != 0 {
		t.Fatalf("unchanged regional query allocated %g objects", allocations)
	}
}
