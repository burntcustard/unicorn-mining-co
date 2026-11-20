package npc

import (
	"math"

	"github.com/burntcustard/unicorn-mining-co/src/server-go/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server-go/vector"
)

type AttackOptions struct {
	PassDistance, AimTolerance         float64
	ProjectileSpeed, AimPredictionTime float64
	CanFire                            bool
}

/*
Attack steers a combat pass and fires when facing the target's aim position.
The controller supplies firing readiness and weapon tuning. A zero projectile
speed aims directly; kinetic weapons can lead the target's relative motion.
*/
func (p *Pilot) Attack(ship, target *objects.Ship, options AttackOptions) (thrust, turn float64, fire bool) {
	aim := target.Position

	if options.ProjectileSpeed > 0 {
		flight := min(Vec.Distance(ship.Position, target.Position)/options.ProjectileSpeed, options.AimPredictionTime)
		aim = Vec.AddScaled(aim, Vec.Subtract(target.Velocity, ship.Velocity), flight)
	}

	offset := Vec.Subtract(aim, ship.Position)
	angle := math.Remainder(math.Atan2(offset.Y, offset.X)-ship.Rotation, 2*math.Pi)
	thrust, turn = p.Steer(ship, Movement{Position: target.Position, Velocity: target.Velocity, PassDistance: options.PassDistance, TargetID: target.ID})
	return thrust, turn, options.CanFire && math.Abs(angle) < options.AimTolerance
}
