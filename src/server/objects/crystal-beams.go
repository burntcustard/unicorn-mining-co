package objects

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

type crystalBeam struct {
	first            *collision.Collider
	start, end       Vec.Vector
	length, fraction float64
	index            int
}

func (s *Ship) crystalBeams() []crystalBeam {
	spec := s.CrystalWeapon

	if spec == nil || s.World == nil || !s.Firing || s.Dead || s.SystemsPower <= 0 || s.DockedTo != nil && *s.DockedTo != 0 || s.Launching != 0 {
		return nil
	}

	junction := Vec.Create(spec.Junction[0], spec.Junction[1])
	beams := []crystalBeam{}

	for index, emitter := range spec.Emitters {
		alive := false

		for _, segment := range s.Segments {
			if segment.Hull && segment.HullPlan == s.HullSegments[emitter.HullIndex] && !(segment.Health < 1) {
				alive = true
				break
			}
		}

		if !alive {
			continue
		}

		localStart := Vec.Create(emitter.Position[0], emitter.Position[1])
		localEnd := junction
		fraction := 0.25

		if index == 0 {
			localEnd = Vec.Add(localStart, Vec.Create(spec.Reach, 0))
			fraction = 0.5
		}

		start := Vec.Add(s.Position, simulation.RotatePoint(localStart, s.Rotation))
		end := Vec.Add(s.Position, simulation.RotatePoint(localEnd, s.Rotation))
		first, length := s.traceLaser(start, end)
		beams = append(beams, crystalBeam{first, start, end, length, fraction, index})
	}

	for index := range beams {
		beam := &beams[index]
		mainStart := Vec.Create(spec.Emitters[0].Position[0], spec.Emitters[0].Position[1])

		if beam.index != 0 || beam.length < Vec.Distance(mainStart, junction) {
			continue
		}

		for _, side := range beams {
			if side.index != 0 && side.first == nil {
				beam.fraction += 0.25
			}
		}
	}

	for index := range beams {
		beams[index].fraction *= s.SystemsPower
	}

	return beams
}

func (s *Ship) resolveCrystalBeams(dt float64, events *[]protocol.SimulationEvent) {
	for _, beam := range s.crystalBeams() {
		s.laserHit(beam.first, beam.start, beam.end, beam.length, s.CrystalWeapon.Damage*beam.fraction*30*dt, events)
	}
}
