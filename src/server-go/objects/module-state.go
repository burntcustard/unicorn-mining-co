// Port of ModuleState in src/client/objects/craft.ts.
package objects

import "slices"

type ModuleSegmentState struct {
	Active             float64 `json:"active"`
	ActivationProgress float64 `json:"activationProgress"`
}

type ModuleState struct {
	HealthActivated *float64             `json:"healthActivated,omitempty"`
	ChargeCooldown  *float64             `json:"chargeCooldown,omitempty"`
	FireCooldown    *float64             `json:"fireCooldown,omitempty"`
	AimRotation     *float64             `json:"aimRotation,omitempty"`
	ID              *int64               `json:"id,omitempty"`
	Type            int                  `json:"type"`
	Mount           int                  `json:"mount"`
	Health          *float64             `json:"health,omitempty"`
	Shades          []string             `json:"shades,omitempty"`
	Segments        []ModuleSegmentState `json:"segments"`
}

// Legacy saves used a small generic thruster on Crescent's dedicated mounts.
// Upgrade only fitted modules accepted by the current mount; cargo stays intact.
func (c *Craft) restoredModuleType(id string, mountIndex int) string {
	if c.DefinitionID != "crescent" || id != "thrusterSingleSm" || mountIndex < 0 {
		return id
	}

	mounts := c.Mounts()

	if mountIndex < len(mounts) && slices.Contains(mounts[mountIndex].Fits, "thrusterCrescent") {
		return "thrusterCrescent"
	}

	return id
}
