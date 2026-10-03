package simulation

import (
	"encoding/json"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"os"
	"reflect"
	"testing"
)

func TestTypeScriptRegions(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/regions.json")

	if err != nil {
		t.Fatal(err)
	}

	var fixtures struct {
		Regions []struct {
			WorldSeed   uint32
			Region      Vec.Vector
			Description protocol.RegionDescription
		}
		Stations []struct {
			WorldSeed uint32
			From, To  Vec.Vector
			Stations  []protocol.StationDescription
		}
		Messages []struct {
			Position Vec.Vector
			Resource int
			Message  string
		}
	}

	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}

	spec, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	g := NewRegionGenerator(spec)

	for pass := range 2 {
		for i := range fixtures.Regions {
			index := i

			if pass == 1 {
				index = len(fixtures.Regions) - 1 - i
			}

			sample := fixtures.Regions[index]
			actual := g.GenerateRegion(sample.WorldSeed, sample.Region)

			if !reflect.DeepEqual(actual, sample.Description) {
				got, _ := json.Marshal(actual)
				want, _ := json.Marshal(sample.Description)
				t.Fatalf("pass %d seed %d region %+v\ngot %s\nwant %s", pass, sample.WorldSeed, sample.Region, got, want)
			}

			// Changing a returned region must not change the immutable candidate cache.
			if len(actual.Asteroids) > 0 {
				actual.Asteroids[0].Position.X = 999

				if len(actual.Asteroids[0].Contents) > 0 {
					actual.Asteroids[0].Contents[0] = -999
				}
			}

			if len(actual.Stations) > 0 {
				actual.Stations[0].Position.X = 999
			}

			if len(actual.Wrecks) > 0 {
				actual.Wrecks[0].CargoContents[0] = -999
			}
		}
	}

	for _, sample := range fixtures.Stations {
		actual := g.GenerateStations(sample.WorldSeed, sample.From, sample.To)

		if !reflect.DeepEqual(actual, sample.Stations) {
			t.Fatalf("station seed %d differs", sample.WorldSeed)
		}
	}

	for _, sample := range fixtures.Messages {
		if got := FieldMessage(sample.Position, sample.Resource); got != sample.Message {
			t.Errorf("message %q want %q", got, sample.Message)
		}
	}
}
