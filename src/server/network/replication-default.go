//go:build !goexperiment.simd || !amd64

package network

const vectorReplication = false

func (v *ReplicationView) packReplicationIDs() {}

func (v *ReplicationView) replicationBlock(index int, px, py, entitySquared, markerSquared float64, shipID int64) uint16 {
	return 0
}
