// Port of ModuleState in src/client/objects/craft.ts.
package objects

type ModuleSegmentState struct {
	Active             float64 `json:"active"`
	ActivationProgress float64 `json:"activationProgress"`
}

type ModuleState struct {
	ID       *int64               `json:"id,omitempty"`
	Type     int                  `json:"type"`
	Mount    int                  `json:"mount"`
	Health   *float64             `json:"health,omitempty"`
	Shades   []string             `json:"shades,omitempty"`
	Segments []ModuleSegmentState `json:"segments"`
}
