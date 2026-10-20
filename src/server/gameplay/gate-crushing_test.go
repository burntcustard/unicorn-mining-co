package gameplay

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestGateCrushingInWorld(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	catalog.JumpGateSpec.CrushDamage = 5000

	for _, rotation := range []float64{0, .71} {
		world := simulation.CreateWorld(25, catalog)
		world.Collisions = NewGameCollisions(catalog)
		gate := objects.NewPortal(world, objects.PortalOptions{ID: 100, Position: Vec.Create(1234, -5678)}).(*objects.JumpGate)
		gate.Rotation, gate.Opening, gate.OpeningTarget = rotation, .35, 0
		ship := objects.CreatePlayerShip(world, objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: new(int64(1)), Position: Vec.Add(gate.Position, simulation.RotatePoint(Vec.Create(0, 242), rotation)), Rotation: rotation + .4}})
		simulation.AddEntity(world, ship)
		simulation.AddEntity(world, gate)
		damaged := false
		initial := ship.HullHealthTotal()

		for range 180 {
			// Session-owned gates move before CapturePoses. Keep the same ordering
			// here while exercising normal destruction and fragment processing.
			gate.Advance(catalog.Simulation.SimulationStep)
			gate.Connected = gate.Portal
			events := simulation.UpdateWorld(world, simulation.UpdateWorldOptions{})

			for _, event := range events {
				if hit, ok := event.(protocol.CollisionEvent); ok && hit.B == gate.ID && hit.Damage[0] == 5000 {
					damaged = true

					if hit.Damage[1] != 0 {
						t.Fatal("crushing damaged the gate")
					}
				}
			}
		}

		if !damaged || ship.HullHealthTotal() >= initial {
			t.Fatal("closing gate did not damage the ship through normal world updates")
		}

		for _, segment := range gate.Segments {
			if !math.IsNaN(segment.Health) {
				t.Fatal("permanent gate hull acquired damageable health")
			}
		}
	}
}
