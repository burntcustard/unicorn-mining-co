package npc_test

import (
	"bytes"
	"github.com/burntcustard/unicorn-mining-co/src/server/npc"
	"github.com/burntcustard/unicorn-mining-co/src/server/npc/testhost"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
	"testing"
)

func TestDialogVariantsAreSharedByRecipients(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	host := testhost.New(25, catalog)
	first, second := host.AddPlayer(), host.AddPlayer()
	disconnected, removed := host.AddPlayer(), host.AddPlayer()
	disconnected.Online = false
	host.World().Players.Delete(removed.ID)
	state := host.World().Random.State

	for range 64 {
		host.Controls, first.Controls, second.Controls = nil, nil, nil
		npc.Chat(host, first.Craft, "friendly", []string{"First {player}", "Second {player}"}, "{player}", "variant")

		if len(host.Controls) != 1 || len(first.Controls) != 1 || len(second.Controls) != 1 {
			t.Fatal("one selected variant must be broadcast once to every active recipient")
		}

		message := first.Controls[0]

		if !slices.Contains([]string{"First variant", "Second variant"}, message.Text) || message.Sender != first.Craft.Name || message.SenderRole != "friendly" || message.Type != "chat" || message.Channel != 0 {
			t.Fatal("chat must contain one complete, formatted variant and its sender")
		}

		encoded, err := protocol.EncodeServerControl(message, catalog.Protocol)
		other, otherErr := protocol.EncodeServerControl(second.Controls[0], catalog.Protocol)

		if err != nil || otherErr != nil || !bytes.Equal(encoded, other) {
			t.Fatal("recipients received different variants")
		}
	}

	if len(disconnected.Controls) != 0 || len(removed.Controls) != 0 {
		t.Fatal("speech reached a disconnected or absent player")
	}

	if host.World().Random.State != state {
		t.Fatal("speech changed the simulation's random sequence")
	}

	if npc.DialogText(nil) != "" {
		t.Fatal("an empty dialogue list produced text")
	}
}

func cargoFixture(t testing.TB) (*testhost.Host, *testhost.Human) {
	t.Helper()
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	host := testhost.New(25, catalog)
	human := host.AddPlayer()
	home := host.NearestStation(human.Craft.Position)
	human.Craft.Position = Vec.Add(home.Position, Vec.Create(home.Radius+650, 0))
	human.Craft.Face(math.Pi)

	for range 7 {
		item := objects.NewItem("gold", simulation.ObjectProperties{World: host.Simulation, ID: new(simulation.EntityID(host.Simulation))}, catalog)
		item.Mined = true
		human.Craft.CargoContents = append(human.Craft.CargoContents, item)
	}

	return host, human
}

func TestCargoReleaseRepeatsEveryHalfSecondWhileHeld(t *testing.T) {
	s, p := cargoFixture(t)
	p.Input = protocol.Input{CargoHatch: true}

	for range 30 {
		s.Tick(1)
	}

	p.Input = protocol.Input{CargoHatch: true, CargoRelease: true}
	s.Tick(1)

	if len(p.Craft.CargoContents) != 6 {
		t.Fatal("activating release should immediately eject one item through an open hatch")
	}

	for range 14 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) != 6 {
		t.Fatal("the next item was released before half a second elapsed")
	}

	s.Tick(1)

	if len(p.Craft.CargoContents) != 5 {
		t.Fatal("holding release should eject the next item after half a second")
	}

	p.Input = protocol.Input{CargoHatch: true}

	for range 30 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) != 5 {
		t.Fatal("cargo continued releasing after keyup")
	}
}

