package objects

import (
	"math"
	"slices"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

func TestCourserShieldOutfitting(t *testing.T) {
	catalog, err := specs.Load()
	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "courser"})
	station := CreateStation(Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
	simulation.AddEntity(world, station)
	ship.DockedTo = &station.ID
	credits := 10000.0

	for index, mount := range ship.Mounts() {
		if !slices.Contains(mount.Fits, "shieldGeneratorXs") {
			continue
		}

		if mount.Module != nil || mount.LocalPosition.Y != 0 {
			t.Fatal("Courser must have an empty central shield mount")
		}

		action := protocol.DockAction{Action: "buy", Module: int64(slices.Index(catalog.ModuleIDs, "shieldGeneratorXs")), HasMount: true, Mount: int64(index)}

		if _, ok := ship.ApplyDockAction(action, &credits); !ok {
			t.Fatal("station must offer an XS shield for the Courser")
		}

		if mount.Module == nil || mount.Module.ModuleBase().Type != "shieldGeneratorXs" {
			t.Fatal("purchased shield must equip on the central mount")
		}

		return
	}

	t.Fatal("Courser is missing its XS shield mount")
}

func TestCourserCannons(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)

	if ship.CargoSpace != 8 {
		t.Fatal("Courser must have eight cargo spaces")
	}

	if ship.Engine() == nil || ship.Engine().ModuleBase().Type != "thrusterSingleSm" {
		t.Fatal("Courser must start with its compatible small thruster")
	}

	if ship.Engine().ModuleBase().Mount.Hull.HullPlan != ship.HullSegments[2] {
		t.Fatal("thruster must be mounted to the rear rectangular hull segment")
	}

	ammo := NewItem("autogunAmmo", simulation.ObjectProperties{World: world}, catalog)
	ship.CargoContents = append(ship.CargoContents, ammo)
	events := []protocol.SimulationEvent{}
	ship.Control(protocol.Input{AutogunActive: true, CargoHatch: true, Fire: true}, &events)
	ship.UpdateModules(1)

	if !ship.ModuleActive("cannonSm") || !ship.ModuleActive("cargoHatch") {
		t.Fatal("normal autogun and cargo controls must activate Courser modules")
	}

	shots := func() int {
		count := 0

		world.Entities.ForEach(func(entity simulation.Entity, _ int64) {
			if shot, ok := entity.(*Projectile); ok {
				count++

				if shot.DefinitionID != "cannonSm" || shot.Health != catalog.ModuleSpecs["autogun"].Damage || shot.Radius != catalog.ModuleSpecs["autogun"].Projectile.Radius {
					t.Fatal("cannons must fire autogun projectiles")
				}
			}
		})

		return count
	}

	rounds := *ammo.Rounds
	ship.fireWeapons(0)

	for range 119 {
		ship.fireWeapons(1.0 / 120)
	}

	if shots() != 2 {
		t.Fatal("each cannon must fire once within a second")
	}

	ship.fireWeapons(1.0 / 120)

	if shots() != 4 || *ammo.Rounds != rounds-4 {
		t.Fatal("both cannons must fire again after one second and consume four rounds")
	}

	ship.Control(protocol.Input{Fire: true}, &events)
	ship.fireWeapons(1)

	if shots() != 4 {
		t.Fatal("turning off the autogun control must disable both cannons")
	}

	restored, err := RestoreShip(CaptureShip(ship), world, 1)

	if err != nil || restored.DefinitionID != "courser" || len(restored.Modules()) != 5 {
		t.Fatalf("Courser and its new modules must survive persistence: %v", err)
	}

	for _, mount := range ship.Mounts() {
		for _, id := range mount.Fits {
			if catalog.ModuleSpecs[id].Behavior == "thruster" && id != "thrusterSingleSm" {
				t.Fatal("Courser must fit only the small single thruster")
			}
		}
	}
}

