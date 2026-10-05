package gameplay

import (
	"encoding/json"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/testtools/compare"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"os"
	"testing"
)

func recordEntity(e simulation.Entity) map[string]any {
	o := e.Base()
	var health any

	if !math.IsNaN(o.Health) {
		health = o.Health
	}

	r := map[string]any{"id": o.ID, "kind": o.Kind, "position": o.Position, "velocity": o.Velocity, "rotation": o.Rotation, "spin": o.Spin, "mass": o.Mass, "health": health, "radius": o.Radius, "pendingUpdateTime": o.PendingUpdateTime, "ballistic": IsBallistic(e)}

	if owner, ok := e.(interface{ CraftBase() *objects.Craft }); ok {
		c := owner.CraftBase()
		r["hullHealth"] = c.HullHealth()
		r["modules"] = c.ModuleStates()
		cargo := []int64{}

		for _, e := range c.CargoContents {
			cargo = append(cargo, e.Base().ID)
		}

		r["cargo"] = cargo
		segments := []any{}

		for _, s := range c.Segments {
			var health any

			if !math.IsNaN(s.Health) {
				health = s.Health
			}

			segments = append(segments, map[string]any{"health": health, "active": s.Active, "progress": s.ActivationProgress, "localPosition": s.LocalPosition})
		}

		r["segments"] = segments
	}

	if owner, ok := e.(interface{ ShipBase() *objects.Ship }); ok {
		s := owner.ShipBase()
		r["launching"] = s.Launching
		r["dockedTo"] = s.DockedTo
		r["forward"] = s.Forward
		r["turn"] = s.Turn
	}

	return r
}

func recordEvent(e protocol.SimulationEvent) map[string]any {
	switch e := e.(type) {
	case protocol.ModuleChanged:
		return map[string]any{"type": "moduleChanged", "module": e.Module, "playerId": e.PlayerID, "active": e.Active}
	case protocol.CollisionEvent:
		return map[string]any{"type": "collision", "a": e.A, "b": e.B, "impact": e.Impact, "colors": e.Colors, "damage": e.Damage, "position": e.Position}
	case protocol.DrillDamage:
		r := map[string]any{"type": "drillDamage", "targetId": e.TargetID, "by": e.By, "damage": e.Damage, "color": e.Color, "position": e.Position}

		if e.Resource != nil {
			r["resource"] = *e.Resource
		}

		return r
	case protocol.AsteroidSplit:
		return map[string]any{"type": "asteroidSplit", "asteroidId": e.AsteroidID, "childIds": e.ChildIDs}
	case protocol.AsteroidDestroyed:
		return map[string]any{"type": "asteroidDestroyed", "asteroidId": e.AsteroidID, "by": e.By, "contents": e.Contents}
	case protocol.Docked:
		return map[string]any{"type": "docked", "playerId": e.PlayerID, "dockedTo": e.DockedTo}
	case protocol.ItemCollected:
		r := map[string]any{"type": "itemCollected", "by": e.By, "itemId": e.ItemID, "resource": e.Resource}

		if e.Message != nil {
			r["message"] = *e.Message
			r["unlock"] = *e.Unlock
		}

		return r
	default:
		panic("unrecorded event")
	}
}

