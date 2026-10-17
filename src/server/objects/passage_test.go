package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestJumpGateEasedHullMotion(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(1, catalog)
	gate := NewPassage(world, PassageOptions{ID: 1, DestinationSector: "destination", DestinationName: "Destination"}).(*JumpGate)
	gate.Rotation = .71
	gate.Position = Vec.Create(500, 800)
	positions := []float64{0.051990532036596704, 0.5, 0.9480094679634032, 1}

	for _, target := range []float64{1, 0} {
		gate.Update(gate.Spec.StateHoldDuration / 1000)
		gate.RequestOpening(target)
		duration := gate.Spec.OpeningDuration

		if target == 0 {
			duration = gate.Spec.ClosingDuration
		}

		for _, position := range positions {
			gate.Update(duration / 4000)
			expected := position

			if target == 0 {
				expected = 1 - position
			}

			for i, collider := range gate.Hitbox() {
				offset := collider.LocalPosition.X - gate.Segments[i].Middle[0]

				if math.Abs(offset-gate.Sides[i]*gate.Spec.HalfTravel*expected) > 1e-9 {
					t.Fatalf("target %v: hull offset %v disagrees with eased position %v", target, offset, expected)
				}

				local := *collider.LocalPosition
				x := gate.Position.X + local.X*math.Cos(gate.Rotation) - local.Y*math.Sin(gate.Rotation)
				y := gate.Position.Y + local.X*math.Sin(gate.Rotation) + local.Y*math.Cos(gate.Rotation)

				if Vec.Distance(collider.Position, Vec.Create(x, y)) > 1e-9 || collider.Rotation != gate.Rotation {
					t.Fatal("gate collider did not rotate with the hull")
				}
			}
		}

		if gate.Opening != target {
			t.Fatalf("transition did not finish: got %v, want %v", gate.Opening, target)
		}
	}
}

func TestJumpGateHoldsSettledStatesBeforeQueuedTransitions(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	world := simulation.CreateWorld(1, catalog)
	gate := NewPassage(world, PassageOptions{ID: 1, DestinationSector: "destination", DestinationName: "Destination"}).(*JumpGate)
	hold := gate.Spec.StateHoldDuration / 1000
	gate.RequestOpening(1)
	gate.Update(hold - 0.01)

	if gate.Opening != 0 || gate.OpeningTarget != 0 {
		t.Fatal("new gate opened before its closed-state hold expired")
	}

	gate.RequestOpening(1)
	gate.Update(0.01)

	for _, target := range []float64{1, 0} {
		duration := gate.Spec.OpeningDuration / 1000

		if target == 0 {
			duration = gate.Spec.ClosingDuration / 1000
		}

		gate.Update(duration / 2)
		gate.RequestOpening(1 - target)

		if gate.OpeningTarget != target {
			t.Fatal("request reversed an unfinished transition")
		}

		gate.Update(duration / 2)

		if gate.Opening != target || gate.OpeningTarget != target {
			t.Fatal("gate did not reach and hold its settled state")
		}

		gate.Update(hold - 0.01)
		gate.RequestOpening(1 - target)

		if gate.Opening != target || gate.OpeningTarget != target {
			t.Fatal("queued request bypassed the minimum settled-state hold")
		}

		gate.Update(0.01)

		if gate.OpeningTarget != 1-target {
			t.Fatal("queued request did not start when the hold expired")
		}
	}
}

func TestPortalCaptureAndStationaryArrival(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(25, catalog)
	gate := NewPassage(world, PassageOptions{ID: 987, Position: Vec.Create(1000, 2000), DestinationSector: "other", DestinationName: "Other", Wormhole: true})
	simulation.AddEntity(world, gate)
	ship := NewShip("mustang", Properties{ObjectProperties: simulation.ObjectProperties{World: world}}, catalog)
	spec := catalog.HoleSpec
	pull, scale, hold := spec.PullDuration/1000, spec.TransitScaleDuration/1000, spec.ArrivalHoldDuration/1000
	ship.Position = Vec.Add(gate.Base().Position, Vec.Create(0, 100))
	ship.TransitGate, ship.TransitTime = gate.Base().ID, -(pull + scale)
	events := []protocol.SimulationEvent{}
	ship.Control(protocol.Input{Thrust: 1, Turn: 1, Fire: true, Launch: true}, &events)

	if ship.Forward != 0 || ship.Turn != 0 || ship.Firing || ship.Launching != 0 {
		t.Fatal("controls interrupted transit")
	}

	ship.Update(pull / 2)

	if distance := Vec.Distance(ship.Position, gate.Base().Position); distance <= 0 || distance >= 100 {
		t.Fatal("capture did not pull gradually")
	}

	if len(ship.Hitbox()) != 0 {
		t.Fatal("captured ship still collides")
	}

	ship.Update(pull / 2)

	if ship.Position != gate.Base().Position {
		t.Fatal("shrink did not start at portal center")
	}

	ship.Update(scale)

	if ship.TransitTime != -1e-6 {
		t.Fatal("departure did not wait invisibly for sector transfer")
	}

	ship.TransitTime = scale + hold
	restored, err := RestoreEntity(CaptureEntity(ship), world)

	if err != nil {
		t.Fatal(err)
	}

	if restored.(*Ship).TransitTime != ship.TransitTime || restored.(*Ship).TransitGate != ship.TransitGate {
		t.Fatal("save lost transit phase")
	}

	ship.Update(scale)

	if ship.Launching != 0 || ship.Position != gate.Base().Position || ship.Velocity != (Vec.Vector{}) {
		t.Fatal("arrival launched before growing")
	}

	ship.Update(hold)

	if ship.TransitTime != 0 || ship.TransitGate != gate.Base().ID || ship.Launching != 0 || ship.Forward != 0 || ship.Velocity != (Vec.Vector{}) {
		t.Fatal("arrival did not return idle flight control after the hold")
	}
}
