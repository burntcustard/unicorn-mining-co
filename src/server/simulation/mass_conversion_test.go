package simulation

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server/physics"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func TestShipImpulseUsesKilogramMass(t *testing.T) {
	rules := specs.Simulation{Flight: specs.Flight{MassPerPhysicsUnit: 4175.0 / 9}}

	for _, test := range []struct {
		kind           string
		mass, velocity float64
	}{
		{"ship", 4175, 10},
		{"ship", 8350, 5},
		{"asteroid", 9, 10},
	} {
		object := NewGameObject(ObjectProperties{ID: new(int64(1))}, rules)
		object.Kind, object.Mass = test.kind, test.mass
		physics.ApplyForce(object, Vec.Create(90, 0), 0)

		if math.Abs(object.Velocity.X-test.velocity) > 1e-10 {
			t.Fatalf("%s mass %v: velocity = %v, want %v", test.kind, test.mass, object.Velocity.X, test.velocity)
		}
	}
}
