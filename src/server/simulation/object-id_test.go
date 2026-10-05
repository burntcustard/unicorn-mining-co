package simulation

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
)

func TestObjectIDsBelongToWorld(t *testing.T) {
	catalog, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	first, second := CreateWorld(25, catalog), CreateWorld(25, catalog)

	for _, want := range []int64{-1, -2, -3} {
		object := NewGameObject(ObjectProperties{World: first}, catalog.Simulation)

		if object.ID != want {
			t.Fatalf("object ID = %d, want %d", object.ID, want)
		}
	}

	if second.NextObjectID != 0 || NewGameObject(ObjectProperties{World: second}, catalog.Simulation).ID != -1 {
		t.Fatal("one world changed another world's counter")
	}

	// Restore counters once; explicit saved IDs consume no new IDs.
	first.NextObjectID = -100
	savedID := int64(-50)
	restored := NewGameObject(ObjectProperties{World: first, ID: &savedID}, catalog.Simulation)

	if restored.ID != savedID || first.NextObjectID != -100 || ObjectID(first) != -101 {
		t.Fatal("restored IDs changed the allocation sequence")
	}

	standalone := NewGameObject(ObjectProperties{ID: &savedID}, catalog.Simulation)

	if standalone.ID != savedID {
		t.Fatal("standalone object lost its explicit ID")
	}
}
