// Port of src/client/physics/apply-force.ts.
package physics

import Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"

// ForceBody exposes mutable motion without importing the gameplay hierarchy.
type ForceBody interface {
	ForceVelocity() *Vec.Vector
	ForceSpin() *float64
	ForceMass() float64
}

func ApplyForce(object ForceBody, force Vec.Vector, spin float64) {
	inverseMass := 1 / object.ForceMass()
	velocity := object.ForceVelocity()
	*velocity = Vec.AddScaled(*velocity, force, inverseMass)
	*object.ForceSpin() += spin / object.ForceMass()
}
