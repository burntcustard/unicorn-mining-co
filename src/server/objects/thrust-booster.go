// Port of the thrust booster controls in src/client/objects/ship.ts.
package objects

import (
	"math"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
)

func (s *Ship) TriggerThrustBoost(pressed bool) {
	previous := s.thrustBoostHeld
	s.thrustBoostHeld = pressed
	forward, _, _ := s.thrusterOutput()

	if !pressed || previous || s.Dead || s.Cockpit == nil || s.DockedTo != nil && *s.DockedTo != 0 || s.TransitTime != 0 || s.Launching != 0 || s.Fuel <= 0 || forward == 0 || s.SystemsPower <= 0 {
		return
	}

	var buffer [16]*simulation.Mount
	mounts := s.AppendMounts(buffer[:0])
	ready := false

	for _, mount := range mounts {
		if mount.Module == nil || mount.Module.ModuleBase().Spec.Booster == nil {
			continue
		}

		data := mount.Module.ModuleBase()

		if data.FireCooldown > 1e-9 {
			return
		}

		booster := data.Spec.Booster
		ready = ready || mount.Health >= 1 && mount.Hull.Health >= 1 && data.ChargeCooldown <= float64(booster.Charges-1)*booster.Recharge+1e-9
	}

	if !ready {
		return
	}

	for _, mount := range mounts {
		if mount.Module == nil || mount.Module.ModuleBase().Spec.Booster == nil {
			continue
		}

		data := mount.Module.ModuleBase()
		booster := data.Spec.Booster
		active := 0.0

		if mount.Health >= 1 && mount.Hull.Health >= 1 && data.ChargeCooldown <= float64(booster.Charges-1)*booster.Recharge+1e-9 {
			active = 1
			data.ChargeCooldown = math.Min(float64(booster.Charges)*booster.Recharge, data.ChargeCooldown+booster.Recharge)
		}

		data.FireCooldown = booster.Duration + booster.Cooldown

		for _, segment := range s.SegmentsAtMount(mount) {
			s.setSegmentActive(segment, active)
		}
	}
}

func (s *Ship) thrustBoostFactor() float64 {
	return s.thrustBoosterMultiplier(false)
}

func (s *Ship) thrustBoostSpeedFactor() float64 {
	return s.thrustBoosterMultiplier(true)
}

func (s *Ship) thrustBoosterMultiplier(speedLimit bool) float64 {
	if s.Dead || s.DockedTo != nil && *s.DockedTo != 0 || s.TransitTime != 0 {
		return 1
	}

	factor := 1.0
	var buffer [16]*simulation.Mount

	for _, mount := range s.AppendMounts(buffer[:0]) {
		if mount.Module == nil || mount.Health < 1 || mount.Hull.Health < 1 {
			continue
		}

		data := mount.Module.ModuleBase()
		booster := data.Spec.Booster

		if booster == nil || data.FireCooldown <= 1e-9 {
			continue
		}

		progress := 0.0

		if speedLimit {
			progress = 1

			if booster.Cooldown > 0 {
				progress = math.Min(1, data.FireCooldown/booster.Cooldown)
			}
		} else if data.FireCooldown > booster.Cooldown+1e-9 {
			progress = 1
		}

		if booster.RampDuration > 0 {
			progress *= math.Max(0, math.Min(1, (booster.Duration+booster.Cooldown-data.FireCooldown)/booster.RampDuration))
		}

		for _, segment := range s.SegmentsAtMount(mount) {
			if segment.Active == 1 {
				factor *= 1 + (booster.Multiplier-1)*progress*s.modulePower(mount.Module)
				break
			}
		}
	}

	return factor
}

func (s *Ship) updateThrustBoosters(dt float64) {
	var buffer [16]*simulation.Mount

	for _, mount := range s.AppendMounts(buffer[:0]) {
		if mount.Module == nil || mount.Module.ModuleBase().Spec.Booster == nil {
			continue
		}

		data := mount.Module.ModuleBase()
		segments := s.SegmentsAtMount(mount)
		boostRemaining := 0.0

		for _, segment := range segments {
			if segment.Active == 1 {
				boostRemaining = math.Max(0, data.FireCooldown-data.Spec.Booster.Cooldown)
				break
			}
		}

		rechargeTime := math.Max(0, dt-boostRemaining)
		data.FireCooldown = math.Max(0, data.FireCooldown-dt)

		if mount.Health >= 1 && mount.Hull.Health >= 1 {
			data.ChargeCooldown = math.Max(0, data.ChargeCooldown-rechargeTime*s.modulePower(mount.Module))
		}

		if data.FireCooldown <= 1e-9 || s.Dead || s.DockedTo != nil && *s.DockedTo != 0 || s.TransitTime != 0 || mount.Health < 1 || mount.Hull.Health < 1 {
			for _, segment := range segments {
				s.setSegmentActive(segment, 0)
			}
		}
	}
}
