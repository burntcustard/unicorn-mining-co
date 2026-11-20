package objects

import (
	"math"
	"testing"

	"github.com/burntcustard/unicorn-mining-co/src/server-go/simulation"
)

func thrustBoosterRechargeFixture(t *testing.T) (*Ship, []*simulation.ModuleData) {
	t.Helper()
	ship, _, mounts := thrustBoosterFixture(t, .2)
	config := mounts[0].Module.ModuleBase().Spec.Booster
	config.Duration, config.Cooldown, config.Recharge, config.Charges = 3, 1, 5, 1
	boosts := make([]*simulation.ModuleData, 0, len(mounts))

	for _, mount := range mounts {
		boosts = append(boosts, mount.Module.ModuleBase())
	}

	return ship, boosts
}

func nearBoostRecharge(t *testing.T, actual, expected float64) {
	t.Helper()

	if math.IsNaN(actual) || math.Abs(actual-expected) > 1e-8 {
		t.Fatalf("%g != %g", actual, expected)
	}
}

func pressRechargeBoost(ship *Ship) {
	ship.TriggerThrustBoost(false)
	ship.TriggerThrustBoost(true)
}

func TestThrustBoosterRechargeStartsAfterTheBurst(t *testing.T) {
	ship, boosts := thrustBoosterRechargeFixture(t)
	config := boosts[0].Spec.Booster
	pressRechargeBoost(ship)
	ship.UpdateModules(config.Duration / 2)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, config.Recharge)
	ship.UpdateModules(config.Duration / 2)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, config.Recharge)
	ship.UpdateModules(config.Recharge - .01)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, .01)
	pressRechargeBoost(ship)
	nearBoostRecharge(t, boosts[0].FireCooldown, 0)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, .01)
	ship.UpdateModules(.01)
	ship.TriggerThrustBoost(true)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, 0)
	nearBoostRecharge(t, boosts[0].FireCooldown, 0)
	pressRechargeBoost(ship)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, config.Recharge)
	nearBoostRecharge(t, boosts[0].FireCooldown, config.Duration+config.Cooldown)
}

func TestThrustBoosterRechargeBoundaryAgreesAcrossTimesteps(t *testing.T) {
	coarse, boosts := thrustBoosterRechargeFixture(t)
	fine, fineBoosts := thrustBoosterRechargeFixture(t)
	config := boosts[0].Spec.Booster
	pressRechargeBoost(coarse)
	pressRechargeBoost(fine)
	coarse.UpdateModules(config.Duration + .5)

	for range int(math.Round((config.Duration + .5) * 60)) {
		fine.UpdateModules(1.0 / 60)
	}

	nearBoostRecharge(t, boosts[0].ChargeCooldown, config.Recharge-.5)
	nearBoostRecharge(t, fineBoosts[0].ChargeCooldown, boosts[0].ChargeCooldown)
	nearBoostRecharge(t, fineBoosts[0].FireCooldown, boosts[0].FireCooldown)
}

func TestThrustBoosterPartialPowerScalesOnlyRechargeTime(t *testing.T) {
	ship, boosts := thrustBoosterRechargeFixture(t)
	config := boosts[0].Spec.Booster
	pressRechargeBoost(ship)
	ship.SystemsPower = .5
	ship.UpdateModules(config.Duration + .5)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, config.Recharge-.25)
}

func TestThrustBoosterDepletedPartnerRechargesDuringAnotherBurst(t *testing.T) {
	ship, boosts := thrustBoosterRechargeFixture(t)
	config := boosts[0].Spec.Booster
	boosts[0].ChargeCooldown = config.Recharge
	pressRechargeBoost(ship)
	ship.UpdateModules(config.Duration)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, config.Recharge-config.Duration)
	nearBoostRecharge(t, boosts[1].ChargeCooldown, config.Recharge)
	ship.UpdateModules(.5)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, config.Recharge-config.Duration-.5)
	nearBoostRecharge(t, boosts[1].ChargeCooldown, config.Recharge-.5)
}

func TestThrustBoosterHeldInputDoesNotRepeatAfterRecharge(t *testing.T) {
	ship, boosts := thrustBoosterRechargeFixture(t)
	config := boosts[0].Spec.Booster
	ship.TriggerThrustBoost(true)
	ship.UpdateModules(config.Duration + config.Recharge)
	ship.TriggerThrustBoost(true)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, 0)
	nearBoostRecharge(t, boosts[0].FireCooldown, 0)
	pressRechargeBoost(ship)
	nearBoostRecharge(t, boosts[0].ChargeCooldown, config.Recharge)
}

func TestThrustBoosterRechargeHydratesDuringBurstAndRecharge(t *testing.T) {
	for _, phase := range []string{"burst", "recharge"} {
		t.Run(phase, func(t *testing.T) {
			ship, boosts := thrustBoosterRechargeFixture(t)
			config := boosts[0].Spec.Booster
			elapsed := config.Duration / 2

			if phase == "recharge" {
				elapsed = config.Duration + config.Recharge/2
			}

			pressRechargeBoost(ship)
			ship.UpdateModules(elapsed)
			restored, _ := thrustBoosterRechargeFixture(t)
			restored.SetModuleStates(ship.ModuleStates())
			data := restored.Mounts()[1].Module.ModuleBase()
			remainingLockout := math.Max(0, config.Duration+config.Cooldown-elapsed)
			remainingCharge := config.Recharge - math.Max(0, elapsed-config.Duration)
			nearBoostRecharge(t, data.ChargeCooldown, remainingCharge)
			nearBoostRecharge(t, data.FireCooldown, remainingLockout)
			pressRechargeBoost(restored)
			nearBoostRecharge(t, data.ChargeCooldown, remainingCharge)
			nearBoostRecharge(t, data.FireCooldown, remainingLockout)
			restored.UpdateModules(config.Duration + config.Recharge - elapsed)
			pressRechargeBoost(restored)
			nearBoostRecharge(t, data.ChargeCooldown, config.Recharge)
			nearBoostRecharge(t, data.FireCooldown, config.Duration+config.Cooldown)
		})
	}
}
