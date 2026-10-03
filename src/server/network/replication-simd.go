//go:build goexperiment.simd && amd64

package network

import (
	"github.com/burntcustard/unicorn-mining-co/src/server/utilities"
	"simd/archsimd"
	"unsafe"
)

var vectorReplication = archsimd.X86.AVX2() && (utilities.SIMDFeature("replication") || utilities.SIMDFeature("replication16"))

func (v *ReplicationView) packReplicationIDs() {
	if v.idsPrepared {
		return
	}

	v.idsPrepared = true
	count := len(v.objects)

	if cap(v.IDs) < count {
		v.IDs = make([]int64, count*2)
	}

	v.IDs = v.IDs[:count]

	for i, object := range v.objects {
		v.IDs[i] = object.ID
	}
}

// Four AVX vectors share the call and cleanup boundary. The exact distances are
// reused by membership and cadence decisions rather than calculated again.
//
//go:noinline
func (v *ReplicationView) replicationBlock(index int, px, py, entitySquared, markerSquared float64, shipID int64) uint16 {
	x, y := archsimd.BroadcastFloat64x4(px), archsimd.BroadcastFloat64x4(py)
	entity, marker := archsimd.BroadcastFloat64x4(entitySquared), archsimd.BroadcastFloat64x4(markerSquared)
	owned, one, zero := archsimd.BroadcastInt64x4(shipID), archsimd.BroadcastInt64x4(1), archsimd.BroadcastInt64x4(0)
	var rejected uint16

	for offset := 0; offset < 16; offset += 4 {
		at := index + offset

		load := func(values []float64) archsimd.Float64x4 {
			return archsimd.LoadFloat64x4Array((*[4]float64)(unsafe.Add(unsafe.Pointer(unsafe.SliceData(values)), at*8)))
		}

		dx, dy := load(v.X).Sub(x), load(v.Y).Sub(y)
		distance := dx.Mul(dx).Add(dy.Mul(dy))
		distance.StoreArray((*[4]float64)(unsafe.Pointer(&v.distanceBlock[offset])))
		kinds := archsimd.LoadInt64x4Array((*[4]int64)(unsafe.Add(unsafe.Pointer(unsafe.SliceData(v.Kinds)), at*8)))
		ids := archsimd.LoadInt64x4Array((*[4]int64)(unsafe.Add(unsafe.Pointer(unsafe.SliceData(v.IDs)), at*8)))
		far := distance.Greater(entity).And(distance.Greater(marker).Or(kinds.And(one).Equal(zero))).And(ids.NotEqual(owned))
		rejected |= uint16(far.ToBits()) << offset
	}

	archsimd.ClearAVXUpperBits()
	return rejected
}
