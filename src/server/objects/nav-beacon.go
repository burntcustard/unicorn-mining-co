package objects

import "github.com/burntcustard/unicorn-mining-co/src/server/specs"

type NavBeacon struct{ *Craft }

func NewNavBeacon(props Properties, catalog specs.Catalog) *NavBeacon {
	spec := catalog.NavBeaconSpec

	if props.Mass == nil {
		props.Mass = &spec.Mass
	}

	if props.Radius == nil {
		props.Radius = &spec.Radius
	}

	plans := hullPlans(spec.HullSegments)

	for i := range plans {
		plans[i].Core = spec.HullSegments[i].Core
	}

	beacon := &NavBeacon{Craft: NewCraft(props, plans, catalog)}
	beacon.Self = beacon
	beacon.Kind = "navBeacon"
	beacon.Name = spec.Name
	return beacon
}
