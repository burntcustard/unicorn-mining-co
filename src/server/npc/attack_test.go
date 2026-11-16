package npc

import (
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestAttackSharesDirectAndKineticAiming(t *testing.T) {
	for _, test := range []struct {
		name                     string
		heading, projectileSpeed float64
		ready, wantFire          bool
	}{
		{name: "direct", ready: true, wantFire: true},
		{name: "not ready", ready: false},
		{name: "misaligned", heading: .3, ready: true},
		{name: "kinetic requires lead", projectileSpeed: 1000, ready: true},
		{name: "kinetic leads relative motion", heading: .19739555984988078, projectileSpeed: 1000, ready: true, wantFire: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ship := flightShip(t)
			ship.Rotation = test.heading
			ship.Velocity = Vec.Create(0, 100)
			target := objects.CreatePlayerShip(ship.World, objects.Properties{ObjectProperties: simulation.ObjectProperties{Position: Vec.Create(1000, 0), Velocity: Vec.Create(0, 500)}})
			simulation.AddEntity(ship.World, target)
			pilot := &Pilot{}
			_, _, fire := pilot.Attack(ship, target, AttackOptions{PassDistance: 70, AimTolerance: .05, CanFire: test.ready, ProjectileSpeed: test.projectileSpeed, AimPredictionTime: .5})

			if fire != test.wantFire {
				t.Fatalf("fire=%v, want %v", fire, test.wantFire)
			}
		})
	}
}
