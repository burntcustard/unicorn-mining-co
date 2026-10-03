package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"reflect"
	"testing"
)

func TestStationMarkerCacheSurvivesLoadsAndInvalidatesRemoval(t *testing.T) {
	catalog, err := definitions.Load()
	if err != nil {
		t.Fatal(err)
	}
	regions := NewRegionManager(25, catalog)
	before := regions.Query(Vec.Vector{}, nil)
	if len(before.StationMarkers) == 0 {
		t.Fatal("missing station marker fixture")
	}
	cached := len(regions.stationLists)
	regions.Load(Vec.Vector{X: -20, Y: -20})
	if len(regions.stationLists) != cached {
		t.Fatal("region load discarded immutable station markers")
	}
	after := regions.Query(Vec.Vector{}, nil)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("region load changed the regional view")
	}
	removed := before.StationMarkers[0].ID
	regions.Remove(removed)
	after = regions.Query(Vec.Vector{}, nil)
	for _, station := range after.StationMarkers {
		if station.ID == removed {
			t.Fatal("removed marker survived the cache")
		}
	}
}