func TestCourserCargoHatchPair(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "courser", PlayerID: new(int64(1))})
	simulation.AddEntity(world, ship)
	ship.SetModuleActive("cargoHatch", true)
	ship.UpdateModules(1)
	doors := 0

	for _, segment := range ship.Segments {
		if segment.Module == nil || segment.Module.ModuleBase().Type != "cargoHatchPair" || segment.Catches {
			continue
		}

		side := -1.0

		if doors == 1 {
			side = 1
		}

		doors++

		for _, progress := range []float64{0, .5, 1} {
			segment.ActivationProgress = progress
			points := segment.Outline().Points
			hinge := specs.Point{(points[0][0] + points[3][0]) / 2, (points[0][1] + points[3][1]) / 2}
			tip := specs.Point{(points[1][0] + points[2][0]) / 2, (points[1][1] + points[2][1]) / 2}

			if hinge != (specs.Point{0, side * 8}) || math.Abs(math.Hypot(tip[0]-hinge[0], tip[1]-hinge[1])-8) > 1e-9 {
				t.Fatal("each half-door must stay attached to its outer hinge")
			}

			if progress == 0 && tip != (specs.Point{0, 0}) || progress == 1 && (math.Abs(tip[0]-8) > 1e-9 || math.Abs(tip[1]-side*8) > 1e-9) {
				t.Fatal("doors must meet when closed and open forward by 90 degrees")
			}
		}
	}

	if doors != 2 {
		t.Fatal("paired hatch requires two doors")
	}

	var throat *collision.Collider

	for _, collider := range ship.Hitbox() {
		if segment, ok := collider.Segment.(*simulation.Segment); ok && segment.Catches {
			throat = collider
			break
		}
	}

	if throat == nil {
		t.Fatal("paired hatch must expose a cargo pickup throat")
	}

	item := NewItem("diamond", simulation.ObjectProperties{World: world, Position: throat.Position}, catalog)
	simulation.AddEntity(world, item)
	events := []protocol.SimulationEvent{}
	ship.HandleContacts([]collision.Contact{{Collider: throat, Other: modules.CargoPickupPoint(item)}}, &events, world, 0)

	if !slices.Contains(ship.CargoContents, simulation.Entity(item)) || world.Entities.Has(item.ID) || len(events) != 1 {
		t.Fatal("paired hatch must collect cargo through the normal contact path")
	}
}

func TestCourserCannonsNotForSale(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{DefinitionID: "courser"})
	station := CreateStation(Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
	simulation.AddEntity(world, station)
	ship.DockedTo = &station.ID
	credits := 10000.0
	id := int64(slices.Index(catalog.ModuleIDs, "cannonSm"))
	ship.Fit(nil, ship.Mounts()[0])

	for _, action := range []protocol.DockAction{
		{Action: "buy", Module: id},
		{Action: "buy", Module: id, HasMount: true, Mount: 0},
	} {
		if _, ok := ship.ApplyDockAction(action, &credits); ok || credits != 10000 {
			t.Fatal("stations must reject cannon purchases for cargo and mounts")
		}
	}

	cannon := modules.Create("cannonSm", simulation.ObjectProperties{World: world}, catalog)
	ship.CargoContents = append(ship.CargoContents, cannon)

	if _, ok := ship.ApplyDockAction(protocol.DockAction{Action: "sell", ObjectIDs: []int64{cannon.Base().ID}}, &credits); !ok {
		t.Fatal("owned cannons can be sold")
	}

	if slices.Contains(station.CargoContents, simulation.Entity(cannon)) {
		t.Fatal("sold cannons must never become station stock")
	}

	station.CargoContents = append(station.CargoContents, cannon)
	before := credits

	if _, ok := ship.ApplyDockAction(protocol.DockAction{Action: "buyStock", ObjectIDs: []int64{cannon.Base().ID}}, &credits); ok || credits != before {
		t.Fatal("station stock purchases must also reject cannons")
	}
}

func TestMinedCargoPersistsAndPurchasesClearOrigin(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	ship := CreatePlayerShip(world, Properties{PlayerID: new(int64(1))})
	id := simulation.EntityID(world)
	item := NewItem("diamond", simulation.ObjectProperties{World: world, ID: &id}, catalog)
	item.Mined = true
	ship.CargoContents = append(ship.CargoContents, item)
	restored, err := RestoreShip(CaptureShip(ship), world, 1)

	if err != nil || restored.MinedCargoValue() != item.Price {
		t.Fatalf("mined origin did not survive persistence: %v", err)
	}

	station := CreateStation(Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
	simulation.AddEntity(world, station)
	station.CargoContents = append(station.CargoContents, item)
	restored.DockedTo = &station.ID
	restored.CargoContents = nil
	credits := 10000.0

	if _, ok := restored.ApplyDockAction(protocol.DockAction{Action: "buyStock", ObjectIDs: []int64{item.ID}}, &credits); !ok {
		t.Fatal("fixture could not buy mineral stock")
	}

	if restored.MinedCargoValue() != 0 {
		t.Fatal("station purchase still counted as mined cargo")
	}
}
