// Mechanical types from src/client/types.ts. Kept beside GameObject because
// craft, modules and world refer to each other in the TypeScript hierarchy.
package simulation

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/collision"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	Vec "github.com/burntcustard/unicorn-mining-co/src/server/vector"
	"math"
)

type Module interface {
	Entity
	ModuleBase() *ModuleData
}

type ModuleData struct {
	FireCooldown   float64
	ChargeCooldown float64
	Type           string
	Spec           specs.Module
	Model          []*SegmentPlan
	Mount          *Mount
	Bounciness     func(*Segment) *float64
}

type Mount struct {
	MountPoints     []specs.MountPoint
	LocalPosition   Vec.Vector
	Health          float64
	HealthActivated *float64
	Module          Module
	Fits            []string
	Hull            *Segment
}

type SegmentPlan struct {
	Health                                             *float64
	Points                                             *ShapeOutline
	DynamicPoints                                      func(*Segment) *ShapeOutline
	Radius                                             func(*Segment) float64
	Mounts                                             []*Mount
	Core, DisablePhysics, DockSegment, Covers, Catches bool
	ActivationDuration, ThrusterNozzleSide             float64
	ZIndex                                             *int
	LocalPosition                                      Vec.Vector
	Shades                                             []string
	Wreckage                                           *SegmentPlan
	NoWreckage                                         bool
	FillShade                                          *float64
	Stroke                                             [][][]float64
}

type Segment struct {
	outlineKey    [2]float64
	cachedOutline *ShapeOutline
	SegmentPlan
	ZIndex                                   int
	Hull                                     bool
	HullPlan                                 *SegmentPlan
	Module                                   Module
	Mount                                    *Mount
	Active, ActivationProgress, Health, Rate float64
	LocalPosition                            Vec.Vector
	Middle                                   *Point
	Shades                                   []string
	Biting                                   bool
	ExpandingTick                            *uint64
	Collider, DrillCollider                  *collision.Collider
	ColliderOutline                          *ShapeOutline
	ColliderMiddle                           Point
}

func (s *Segment) TargetHealth() *float64 {
	if s.Mount != nil {
		return &s.Mount.Health
	}

	return &s.Health
}

func (s *Segment) Outline() *ShapeOutline {
	if s.DynamicPoints != nil {
		return s.DynamicPoints(s)
	}

	return s.Points
}

var physicalHullSpec = specs.Module{}
var nonphysicalHullSpec = specs.Module{DisablePhysics: true}

func (s *Segment) ModuleSpec() *specs.Module {
	if s.Module != nil {
		return &s.Module.ModuleBase().Spec
	}

	if s.HullPlan != nil && s.HullPlan.DisablePhysics {
		return &nonphysicalHullSpec
	}

	return &physicalHullSpec
}

func NewMount(points []specs.MountPoint) *Mount {
	mount := &Mount{MountPoints: points, LocalPosition: Vec.Create(points[0].X, points[0].Y), Health: math.NaN()}

	for _, point := range points {
		mount.Fits = append(mount.Fits, point.Fits...)
	}

	return mount
}

func (s *Segment) OutlineShades() []string {
	if !s.Hull && s.Module != nil && s.Module.Base().Shades != nil {
		return s.Module.Base().Shades
	}

	return s.Shades
}

type Pose struct {
	Position Vec.Vector
	Rotation float64
}

// Dynamic module geometry depends on a small immutable key. Reuse it until
// activation or mount placement changes; callers only read the returned points.
func (s *Segment) CachedOutline(key [2]float64, build func() *ShapeOutline) *ShapeOutline {
	if s.cachedOutline == nil || s.outlineKey != key {
		s.outlineKey = key
		s.cachedOutline = build()
	}

	return s.cachedOutline
}