func TestTypeScriptGameplay(t *testing.T) {
	data, err := os.ReadFile("../../../tests/fixtures/gameplay.json")

	if err != nil {
		t.Fatal(err)
	}

	var cases []struct {
		Name         string
		Engine       string
		Count, Ticks int
		Snapshots    []struct {
			Tick                       int
			Events, Entities, Contacts json.RawMessage
			NextEntityID               int64
		}
	}

	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}

	catalog, err := definitions.Load()

	if err != nil {
		t.Fatal(err)
	}

	for _, scenario := range cases {
		t.Run(scenario.Name, func(t *testing.T) {
			world := simulation.CreateWorld(25, catalog)
			world.Collisions = NewGameCollisions(catalog)
			world.ItemTypes = objects.ItemTypes(catalog)

			for i := 0; i < scenario.Count; i++ {
				position := Vec.Vector{}
				rotation := 0.0

				switch scenario.Name {
				case "flight":
					position = Vec.Create(float64(i*5000), float64(i*2000))
				case "convoy":
					position = Vec.Create(float64(i*120), 0)
				case "contact":
					position = Vec.Create(float64(i*65), 0)

					if i%2 != 0 {
						rotation = math.Pi
					}
				}

				id := int64(i + 1)
				ship := objects.CreatePlayerShip(world, objects.Properties{ID: &id, PlayerID: &id, Position: position, Rotation: rotation})
				simulation.AddEntity(world, ship)
				moduleID := int64(-2000)

				if scenario.Name == "shield" {
					ship.Fit(modules.NewShieldGenerator(simulation.ObjectProperties{ID: &moduleID}, catalog), nil)
				}

				if scenario.Engine != "" {
					ship.Fit(modules.Create(scenario.Engine, simulation.ObjectProperties{ID: &moduleID}, catalog), nil)
					ship.Launch()
				}

				for index, m := range ship.Modules() {
					m.Base().ID = int64(-1000 - i*100 - index)
				}

				simulation.AddPlayer(world, simulation.Player{ID: id, ShipID: id})
			}

			id := int64(100)

			if scenario.Name == "drill" {
				radius := 25.0
				simulation.AddEntity(world, simulation.CreateAsteroid(world, simulation.AsteroidProperties{ID: &id, Position: Vec.Create(85, 0), Radius: &radius, Contents: []int{0, 1}}).LockGeometry())
			}

			if scenario.Name == "shield" {
				simulation.AddEntity(world, objects.NewItem("diamond", simulation.ObjectProperties{ID: &id, World: world, Position: Vec.Create(54, 0)}, catalog))
			}

			if scenario.Name == "docking" {
				simulation.AddEntity(world, objects.CreateStation(objects.Properties{ID: &id, World: world, Spin: 0.05}, catalog))
			}

			snapshot := 0

			for tick := 0; tick < scenario.Ticks; tick++ {
				inputs := map[int64]protocol.InputFrame{}

				world.Players.ForEach(func(p simulation.Player, _ int64) {
					input := protocol.Input{ShieldGenerator: scenario.Name == "shield" && tick < 90, HornDrill: scenario.Name == "drill", CargoHatch: tick%120 < 60, SearchLight: tick%180 < 90}

					if scenario.Name != "docking" && scenario.Name != "shield" && tick%100 < 70 {
						input.Thrust = 1
					}

					if scenario.Name == "flight" {
						if tick%180 < 60 {
							input.Turn = -1
						} else if tick%180 < 120 {
							input.Turn = 1
						}
					}

					inputs[p.ID] = protocol.InputFrame{Input: input}
				})

				events := simulation.UpdateWorld(world, simulation.UpdateWorldOptions{Inputs: inputs})

				if snapshot < len(scenario.Snapshots) && scenario.Snapshots[snapshot].Tick == tick {
					expected := scenario.Snapshots[snapshot]
					contacts := []any{}

					for _, c := range world.Collisions.(*GameCollisions).contacts {
						contacts = append(contacts, map[string]any{"a": c.Collider.Owner.(simulation.Entity).Base().ID, "b": c.Other.Owner.(simulation.Entity).Base().ID, "depth": c.Depth, "point": c.Point, "normal": c.Normal})
					}

					compare.JSON(t, fmt.Sprintf("tick%d.contacts", tick), contacts, expected.Contacts, 2e-8)

					if world.NextEntityID != expected.NextEntityID {
						t.Fatalf("tick %d next ID got %d want %d", tick, world.NextEntityID, expected.NextEntityID)
					}

					entities := []any{}

					world.Entities.ForEach(func(e simulation.Entity, _ int64) { entities = append(entities, recordEntity(e)) })

					recorded := []any{}

					for _, e := range events {
						recorded = append(recorded, recordEvent(e))
					}

					compare.JSON(t, fmt.Sprintf("tick%d.events", tick), recorded, expected.Events, 2e-8)
					compare.JSON(t, fmt.Sprintf("tick%d.entities", tick), entities, expected.Entities, 2e-8)
					snapshot++
				}
			}

			if snapshot != len(scenario.Snapshots) {
				t.Fatal("unread snapshots")
			}
		})
	}
}
