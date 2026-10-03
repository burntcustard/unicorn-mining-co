package physics

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision/shape"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"testing"
)

func TestContactPoolPreservesFIFO(t *testing.T) {
	catalog, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := NewWorld(catalog.Simulation)
	fixtures := make([]*Fixture, 4)

	for i := range fixtures {
		fixtures[i] = world.CreateBody().CreateFixture(shape.NewCircle(Vec.Vector{}, 10), FixtureOpt{})
	}

	world.CreateContact(fixtures[0], fixtures[1])
	first := world.ContactList
	world.CreateContact(fixtures[2], fixtures[3])
	second := world.ContactList
	world.DestroyContact(first)
	world.DestroyContact(second)
	world.CreateContact(fixtures[0], fixtures[2])

	if world.ContactList != first {
		t.Fatal("first freed contact was not reused first")
	}

	world.CreateContact(fixtures[1], fixtures[3])

	if world.ContactList != second {
		t.Fatal("second freed contact was not reused second")
	}

	if world.contactPoolHead != nil || world.contactPoolTail != nil {
		t.Fatal("empty pool retains a link")
	}

	world.DestroyContact(first)
	world.CreateContact(fixtures[0], fixtures[3])

	if world.ContactList != first || first.Next != second || second.Prev != first {
		t.Fatal("reused contact corrupted live contact order")
	}
}