func TestCargoReleaseStartsFromActivatedBinding(t *testing.T) {
	s, p := cargoFixture(t)
	// The client applies the selected activation mode before sending input.
	p.Input = protocol.Input{CargoRelease: true}

	for range 30 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) >= 7 {
		t.Fatal("activated release binding did not eject cargo")
	}

	remaining := len(p.Craft.CargoContents)
	p.Input = protocol.Input{CargoHatch: true}

	for range 10 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) != remaining {
		t.Fatal("deactivating the release binding did not stop cargo release")
	}

	p.Input = protocol.Input{CargoHatch: true, CargoRelease: true}

	for range 90 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) != 0 {
		t.Fatal("staggered release did not finish while activated")
	}

	count := 0

	s.Simulation.Entities.ForEach(func(e simulation.Entity, _ int64) {
		if e.Base().DroppedBy != nil && *e.Base().DroppedBy == p.ID {
			count++
		}
	})

	if count != 7 {
		t.Fatalf("cargo release created %d objects, want 7", count)
	}

	for range 60 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) != 0 {
		t.Fatal("release immediately recollected its cargo")
	}

	id := simulation.EntityID(s.Simulation)
	item := objects.NewItem("gold", simulation.ObjectProperties{World: s.Simulation, ID: &id}, s.Simulation.Specification)
	p.Craft.CargoContents = append(p.Craft.CargoContents, item)

	for range 30 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) != 0 {
		t.Fatal("holding release did not release newly collected cargo")
	}

	p.Input = protocol.Input{CargoHatch: true}
	s.Tick(1)
	id = simulation.EntityID(s.Simulation)
	item = objects.NewItem("gold", simulation.ObjectProperties{World: s.Simulation, ID: &id}, s.Simulation.Specification)
	p.Craft.CargoContents = append(p.Craft.CargoContents, item)

	for range 30 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) != 1 {
		t.Fatal("releasing the key did not stop subsequent cargo release")
	}

	p.Input = protocol.Input{CargoHatch: true, CargoRelease: true}

	for range 30 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) != 0 {
		t.Fatal("a new activation did not release the next cargo batch")
	}
}

func TestCargoReleaseRetainsModulesAndOpenedAmmo(t *testing.T) {
	s, p := cargoFixture(t)
	module := modules.Create("thrusterSingleSm", simulation.ObjectProperties{World: s.Simulation}, s.Simulation.Specification)
	partialID, fullID := simulation.EntityID(s.Simulation), simulation.EntityID(s.Simulation)
	partial := objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: s.Simulation, ID: &partialID}, s.Simulation.Specification)
	partial.Rounds = new(117)
	full := objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: s.Simulation, ID: &fullID}, s.Simulation.Specification)
	p.Craft.CargoContents = append(p.Craft.CargoContents, module, partial, full)
	p.Input = protocol.Input{CargoRelease: true}

	for ticks := 0; ticks < 30 && len(p.Craft.CargoContents) == 10; ticks++ {
		s.Tick(1)
	}

	if !p.Craft.ModuleActive("cargoHatch") {
		t.Fatal("release did not activate closed cargo hatches")
	}

	if len(p.Craft.CargoContents) != 9 {
		t.Fatal("cargo was not released one item at a time")
	}

	var first simulation.Entity

	s.Simulation.Entities.ForEach(func(entity simulation.Entity, _ int64) {
		if entity.Base().DroppedBy != nil {
			first = entity
		}
	})

	if first == nil {
		t.Fatal("no first item emerged")
	}

	atHatch := false

	for _, segment := range p.Craft.Segments {
		if segment.Catches {
			position := Vec.Add(p.Craft.Position, simulation.RotatePoint(segment.LocalPosition, p.Craft.Rotation))
			atHatch = atHatch || Vec.Distance(position, first.Base().Position) < first.Base().Radius+6
		}
	}

	if !atHatch {
		t.Fatal("item did not emerge at an open cargo hatch")
	}

	p.Input = protocol.Input{CargoHatch: true, CargoRelease: true}

	for range 120 {
		s.Tick(1)
	}

	if len(p.Craft.CargoContents) != 2 || !slices.Contains(p.Craft.CargoContents, simulation.Entity(module)) || !slices.Contains(p.Craft.CargoContents, simulation.Entity(partial)) {
		t.Fatal("release did not preserve modules and the partial ammunition pack")
	}

	if !s.Simulation.Entities.Has(full.ID) || *partial.Rounds != 117 || *full.Rounds != 200 {
		t.Fatal("release changed ammunition or kept a full pack")
	}
}

