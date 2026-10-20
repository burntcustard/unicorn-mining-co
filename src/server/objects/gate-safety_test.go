package objects

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestGateBeamSweeps(t *testing.T) {
	catalog, _ := specs.Load()
	catalog.JumpGateSpec.BeamOffsets = []float64{-12, -4, 4, 12}
	catalog.JumpGateSpec.HalfTravel = 10
	catalog.JumpGateSpec.BeamInset = 1

	for _, rotation := range []float64{0, .71, math.Pi / 2} {
		world := simulation.CreateWorld(1, catalog)
		gate := NewPortal(world, PortalOptions{ID: 1, Position: Vec.Create(40, -80)}).(*JumpGate)
		gate.Rotation, gate.Opening = rotation, .5

		for _, test := range []struct {
			name     string
			from, to Vec.Vector
			radius   float64
			beams    uint8
		}{
			{"fast crossing", Vec.Create(0, -20), Vec.Create(0, 20), 0, 15},
			{"one beam", Vec.Create(0, -14), Vec.Create(0, -10), 0, 1},
			{"ship edge", Vec.Create(0, -13), Vec.Create(0, -13), 1.01, 1},
			{"beyond beam end", Vec.Create(8, -20), Vec.Create(8, 20), 1, 0},
			{"between beams", Vec.Create(-5, 0), Vec.Create(5, 0), 1, 0},
		} {
			from := Vec.Add(gate.Position, simulation.RotatePoint(test.from, rotation))
			to := Vec.Add(gate.Position, simulation.RotatePoint(test.to, rotation))

			if got := gate.CrossedBeams(from, to, test.radius); got != test.beams {
				t.Fatalf("%s at rotation %g: got beams %04b, want %04b", test.name, rotation, got, test.beams)
			}
		}
	}
}

func TestGateSafetyReversesMotionAndResetsBeamsAtFullOpening(t *testing.T) {
	catalog, _ := specs.Load()
	world := simulation.CreateWorld(1, catalog)
	gate := NewPortal(world, PortalOptions{ID: 1}).(*JumpGate)
	gate.RequestExitOpening()
	gate.Advance((gate.Spec.OpeningDuration + gate.Spec.StateHoldDuration) / 1000)
	warnings := 0

	gate.OnClosing = func() { warnings++ }

	gate.RequestOpening(0)
	gate.Advance(gate.Spec.ClosingDuration / 4000)
	gate.RequestOpening(0)
	opening := gate.Opening
	gate.InterruptClosing(2)

	if gate.Opening != opening || gate.OpeningTarget != 1 || gate.BlockedBeams != 2 || warnings != 1 {
		t.Fatal("interruption must reverse immediately without moving the hull or repeating the closing warning")
	}

	gate.Advance(gate.Spec.OpeningDuration / 8000)

	if gate.Opening <= opening || gate.Opening >= 1 || gate.BlockedBeams != 2 {
		t.Fatal("the interrupted beam must stay blocked while the gate reopens")
	}

	gate.Advance((gate.Spec.OpeningDuration + 2*gate.Spec.StateHoldDuration) / 1000)

	if gate.Opening != 1 || gate.OpeningTarget != 1 || gate.BlockedBeams != 0 || warnings != 1 {
		t.Fatal("full opening must reset the beams and discard the old closing request")
	}
}
