package npc_test

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/npc/testhost"
)

func TestCollectionSeeded(t *testing.T) {
	testCollections(t, testhost.CollectionCases)
}

/*
These seeds previously exposed moving cargo trapped against the Courser cannons.
Keep their physical pickups and original combined completion budget, and
exercise the same item layouts with opposing side hatches as well.
*/
func TestCollectionValidation(t *testing.T) {
	testCollections(t, []testhost.CollectionCase{
		{"seed8", 8, 180, 48},
		{"seed42", 42, 180, 40},
		{"seed73", 73, 180, 35},
		{"seed211", 211, 240, 36},
		{"seed809", 809, 240, 35},
		{"seed977", 977, 240, 65},
		{"seed2026", 2026, 300, 65},
		{"seed20261021", 20261021, 120, 72},
	})
}

func testCollections(t *testing.T, scenarios []testhost.CollectionCase) {
	t.Helper()
	paired := map[uint64]testhost.CollectionResult{}

	for _, definition := range []string{"courser", "finch"} {
		t.Run(definition, func(t *testing.T) {
			seconds, maximum := 0.0, 0.0

			for _, scenario := range scenarios {
				maximum += scenario.Maximum

				t.Run(scenario.Name, func(t *testing.T) {
					result := testhost.RunCollection(t, definition, scenario)

					if other, exists := paired[scenario.Seed]; exists {
						if !slices.Equal(result.Items, other.Items[:len(result.Items)]) || !slices.Equal(result.ItemTypes, other.ItemTypes[:len(result.ItemTypes)]) {
							t.Fatal("paired hulls changed seeded positions, rotations, or minerals")
						}
					} else {
						paired[scenario.Seed] = result
					}

					seconds += result.Seconds
					data, err := json.Marshal(result)

					if err != nil {
						t.Fatal(err)
					}

					t.Logf("collection=%s", data)

					if result.Collected != result.Expected {
						t.Fatalf("collected %d/%d items in %.2fs", result.Collected, result.Expected, result.Seconds)
					}
				})
			}

			// Tiny geometry changes alter individual contact paths. Preserve the
			// total time budget across the same layouts for each hull separately.
			if seconds > maximum {
				t.Fatalf("collection layouts took %.2fs, exceeding %.2fs", seconds, maximum)
			}
		})
	}
}
