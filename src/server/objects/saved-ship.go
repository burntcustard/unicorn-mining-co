package objects

import (
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/definitions"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
	"slices"
)

// Player ships resume stationary. Definitions provide geometry and physics;
// this record contains only identity, condition, equipment and possessions.
type SavedShip struct {
	ID       int64             `json:"id"`
	Type     string            `json:"type"`
	Position [2]int64          `json:"position"`
	Rotation float64           `json:"rotation,omitempty"`
	Paint    *int              `json:"paint,omitempty"`
	Dead     bool              `json:"dead,omitempty"`
	DockedTo *int64            `json:"dockedTo,omitempty"`
	Hull     []float64         `json:"hull"`
	Modules  []SavedShipModule `json:"modules"`
	Cargo    []SavedCargo      `json:"cargo,omitempty"`
}

type SavedShipModule struct {
	ID     int64    `json:"id"`
	Type   string   `json:"type"`
	Mount  int      `json:"mount"`
	Health *float64 `json:"health,omitempty"`
	Paint  *int     `json:"paint,omitempty"`
	// Each pair is [active, activation progress]; trailing inactive parts are omitted.
	Active [][2]float64 `json:"active,omitempty"`
}

type SavedCargo struct {
	ID      int64    `json:"id"`
	Type    string   `json:"type"`
	Module  bool     `json:"module,omitempty"`
	Health  *float64 `json:"health,omitempty"`
	Paint   *int     `json:"paint,omitempty"`
	Message *string  `json:"message,omitempty"`
	Unlock  string   `json:"unlock,omitempty"`
}

func finiteHealth(value float64) *float64 {
	if math.IsNaN(value) {
		return nil
	}

	return &value
}

func savedPaint(shades []string, catalog definitions.Catalog) *int {
	for i, color := range catalog.PaintColors {
		if slices.Equal(shades, color) {
			return &i
		}
	}

	return nil
}

func CaptureShip(ship *Ship) SavedShip {
	s := SavedShip{ID: ship.ID, Type: ship.DefinitionID, Position: [2]int64{int64(math.Round(ship.Position.X)), int64(math.Round(ship.Position.Y))}, Rotation: ship.Rotation, Dead: ship.Dead, DockedTo: savedPointer(ship.DockedTo), Hull: ship.HullHealth(), Modules: []SavedShipModule{}}

	if s.Type == "" {
		s.Type = "mustang"
	}

	if !slices.Equal(ship.Shades, ship.Catalog.Colors["white"]) {
		s.Paint = savedPaint(ship.Shades, ship.Catalog)
	}

	for _, state := range ship.ModuleStates() {
		if state.Mount < 0 {
			continue
		}

		m := SavedShipModule{ID: *state.ID, Type: ship.Catalog.ModuleIDs[state.Type], Mount: state.Mount, Health: finiteHealth(*state.Health), Paint: savedPaint(state.Shades, ship.Catalog)}
		last := -1

		for i, segment := range state.Segments {
			if segment.Active != 0 || segment.ActivationProgress != 0 {
				last = i
			}
		}

		for _, segment := range state.Segments[:last+1] {
			m.Active = append(m.Active, [2]float64{segment.Active, segment.ActivationProgress})
		}

		s.Modules = append(s.Modules, m)
	}

	for _, entity := range ship.CargoContents {
		o := entity.Base()
		cargo := SavedCargo{ID: o.ID, Health: finiteHealth(o.Health), Message: savedPointer(o.Message), Unlock: o.Unlock}

		if m, ok := entity.(simulation.Module); ok {
			cargo.Module, cargo.Type, cargo.Paint = true, m.ModuleBase().Type, savedPaint(o.Shades, ship.Catalog)
		} else if o.Resource >= 0 && o.Resource < len(ship.Catalog.ItemIDs) {
			cargo.Type = ship.Catalog.ItemIDs[o.Resource]
		}

		s.Cargo = append(s.Cargo, cargo)
	}

	return s
}

func restorePaint(paint *int, catalog definitions.Catalog) ([]string, error) {
	if paint == nil {
		return nil, nil
	}

	if *paint < 0 || *paint >= len(catalog.PaintColors) {
		return nil, fmt.Errorf("unknown saved paint %d", *paint)
	}

	return slices.Clone(catalog.PaintColors[*paint]), nil
}

func RestoreShip(s SavedShip, world *simulation.World, playerID int64) (*Ship, error) {
	catalog := world.Specification

	if _, ok := catalog.ShipDefinitions[s.Type]; !ok || s.ID == 0 {
		return nil, fmt.Errorf("invalid saved ship %q/%d", s.Type, s.ID)
	}

	shades, err := restorePaint(s.Paint, catalog)

	if err != nil {
		return nil, err
	}

	ship := NewShip(s.Type, Properties{ObjectProperties: simulation.ObjectProperties{ID: &s.ID, World: world, PlayerID: &playerID, Position: Vec.Create(float64(s.Position[0]), float64(s.Position[1])), Rotation: s.Rotation}, Shades: shades}, catalog)

	if len(s.Hull) != len(ship.HullSegments) {
		return nil, fmt.Errorf("saved hull does not match %q", s.Type)
	}

	ship.SetHullHealth(s.Hull)
	var hulls []*simulation.Segment

	for _, segment := range ship.Segments {
		if segment.Hull {
			hulls = append(hulls, segment)
		}
	}

	if len(hulls) > 0 {
		simulation.OuterEdges(outlinesOf(hulls))
	}

	states := []ModuleState{}

	for _, m := range s.Modules {
		kind := slices.Index(catalog.ModuleIDs, m.Type)

		if kind < 0 || m.Mount < 0 || m.Mount >= len(ship.Mounts()) {
			return nil, fmt.Errorf("invalid saved module %q at mount %d", m.Type, m.Mount)
		}

		shades, err := restorePaint(m.Paint, catalog)

		if err != nil {
			return nil, err
		}

		health := m.Health

		if health == nil {
			value := catalog.ModuleDefinitions[m.Type].Health
			health = &value
		}

		state := ModuleState{ID: savedPointer(&m.ID), Type: kind, Mount: m.Mount, Health: health, Shades: shades}

		for _, active := range m.Active {
			state.Segments = append(state.Segments, ModuleSegmentState{Active: active[0], ActivationProgress: active[1]})
		}

		states = append(states, state)
	}

	ship.SetModuleStates(states)

	for _, cargo := range s.Cargo {
		props := simulation.ObjectProperties{ID: &cargo.ID, Message: cargo.Message, Health: cargo.Health}
		var entity simulation.Entity

		if cargo.Module {
			if _, ok := catalog.ModuleDefinitions[cargo.Type]; !ok {
				return nil, fmt.Errorf("unknown cargo module %q", cargo.Type)
			}

			entity = modules.Create(cargo.Type, props, catalog)
			shades, err := restorePaint(cargo.Paint, catalog)

			if err != nil {
				return nil, err
			}

			if shades != nil {
				entity.Base().Shades = shades
			}

			if cargo.Health == nil {
				entity.Base().Health = math.NaN()
			}
		} else {
			if _, ok := catalog.ItemDefinitions[cargo.Type]; !ok {
				return nil, fmt.Errorf("unknown cargo item %q", cargo.Type)
			}

			entity = NewItem(cargo.Type, props, catalog)
			entity.Base().Unlock = cargo.Unlock
		}

		entity.Base().Dead = true
		ship.CargoContents = append(ship.CargoContents, entity)
	}

	ship.Dead, ship.DockedTo = s.Dead, savedPointer(s.DockedTo)
	return ship, nil
}
