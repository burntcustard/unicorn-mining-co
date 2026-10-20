package objects

import "github.com/burntcustard/unicorn-mining-co/src/server/simulation"

type powerRates struct {
	generation, capacity, systems, thrusters float64
}

func (s *Ship) powerRates() powerRates {
	var rates powerRates
	var mounts [16]*simulation.Mount

	for _, mount := range s.AppendMounts(mounts[:0]) {
		if mount.Module == nil || mount.Health < 1 {
			continue
		}

		module := mount.Module.ModuleBase()
		spec := module.Spec
		active := spec.ForwardThrust != 0
		firing := false

		for _, segment := range s.Segments {
			if segment.Module == mount.Module && segment.Active != 0 {
				active = true

				if segment.Active == 1 && segment.ActivationProgress == 1 {
					firing = s.Firing && !s.Dead && (s.DockedTo == nil || *s.DockedTo == 0) && s.Launching == 0
				}
			}
		}

		usage := spec.Power

		if active {
			usage = spec.PowerActivated

			if spec.PowerFiring > 0 && firing {
				usage = spec.PowerFiring
			} else if spec.PowerCharging > 0 && max(module.ChargeCooldown, module.FireCooldown) > 1e-9 {
				usage = spec.PowerCharging
			}
		}

		rates.generation += spec.PowerGenerated
		rates.capacity += spec.PowerCapacity

		if spec.ForwardThrust != 0 {
			rates.thrusters += usage
		} else {
			rates.systems += usage
		}
	}

	return rates
}

func (s *Ship) PowerGeneration() float64 { return s.powerRates().generation }

func (s *Ship) PowerCapacity() float64 { return s.powerRates().capacity }

func (s *Ship) PowerUsage() float64 {
	rates := s.powerRates()
	return rates.systems + rates.thrusters
}

func (s *Ship) ModulePower(module simulation.Module) float64 {
	if module.ModuleBase().Spec.ForwardThrust != 0 {
		return 1
	}

	return s.SystemsPower
}

// UpdatePower integrates MW over seconds into MJ and supplies thrusters from
// the energy left after other modules have received their requested power.
func (s *Ship) UpdatePower(dt float64) {
	if !(dt > 0) {
		return
	}

	rates := s.powerRates()
	stored := max(0, min(rates.capacity, s.StoredPower))
	available := rates.generation + stored/dt
	s.SystemsPower, s.ThrusterPower = 1, 1

	if rates.systems > 0 {
		s.SystemsPower = min(1, available/rates.systems)
	}

	if rates.thrusters > 0 {
		s.ThrusterPower = max(0, min(1, (available-rates.systems)/rates.thrusters))
	}

	supplied := rates.systems*s.SystemsPower + rates.thrusters*s.ThrusterPower
	s.StoredPower = max(0, min(rates.capacity, stored+(rates.generation-supplied)*dt))
	s.Fly(s.Forward, s.Turn)
}
