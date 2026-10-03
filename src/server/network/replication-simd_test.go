//go:build goexperiment.simd && amd64

package network

import (
	"math"
	"math/rand/v2"
	"simd/archsimd"
	"testing"
)

func TestReplicationBlockExact(t *testing.T) {
	if !archsimd.X86.AVX2() {
		t.Skip("AVX2 unavailable")
	}
	r := rand.New(rand.NewPCG(29, 43))
	v := &ReplicationView{X: make([]float64, 32), Y: make([]float64, 32), IDs: make([]int64, 32), Kinds: make([]int, 32)}
	for trial := range 100000 {
		scale := 20000.0
		if trial%2 != 0 {
			scale = math.Ldexp(1, trial%2046-1022)
		}
		px, py := (r.Float64()-0.5)*scale, (r.Float64()-0.5)*scale
		for i := range v.X {
			v.X[i], v.Y[i], v.IDs[i], v.Kinds[i] = (r.Float64()-0.5)*scale, (r.Float64()-0.5)*scale, int64(i), int(r.Uint64()%4)
		}
		if trial%17 == 0 {
			v.X[trial%32] = math.NaN()
		}
		if trial%19 == 0 {
			v.Y[trial%32] = math.Inf(1)
		}
		start := trial % 17
		dx, dy := v.X[start]-px, v.Y[start]-py
		entity := dx*dx + dy*dy
		if trial%3 == 0 {
			entity = math.Nextafter(entity, math.Inf(-1))
		}
		marker := entity * 2
		owned := int64(trial % 33)
		got := v.replicationBlock(start, px, py, entity, marker, owned)
		var want uint16
		for offset := range 16 {
			i := start + offset
			dx, dy := v.X[i]-px, v.Y[i]-py
			distance := dx*dx + dy*dy
			if distance > entity && v.IDs[i] != owned && (distance > marker || v.Kinds[i]&1 == 0) {
				want |= 1 << offset
			}
			if math.Float64bits(distance) != math.Float64bits(v.distanceBlock[offset]) {
				t.Fatalf("trial %d lane %d distance differs", trial, offset)
			}
		}
		if got != want {
			t.Fatalf("trial %d mask got %x want %x", trial, got, want)
		}
	}
}
