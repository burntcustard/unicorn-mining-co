package simulation

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestSectorMapStationsIncludeEntireSectorAndRespectRemoval(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	checked := 0

	for _, seed := range []uint32{0, 25, 52} {
		world := GenerateSectorMap(seed, catalog)

		for _, sector := range world.Sectors[:8] {
			manager := NewRegionManager(seed, catalog, sector)
			stations := manager.MapStations()
			density := catalog.SectorGeneration.Density[1]
			extent := (max(sector.RadiusX, sector.RadiusY)*density.Scale*density.Cutoff + 1) * 2
			expected := manager.generator.GenerateStations(seed, Vec.Create(-extent, -extent), Vec.Create(extent, extent))

			if len(stations) != len(expected) {
				t.Fatalf("sector %s seed %d: got %d stations, want %d", sector.ID, seed, len(stations), len(expected))
			}

			if len(stations) == 0 {
				continue
			}

			checked++
			removed := stations[0].ID
			manager.Remove(uint32(removed))

			for _, station := range manager.MapStations() {
				if station.ID == removed {
					t.Fatal("destroyed station remained on the map")
				}
			}

			restored := NewRegionManager(seed, catalog, sector)
			restored.Remove(uint32(removed))

			for _, station := range restored.MapStations() {
				if station.ID == removed {
					t.Fatal("previously destroyed station returned on the map")
				}
			}

			if len(manager.generator.candidateRegions) != 0 || len(manager.saved) != 0 || manager.loaded.Len() != 0 {
				t.Fatal("map query generated or loaded asteroid regions")
			}
		}
	}

	if checked == 0 {
		t.Fatal("fixtures have no stations")
	}
}
