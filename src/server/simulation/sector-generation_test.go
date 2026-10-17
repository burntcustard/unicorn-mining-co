package simulation

import (
	"encoding/json"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"os"
	"reflect"
	"testing"
)

func TestTypeScriptSectors(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/regions.json")

	if err != nil {
		t.Fatal(err)
	}

	var fixtures struct {
		Sectors []struct {
			WorldSeed uint32
			Map       SectorMap
			Samples   []struct {
				SectorID    string
				Region      Vec.Vector
				Description protocol.RegionDescription
			}
			Densities []struct {
				SectorID string
				Position Vec.Vector
				Values   []float64
			}
		}
	}

	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}

	if len(fixtures.Sectors) == 0 {
		t.Fatal("sector fixtures are missing")
	}

	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, fixture := range fixtures.Sectors {
		world := GenerateSectorMap(fixture.WorldSeed, catalog)

		if !reflect.DeepEqual(world, fixture.Map) {
			actual, _ := json.Marshal(world)
			expected, _ := json.Marshal(fixture.Map)
			t.Fatalf("seed %d map differs\nactual: %s\nexpected: %s", fixture.WorldSeed, actual, expected)
		}

		sectors := map[string]Sector{}
		generators := map[string]*RegionGenerator{}

		for _, sector := range world.Sectors {
			sectors[sector.ID] = sector
			generators[sector.ID] = NewRegionGenerator(catalog, sector)
		}

		for pass := range 2 {
			for i := range fixture.Samples {
				if pass == 1 {
					i = len(fixture.Samples) - 1 - i
				}

				sample := fixture.Samples[i]
				actual := generators[sample.SectorID].GenerateRegion(fixture.WorldSeed, sample.Region)

				if !reflect.DeepEqual(actual, sample.Description) {
					got, _ := json.Marshal(actual)
					want, _ := json.Marshal(sample.Description)
					t.Fatalf("seed %d sector %s region %+v differs\ngot %s\nwant %s", fixture.WorldSeed, sample.SectorID, sample.Region, got, want)
				}
			}
		}

		for _, sample := range fixture.Densities {
			sector := sectors[sample.SectorID]

			for kind, expected := range sample.Values {
				if actual := SectorDensity(&sector, sample.Position, kind, catalog.SectorGeneration); actual != expected {
					t.Fatalf("seed %d sector %s density %d = %.12f, want %.12f", fixture.WorldSeed, sample.SectorID, kind, actual, expected)
				}
			}
		}
	}
}
