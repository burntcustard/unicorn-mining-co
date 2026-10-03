package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	"reflect"
	"testing"
)

type contactHandlerRecorder struct {
	*GameObject
	order *[]string
	seen  [][]collision.Contact
}

func (e *contactHandlerRecorder) HandleContacts(contacts []collision.Contact, _ *[]protocol.SimulationEvent, _ *World, _ float64) {
	*e.order = append(*e.order, e.Kind)
	e.seen = append(e.seen, append([]collision.Contact{}, contacts...))
}

type contactWorldRecorder struct{ contacts []collision.Contact }

func (*contactWorldRecorder) CapturePoses(*utilities.OrderedMap[int64, Entity]) {}
func (c *contactWorldRecorder) Step(*utilities.OrderedMap[int64, Entity], float64, *[]protocol.SimulationEvent) []collision.Contact {
	return c.contacts
}

func TestGameplayContactDispatch(t *testing.T) {
	catalog, err := definitions.Load()
	if err != nil {
		t.Fatal(err)
	}
	world := CreateWorld(25, catalog)
	order := []string{}
	ship := &contactHandlerRecorder{GameObject: NewGameObject(ObjectProperties{}, catalog.Simulation), order: &order}
	ship.Kind = "ship"
	station := &contactHandlerRecorder{GameObject: NewGameObject(ObjectProperties{}, catalog.Simulation), order: &order}
	station.Kind = "station"
	asteroid := NewGameObject(ObjectProperties{}, catalog.Simulation)
	asteroid.Kind = "asteroid"
	contact := func(a, b Entity, depth float64) collision.Contact {
		return collision.Contact{Collider: &collision.Collider{Owner: a}, Other: &collision.Collider{Owner: b}, Depth: depth}
	}
	first := contact(ship, asteroid, 1)
	second := contact(station, asteroid, 2)
	third := contact(ship, station, 3)
	collisions := &contactWorldRecorder{contacts: []collision.Contact{first, second, third}}
	world.Collisions = collisions
	for range 2 {
		UpdateWorld(world, UpdateWorldOptions{DT: new(0.0)})
	}
	if !reflect.DeepEqual(order, []string{"station", "ship", "station", "ship"}) {
		t.Fatalf("changed callback ordering: %v", order)
	}
	if !reflect.DeepEqual(ship.seen, [][]collision.Contact{{first, third}, {first, third}}) || !reflect.DeepEqual(station.seen, [][]collision.Contact{{second, third}, {second, third}}) {
		t.Fatal("contact ordering changed or contacts leaked across ticks")
	}
	collisions.contacts = nil
	UpdateWorld(world, UpdateWorldOptions{DT: new(0.0)})
	if len(order) != 4 {
		t.Fatal("callbacks retained contacts from a previous tick")
	}
}