type launchEnvironment struct {
	*testhost.Host
	beforeSync func()
}

func (env *launchEnvironment) SyncRegions() {
	env.beforeSync()
	env.Host.SyncRegions()
}

func TestNPCLaunchSaleAndRemovalUseOrdinaryShipMechanics(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, definition := range []string{"finch", "courser"} {
		t.Run(definition, func(t *testing.T) {
			host := testhost.New(25, catalog)
			home := host.NearestStation(Vec.Vector{})
			credits := 500.0
			hostile := definition == "courser"
			var configured *objects.Ship
			var ammunition *objects.Item

			env := &launchEnvironment{Host: host, beforeSync: func() {
				if configured == nil || !host.World().Entities.Has(configured.ID) || !host.World().Players.Has(*configured.PlayerID) || len(configured.CargoContents) != 1 || configured.CargoContents[0] != ammunition {
					t.Fatal("region loading ran before registering the configured ship and cargo")
				}
			}}

			ship := npc.Spawn(env, npc.SpawnOptions{
				DefinitionID: definition, Name: "Test pilot", Home: home, Credits: &credits, Hostile: hostile,
				Configure: func(ship *objects.Ship) {
					if ship.DefinitionID != definition || ship.Name != "Test pilot" || ship.Hostile != hostile || ship.PlayerID == nil || ship.DockedTo == nil || host.World().Entities.Has(ship.ID) || ship.Launching != 0 {
						t.Fatal("configuration did not receive the initialized ship before registration and launch")
					}

					configured = ship
					ammunition = objects.NewItem("autogunAmmo", simulation.ObjectProperties{World: host.World(), ID: new(simulation.EntityID(host.World()))}, catalog)
					ship.CargoContents = append(ship.CargoContents, ammunition)
				},
			})

			observer, exists := host.World().Players.Get(*ship.PlayerID)
			station, loaded := host.Entity(host.StationID(home)).(*objects.Station)

			if !exists || !loaded || observer.ShipID != ship.ID || observer.Credits != &credits || observer.ObserverRange != npc.SightRange || !host.World().Entities.Has(ship.ID) {
				t.Fatal("launch did not register the ship and load its station through an observer")
			}

			if ship.Launching <= 0 || ship.DockedTo != nil || ship.Name != "Test pilot" || ship.Hostile != hostile {
				t.Fatal("launch did not preserve ordinary launch behavior and role identity")
			}

			cargo := objects.NewItem("gold", simulation.ObjectProperties{World: host.World()}, catalog)
			ship.CargoContents = append(ship.CargoContents, cargo)
			ship.DockedTo = new(station.ID)
			npc.SellCargo(ship, &credits, ammunition)

			if !slices.Contains(station.CargoContents, simulation.Entity(cargo)) || !slices.Contains(ship.CargoContents, simulation.Entity(ammunition)) || slices.Contains(ship.CargoContents, simulation.Entity(cargo)) || credits != 500+cargo.Price {
				t.Fatal("ordinary station sale did not transfer cargo, preserve ammunition, and pay its price")
			}

			host.SetInput(*ship.PlayerID, protocol.Input{Thrust: 1})
			npc.Remove(host, ship)

			if _, held := host.Inputs[*ship.PlayerID]; held || host.World().Players.Has(*ship.PlayerID) || host.World().Entities.Has(ship.ID) || ship.Dead {
				t.Fatal("removal retained the observer or input, or destroyed the returning ship")
			}
		})
	}
}
