package objects

// UpdateMass derives the ship's mass from its hull and installed modules.
func (s *Ship) UpdateMass() {
	id := s.DefinitionID

	if id == "" {
		id = "mustang"
	}

	spec := s.Catalog.ShipSpecs[id]
	mass := spec.HullMass

	for _, mount := range s.Mounts() {
		if mount.Module != nil {
			mass += mount.Module.ModuleBase().Spec.Mass
		}
	}

	if mass > 0 {
		s.Mass = mass
		s.Drag = s.DragCoefficient / mass
	}
}
