package npc

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestVisibilityUsesRangeAndAsteroidCover(t *testing.T) {
	ship := flightShip(t)
	other := objects.CreatePlayerShip(ship.World, objects.Properties{PlayerID: new(int64(2))})
	simulation.AddEntity(ship.World, other)
	rock := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: ship.World, Position: Vec.Create(600, 0), Radius: new(100.0), ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-90, -30}, {90, -30}, {90, 30}, {-90, 30}}}}}, ship.World)
	simulation.AddEntity(ship.World, rock)

	for _, scenario := range []struct {
		name             string
		distance         float64
		covered, visible bool
	}{
		{"nearby through rock", 999, true, true},
		{"sensor boundary", 1000, true, true},
		{"beyond sensor behind rock", 1000.01, true, false},
		{"distant behind rock", 1490, true, false},
		{"distant clear", 1200, false, true},
		{"sight boundary", 1500, false, true},
		{"beyond sight", 1500.01, false, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			other.Position = Vec.Create(scenario.distance, 0)
			rock.Position.Y = 300

			if scenario.covered {
				rock.Position.Y = 0
			}

			rock.Rotation = math.Pi / 3

			if CanSee(ship, other) != scenario.visible {
				t.Fatal("visibility did not match range and cover")
			}
		})
	}

	other.Position = Vec.Create(1200, 0)
	rock.Remove()

	if !CanSee(ship, other) {
		t.Fatal("destroyed rock still obscured the player")
	}

	other.DockedTo = new(int64(99))

	if CanSee(ship, other) {
		t.Fatal("docked player remained visible")
	}

	other.DockedTo = nil
	other.TransitTime = 1

	if CanSee(ship, other) {
		t.Fatal("a player in transit remained visible")
	}

	other.TransitTime = 0
	other.Remove()

	if CanSee(ship, other) {
		t.Fatal("a removed player remained visible")
	}
}

func TestVisibilityUsesRemainingRockRatherThanItsRadius(t *testing.T) {
	ship := flightShip(t)
	other := objects.CreatePlayerShip(ship.World, objects.Properties{PlayerID: new(int64(2)), Position: Vec.Create(1200, 0)})
	simulation.AddEntity(ship.World, other)

	segment := func(bottom, top float64) *simulation.AsteroidSegment {
		return &simulation.AsteroidSegment{Health: 10, MaxHealth: 10, Mass: 1, ShapeOutline: &simulation.ShapeOutline{Points: []simulation.Point{{-100, bottom}, {100, bottom}, {100, top}, {-100, top}}}}
	}

	rock := simulation.NewAsteroid(simulation.AsteroidProperties{ObjectProperties: simulation.ObjectProperties{World: ship.World, Position: Vec.Create(600, 0), Radius: new(160.0)}, Segments: []*simulation.AsteroidSegment{segment(-120, -20), segment(20, 120)}}, ship.World)
	simulation.AddEntity(ship.World, rock)

	if !CanSee(ship, other) {
		t.Fatal("the mined gap between surviving segments blocked sight")
	}

	rock.Rotation = math.Pi / 2

	if CanSee(ship, other) {
		t.Fatal("rotated surviving rock failed to obscure the player")
	}
}
