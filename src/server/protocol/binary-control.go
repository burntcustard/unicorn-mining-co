package protocol

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"math"
	"strings"

	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

var ErrControl = errors.New("invalid binary control")

type Input struct {
	HornDrill, CargoHatch, SearchLight, ShieldGenerator, Launch, Fire bool
	Thrust, Turn                                                      float64
}

type DockAction struct {
	Action                         string
	Module, ModuleID, Mount, Paint int64
	ObjectIDs                      []int64
	HasModuleID, HasMount          bool
}

type Control struct {
	Type           string
	PlayerToken    string
	Tick, Sequence uint64
	Input          Input
	Offset         float64
	HasOffset      bool
	Dock           DockAction
}

type ServerControl struct {
	Credits                      *float64
	UnlockedPaints               *uint8
	Type                         string
	PlayerID, ShipID, ServerTick uint64
	PlayerToken                  string
	WorldSeed                    float64
	Spawn                        specs.Vector
}

type writer struct{ data []byte }

func (w *writer) byte(value byte) { w.data = append(w.data, value) }

func (w *writer) unsigned(value uint64) {
	for value >= 128 {
		w.byte(byte(value) | 128)
		value >>= 7
	}

	w.byte(byte(value))
}

func (w *writer) signed(value int64) {
	if value >= 0 {
		w.unsigned(uint64(value) * 2)
	} else {
		w.unsigned(uint64(-value)*2 - 1)
	}
}

func (w *writer) number(value float64) {
	var buffer [8]byte
	binary.LittleEndian.PutUint64(buffer[:], math.Float64bits(value))
	w.data = append(w.data, buffer[:]...)
}

func (w *writer) uuid(value string) error {
	digits := strings.ReplaceAll(value, "-", "")

	if len(value) != 36 || len(digits) != 32 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return ErrControl
	}

	decoded, err := hex.DecodeString(digits)

	if err != nil {
		return ErrControl
	}

	w.data = append(w.data, decoded...)
	return nil
}

func controlWriter(kind int) writer { return writer{data: []byte{0x55, 0x43, 1, byte(kind)}} }

type reader struct {
	data   []byte
	offset int
}

func (r *reader) byte() (byte, error) {
	if r.offset >= len(r.data) {
		return 0, ErrControl
	}

	value := r.data[r.offset]
	r.offset++
	return value, nil
}

func (r *reader) unsigned() (uint64, error) { return r.unsignedLimit((1 << 53) - 1) }

func (r *reader) unsignedLimit(limit uint64) (uint64, error) {
	var value uint64

	for index := range 8 {
		part, err := r.byte()

		if err != nil {
			return 0, err
		}

		digit := uint64(part & 127)
		value |= digit << (7 * index)

		if part&128 == 0 {
			if (index > 0 && digit == 0) || value > limit {
				return 0, ErrControl
			}

			return value, nil
		}
	}

	return 0, ErrControl
}

func (r *reader) signed() (int64, error) {
	encoded, err := r.unsignedLimit(2 * ((1 << 53) - 1))

	if err != nil {
		return 0, err
	}

	if encoded&1 != 0 {
		return -int64((encoded + 1) / 2), nil
	}

	return int64(encoded / 2), nil
}

func (r *reader) number() (float64, error) {
	if len(r.data)-r.offset < 8 {
		return 0, ErrControl
	}

	value := math.Float64frombits(binary.LittleEndian.Uint64(r.data[r.offset:]))
	r.offset += 8

	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, ErrControl
	}

	if value == 0 {
		return 0, nil
	}

	return value, nil
}

func (r *reader) uuid() (string, error) {
	if len(r.data)-r.offset < 16 {
		return "", ErrControl
	}

	digits := hex.EncodeToString(r.data[r.offset : r.offset+16])
	r.offset += 16
	return digits[:8] + "-" + digits[8:12] + "-" + digits[12:16] + "-" + digits[16:20] + "-" + digits[20:], nil
}

