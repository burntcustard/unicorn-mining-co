// Port of src/client/protocol/input-frame.ts.
package protocol

type InputChange struct {
	Input  Input
	Offset float64
}
type InputFrame struct {
	Input   Input
	Changes []InputChange
}
