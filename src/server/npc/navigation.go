package npc

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

/*
DockingMovement commits to a bay, routes around the hull, then enters its corridor.
The station remains an obstacle until the ship lines up outside that bay.
*/
func (p *Pilot) DockingMovement(ship *objects.Ship, station *objects.Station) Movement {
	if len(station.DockingBays) == 0 {
		return Movement{Position: station.Position, IgnoreID: station.ID}
	}

	if p.dockingID != station.ID {
		p.dockingID, p.enteringDock = station.ID, false
		best := math.Inf(1)

		for index, bay := range station.DockingBays {
			angle := station.Rotation + bay
			point := Vec.AddScaled(station.Position, Vec.Create(math.Cos(angle), math.Sin(angle)), station.Radius+150)

			if d := Vec.DistanceSquared(ship.Position, point); d < best {
				p.dockingBay, best = index, d
			}
		}
	}

	relative := Vec.Subtract(ship.Position, station.Position)
	spin := station.Spin

	// Local movement already carries the ship around its station.
	if ship.LocalMovementParent == station {
		spin *= 1 - ship.LocalMovementRate
	}

	angle := station.Rotation + station.DockingBays[p.dockingBay]
	direction := Vec.Create(math.Cos(angle), math.Sin(angle))
	across, along := math.Abs(Vec.Cross(relative, direction)), Vec.Dot(relative, direction)

	if across > 65 || along < 0 || Vec.Length(relative) > station.Radius+280 {
		p.enteringDock = false
	}

	if across < 35 && along > station.Radius && along < station.Radius+240 {
		p.enteringDock = true
	}

	if p.enteringDock {
		return Movement{Position: station.Position, Velocity: Vec.Add(station.Velocity, Vec.Scale(Vec.Create(-relative.Y, relative.X), spin)), IgnoreID: station.ID}
	}

	// Lead the moving bay while still outside its approach corridor.
	lead := min(2, Vec.Distance(ship.Position, station.Position)/max(70, Vec.Length(ship.Velocity)))
	angle += spin * lead
	outside := Vec.AddScaled(station.Position, Vec.Create(math.Cos(angle), math.Sin(angle)), station.Radius+150)
	return Movement{Position: outside, Velocity: Vec.Add(station.Velocity, Vec.Scale(Vec.Create(-direction.Y, direction.X), spin*(station.Radius+150)))}
}