func DecodeClientControl(data []byte, ids specs.Protocol, step float64) (Control, error) {
	var message Control

	if len(data) < 4 || len(data) > 32*1024 || data[0] != 0x55 || data[1] != 0x43 || data[2] != 1 {
		return message, ErrControl
	}

	r := reader{data: data, offset: 4}

	switch int(data[3]) {
	case ids.ControlMessageIDs["hello"]:
		message.Type = "hello"
		present, err := r.byte()

		if err != nil || present > 1 {
			return Control{}, ErrControl
		}

		if present == 1 {
			message.PlayerToken, err = r.uuid()

			if err != nil {
				return Control{}, err
			}
		}
	case ids.ControlMessageIDs["input"]:
		message.Type = "input"
		var err error
		message.Tick, err = r.unsigned()

		if err != nil {
			return Control{}, err
		}

		message.Sequence, err = r.unsigned()

		if err != nil {
			return Control{}, err
		}

		code, err := r.byte()

		if err != nil || code >= 192 {
			return Control{}, ErrControl
		}

		hasOffset, err := r.byte()

		if err != nil || hasOffset > 3 {
			return Control{}, ErrControl
		}

		message.Input = Input{
			Fire: hasOffset&2 != 0, HornDrill: code&1 != 0, CargoHatch: code&2 != 0,
			SearchLight: code&4 != 0, ShieldGenerator: code&8 != 0,
			Launch: code&16 != 0, Thrust: float64((code >> 5) & 1),
			Turn: float64((code>>7)&1) - float64((code>>6)&1),
		}

		if hasOffset&1 != 0 {
			message.Offset, err = r.number()

			if err != nil || message.Offset < 0 || message.Offset >= step {
				return Control{}, ErrControl
			}

			message.HasOffset = true
		}
	case ids.ControlMessageIDs["dock"]:
		message.Type = "dock"
		action, err := r.byte()

		if err != nil {
			return Control{}, err
		}

		switch int(action) {
		case ids.DockActionIDs["buyAmmo"]:
			message.Dock.Action = "buyAmmo"
		case ids.DockActionIDs["buy"]:
			message.Dock.Action = "buy"
			message.Dock.HasModuleID = true
			value, err := r.unsigned()

			if err != nil {
				return Control{}, err
			}

			message.Dock.Module = int64(value)
			message.Dock.ModuleID, err = r.signed()

			if err != nil {
				return Control{}, err
			}
		case ids.DockActionIDs["sell"]:
			message.Dock.Action = "sell"
			count, err := r.byte()

			if err != nil || count < 1 || count > 100 {
				return Control{}, ErrControl
			}

			for index := 0; index < int(count); index++ {
				id, err := r.signed()

				if err != nil {
					return Control{}, err
				}

				message.Dock.ObjectIDs = append(message.Dock.ObjectIDs, id)
			}
		case ids.DockActionIDs["equip"]:
			message.Dock.Action = "equip"
			message.Dock.HasModuleID = true
			message.Dock.HasMount = true
			message.Dock.ModuleID, err = r.signed()

			if err != nil {
				return Control{}, err
			}

			value, err := r.unsigned()

			if err != nil {
				return Control{}, err
			}

			message.Dock.Mount = int64(value)
		case ids.DockActionIDs["remove"]:
			message.Dock.Action = "remove"
			message.Dock.HasMount = true
			value, err := r.unsigned()

			if err != nil {
				return Control{}, err
			}

			message.Dock.Mount = int64(value)
		case ids.DockActionIDs["paint"], ids.DockActionIDs["repair"]:
			if int(action) == ids.DockActionIDs["paint"] {
				message.Dock.Action = "paint"
				value, err := r.unsigned()

				if err != nil {
					return Control{}, err
				}

				message.Dock.Paint = int64(value)
			} else {
				message.Dock.Action = "repair"
			}

			mask, err := r.byte()

			if err != nil || mask&^3 != 0 {
				return Control{}, ErrControl
			}

			if mask&1 != 0 {
				message.Dock.ModuleID, err = r.signed()

				if err != nil {
					return Control{}, err
				}

				message.Dock.HasModuleID = true
			}

			if mask&2 != 0 {
				message.Dock.Mount, err = r.signed()

				if err != nil {
					return Control{}, err
				}

				message.Dock.HasMount = true
			}
		default:
			return Control{}, ErrControl
		}
	case ids.ControlMessageIDs["respawn"]:
		message.Type = "respawn"
	case ids.ControlMessageIDs["snapshotAck"]:
		message.Type = "snapshotAck"
		var err error
		message.Sequence, err = r.unsigned()

		if err != nil {
			return Control{}, err
		}
	default:
		return Control{}, ErrControl
	}

	if r.offset != len(data) {
		return Control{}, ErrControl
	}

	return message, nil
}

func EncodeServerControl(message ServerControl, ids specs.Protocol) ([]byte, error) {
	if message.Credits != nil && (message.UnlockedPaints == nil || *message.Credits < 0 || math.IsNaN(*message.Credits) || math.IsInf(*message.Credits, 0)) {
		return nil, ErrControl
	}

	if message.Type == "progress" && message.UnlockedPaints != nil {
		w := controlWriter(ids.ControlMessageIDs["progress"])
		w.byte(*message.UnlockedPaints)

		if message.Credits != nil {
			w.number(*message.Credits)
		}

		return w.data, nil
	}

	if message.Type == "respawn" {
		w := controlWriter(ids.ControlMessageIDs["respawn"])
		w.unsigned(message.ShipID)
		return w.data, nil
	}

	if message.Type != "welcome" {
		return nil, ErrControl
	}

	w := controlWriter(ids.ControlMessageIDs["welcome"])
	w.unsigned(message.PlayerID)
	w.unsigned(message.ShipID)
	w.unsigned(message.ServerTick)

	if err := w.uuid(message.PlayerToken); err != nil {
		return nil, err
	}

	w.number(message.WorldSeed)
	w.number(message.Spawn.X)
	w.number(message.Spawn.Y)

	if message.UnlockedPaints != nil {
		w.byte(*message.UnlockedPaints)

		if message.Credits != nil {
			w.number(*message.Credits)
		}
	}

	return w.data, nil
}
