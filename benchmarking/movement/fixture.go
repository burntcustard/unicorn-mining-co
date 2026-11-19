//go:build ignore

package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects/modules"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/simulation"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"slices"
	"strings"
)

func (s *GameSession) prepareMovementBenchmark(p *playerRecord) {
	option, benchmark := strings.CutPrefix(p.profile.DisplayName, "Bench ")

	if !benchmark {
		return
	}

	thruster := "thruster" + option
	catalog := s.World.Specification

	if catalog.ModuleSpecs[thruster].Behavior != "thruster" {
		return
	}

	ship := objects.CreatePlayerShip(s.World, objects.Properties{ObjectProperties: simulation.ObjectProperties{ID: &p.shipID, PlayerID: &p.playerID}})
	engine := ship.Engine()
	mount := engine.ModuleBase().Mount

	if !slices.Contains(mount.Fits, thruster) {
		return
	}

	if engine.ModuleBase().Type != thruster {
		ship.Fit(modules.Create(thruster, simulation.ObjectProperties{World: s.World}, catalog), mount)
		// Fitting puts the replaced module in cargo. Each case starts empty.
		ship.CargoContents = nil
	}

	ship.Position = s.movementBenchmarkStart()
	ship.TargetLabel = p.profile.DisplayName
	p.ship = ship
	p.hiddenShip, p.needsLoad = true, true
	p.noShip = false
	p.lastInput = protocol.Input{}
}

// Reserve six kilometers of eastbound flight for the thrust and coast phases.
func (s *GameSession) movementBenchmarkStart() Vec.Vector {
	const halfLength, margin, reach = 3000., 500., 5000.
	ranges := protocol.WorldRanges{Asteroid: reach, StationPhysics: reach, Wreck: reach}

	for distance := 18000.; distance <= 42000; distance += 2000 {
		for _, y := range []float64{-distance, distance} {
			blocks := func(position Vec.Vector, radius float64) bool {
				closest := Vec.Create(min(halfLength, max(-halfLength, position.X)), y)
				return Vec.DistanceSquared(position, closest) < (radius+margin)*(radius+margin)
			}

			view := s.regions.View(Vec.Create(0, y), &ranges)

			if slices.ContainsFunc(view.Asteroids, func(asteroid protocol.AsteroidDescription) bool {
				return blocks(asteroid.Position, max(asteroid.Radius, asteroid.RadiusEven))
			}) || slices.ContainsFunc(view.Stations, func(station protocol.StationDescription) bool {
				return blocks(station.Position, station.Radius)
			}) || slices.ContainsFunc(view.Wrecks, func(wreck protocol.WreckDescription) bool {
				return blocks(wreck.Position, wreck.Radius)
			}) {
				continue
			}

			blocksFlight := func(entity simulation.Entity) bool {
				object := entity.Base()
				return !object.Dead && blocks(object.Position, object.Radius)
			}

			if !slices.ContainsFunc(s.World.Entities.ReadValues(), blocksFlight) &&
				!slices.ContainsFunc(s.regions.Sleeping.ReadValues(), blocksFlight) {
				return Vec.Create(-halfLength, y)
			}
		}
	}

	panic("No clear flight lane for the movement benchmark")
}
