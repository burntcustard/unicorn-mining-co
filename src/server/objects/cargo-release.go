package objects

import (
	"slices"

	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
)

func (s *Ship) ReleasingCargo() bool { return s.releasingCargo }

func (s *Ship) CancelCargoRelease() {
	s.cargoReleaseHeld, s.releasingCargo = false, false
	s.cargoReleaseTime = 0
}

/*
ReleasableItem finds the next item, keeping spare modules and opened ammunition packs.
*/
func (s *Ship) ReleasableItem() *Item {
	for _, entity := range s.CargoContents {
		item, ok := entity.(*Item)

		if ok && (item.Rounds == nil || *item.Rounds == s.Catalog.ItemSpecs[s.Catalog.ItemIDs[item.Resource]].Rounds) {
			return item
		}
	}

	return nil
}

/*
MinedCargoValue excludes station purchases, spare modules and ammunition.
*/
func (s *Ship) MinedCargoValue() float64 {
	value := 0.0

	for _, entity := range s.CargoContents {
		if item, ok := entity.(*Item); ok && item.Mined && item.Rounds == nil && item.Price > 0 {
			value += item.Price
		}
	}

	return value
}

func (s *Ship) updateCargoRelease(dt float64) {
	if s.Dead || s.DockedTo != nil || s.TransitTime != 0 {
		s.CancelCargoRelease()
		return
	}

	if !s.releasingCargo {
		if !s.cargoReleaseHeld {
			return
		}

		s.cargoReleaseTime += dt

		if s.cargoReleaseTime+1e-9 < 1 {
			return
		}

		s.CargoRelease()

		if !s.releasingCargo {
			return
		}
	}

	s.cargoReleaseTime -= dt

	if s.cargoReleaseTime > 1e-9 {
		return
	}

	item := s.ReleasableItem()

	if item == nil {
		s.releasingCargo = false
		return
	}

	var hatches []*simulation.Segment

	for _, segment := range s.Segments {
		if segment.Catches && segment.Module != nil && segment.Module.ModuleBase().Spec.CollectsCargo && !(*segment.TargetHealth() < 1) && segment.Active != 0 && segment.ActivationProgress >= 1 {
			hatches = append(hatches, segment)
		}
	}

	if len(hatches) == 0 {
		return
	}

	hatch := hatches[s.cargoReleaseHatch%len(hatches)]
	s.cargoReleaseHatch++
	object := item.Base()
	object.World = s.World

	if object.ID < 0 {
		object.ID = simulation.EntityID(s.World)
	}

	// Cargo travels forward through the open throat, alternating between hatches.
	direction := simulation.RotatePoint(Vec.Create(1, 0), s.Rotation)
	position := Vec.Add(s.Position, simulation.RotatePoint(hatch.LocalPosition, s.Rotation))
	object.Position = Vec.AddScaled(position, direction, object.Radius+2)
	object.Velocity = Vec.AddScaled(s.Velocity, direction, 35)
	object.DroppedBy = s.PlayerID
	object.PickupAfter = s.World.Tick + uint64(3/s.World.Specification.Simulation.SimulationStep)

	s.CargoContents = slices.DeleteFunc(s.CargoContents, func(entity simulation.Entity) bool { return entity == item })

	object.Add()
	s.cargoReleaseTime = 0.25

	if s.World.EntityChanged != nil {
		s.World.EntityChanged(s, false)
	}
}

/*
CargoRelease starts a complete release through the ship's cargo hatches.
*/
func (s *Ship) CargoRelease() {
	if s.World == nil || s.DockedTo != nil || s.TransitTime != 0 || s.Dead || s.releasingCargo {
		return
	}

	s.SetModuleActive("cargoHatch", true)

	if !s.ModuleActive("cargoHatch") || s.ReleasableItem() == nil {
		return
	}

	s.releasingCargo = true
	s.cargoReleaseTime = 0
}
