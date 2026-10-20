package protocol

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
)

var ErrControl = errors.New("invalid binary control")

type Input struct {
	HornDrill, CargoHatch, SearchLight, ShieldGenerator bool
	Launch, Fire, CargoRelease                          bool
	PlasmaActive, AutogunActive, LaserActive            bool
	Thrust, Turn                                        float64
}

type DockAction struct {
	Action                         string
	Module, ModuleID, Mount, Paint int64
	HullIndex                      int64
	ObjectIDs                      []int64
	HasModuleID, HasMount          bool
}

type Control struct {
	GateID         uint64
	Channel        byte
	Text           string
	DisplayName    string
	Type           string
	PlayerToken    string
	Tick, Sequence uint64
	Input          Input
	Offset         float64
	HasOffset      bool
	Dock           DockAction
}

type ServerControl struct {
	CargoDemand                  *int64
	Channel                      byte
	Sender, SenderRole, Text     string
	Sounds                       []WorldSound
	DisplayName                  *string
	SectorName                   *string
	Credits                      *float64
	UnlockedPaints               *uint16
	Type                         string
	PlayerID, ShipID, ServerTick uint64
	PlayerToken                  string
	WorldSeed                    float64
	Spawn                        specs.Vector
}

type writer struct{ data []byte }

func ValidDisplayName(value string) bool {
	return utf8.ValidString(value) && utf8.RuneCountInString(value) <= 16
}

func (w *writer) name(value string) error {
	if !ValidDisplayName(value) {
		return ErrControl
	}

	w.byte(byte(len(value)))
	w.data = append(w.data, value...)
	return nil
}

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

func (r *reader) name() (string, error) {
	length, err := r.byte()

	if err != nil || length > 64 || int(length) > len(r.data)-r.offset {
		return "", ErrControl
	}

	value := string(r.data[r.offset : r.offset+int(length)])
	r.offset += int(length)

	if !ValidDisplayName(value) {
		return "", ErrControl
	}

	return value, nil
}

func DecodeClientControl(data []byte, ids specs.Protocol, step float64) (Control, error) {
	var message Control

	if len(data) < 4 || len(data) > 32*1024 || data[0] != 0x55 || data[1] != 0x43 || data[2] != 1 {
		return message, ErrControl
	}

	r := reader{data: data, offset: 4}

	switch int(data[3]) {
	case ids.ControlMessageIDs["profile"]:
		var err error
		message.Type = "profile"
		message.DisplayName, err = r.name()

		if err != nil || message.DisplayName == "" {
			return Control{}, ErrControl
		}
	case ids.ControlMessageIDs["hello"], ids.ControlMessageIDs["prepare"]:
		message.Type = "hello"

		if int(data[3]) == ids.ControlMessageIDs["prepare"] {
			message.Type = "prepare"
		}

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

		if err != nil || hasOffset > 63 {
			return Control{}, ErrControl
		}

		message.Input = Input{
			CargoRelease: hasOffset&32 != 0, Fire: hasOffset&2 != 0, PlasmaActive: hasOffset&4 != 0, AutogunActive: hasOffset&8 != 0, LaserActive: hasOffset&16 != 0, HornDrill: code&1 != 0, CargoHatch: code&2 != 0,
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
		case ids.DockActionIDs["refuel"]:
			message.Dock.Action = "refuel"
		case ids.DockActionIDs["buyAmmo"]:
			message.Dock.Action = "buyAmmo"
		case ids.DockActionIDs["buy"], ids.DockActionIDs["buyEquipped"]:
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

			if int(action) == ids.DockActionIDs["buyEquipped"] {
				value, err := r.unsigned()

				if err != nil {
					return Control{}, err
				}

				message.Dock.HasMount = true
				message.Dock.Mount = int64(value)
			}
		case ids.DockActionIDs["sell"], ids.DockActionIDs["buyStock"]:
			message.Dock.Action = "sell"

			if int(action) == ids.DockActionIDs["buyStock"] {
				message.Dock.Action = "buyStock"
			}

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
		case ids.DockActionIDs["repairHull"]:
			value, err := r.unsigned()

			if err != nil {
				return Control{}, err
			}

			message.Dock.Action = "repairHull"
			message.Dock.HullIndex = int64(value)
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

		if r.offset < len(data) {
			message.Sequence, err = r.unsigned()

			if err != nil {
				return Control{}, err
			}
		}
	case ids.ControlMessageIDs["respawn"]:
		message.Type = "respawn"
	case ids.ControlMessageIDs["gateAccess"]:
		message.Type = "gateAccess"
		var err error
		message.GateID, err = r.unsigned()

		if err != nil || message.GateID > 1<<53-1 {
			return Control{}, ErrControl
		}
	case ids.ControlMessageIDs["chat"]:
		message.Type = "chat"
		var err error
		message.Channel, err = r.byte()

		if err != nil || message.Channel > 1 {
			return Control{}, ErrControl
		}

		message.Text, err = r.text()

		if err != nil {
			return Control{}, err
		}
	case ids.ControlMessageIDs["activity"]:
		message.Type = "activity"
	case ids.ControlMessageIDs["play"]:
		message.Type = "play"
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
	if message.Type == "chat" {
		if message.Channel > 1 {
			return nil, ErrControl
		}

		w := controlWriter(ids.ControlMessageIDs["chat"])
		w.byte(message.Channel)

		if err := w.text(message.Sender); err != nil {
			return nil, err
		}

		if err := w.text(message.SenderRole); err != nil {
			return nil, err
		}

		if err := w.text(message.Text); err != nil {
			return nil, err
		}

		if message.CargoDemand != nil {
			w.unsigned(uint64(*message.CargoDemand))
		}

		return w.data, nil
	}

	if message.Type == "sounds" {
		w := controlWriter(ids.ControlMessageIDs["sounds"])
		w.unsigned(uint64(len(message.Sounds)))

		for _, sound := range message.Sounds {
			if sound.Effect > 9 || sound.Effect == 8 || sound.By < 0 || math.IsNaN(sound.Position.X) || math.IsNaN(sound.Position.Y) || math.IsInf(sound.Position.X, 0) || math.IsInf(sound.Position.Y, 0) {
				return nil, ErrControl
			}

			w.byte(sound.Effect)
			w.signed(sound.ID)
			w.unsigned(uint64(sound.By))
			w.number(sound.Position.X)
			w.number(sound.Position.Y)
		}

		return w.data, nil
	}

	if message.Type == "profile" && message.DisplayName != nil {
		w := controlWriter(ids.ControlMessageIDs["profile"])

		if err := w.name(*message.DisplayName); err != nil {
			return nil, err
		}

		return w.data, nil
	}

	if message.Credits != nil && (message.UnlockedPaints == nil || *message.Credits < 0 || math.IsNaN(*message.Credits) || math.IsInf(*message.Credits, 0)) {
		return nil, ErrControl
	}

	if message.Type == "progress" && message.UnlockedPaints != nil {
		w := controlWriter(ids.ControlMessageIDs["progress"])
		w.unsigned(uint64(*message.UnlockedPaints))

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
		w.unsigned(uint64(*message.UnlockedPaints))

		if message.Credits != nil {
			w.number(*message.Credits)
		}
	}

	if message.DisplayName != nil {
		if message.Credits == nil {
			return nil, ErrControl
		}

		if err := w.name(*message.DisplayName); err != nil {
			return nil, err
		}
	}

	if message.SectorName != nil {
		if message.DisplayName == nil {
			return nil, ErrControl
		}

		if err := w.name(*message.SectorName); err != nil {
			return nil, err
		}
	}

	return w.data, nil
}

func (w *writer) text(value string) error {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 240 {
		return ErrControl
	}

	w.unsigned(uint64(len(value)))
	w.data = append(w.data, value...)
	return nil
}

func (r *reader) text() (string, error) {
	length, err := r.unsigned()

	if err != nil || length > 960 || length > uint64(len(r.data)-r.offset) {
		return "", ErrControl
	}

	value := string(r.data[r.offset : r.offset+int(length)])
	r.offset += int(length)

	if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 240 {
		return "", ErrControl
	}

	return value, nil
}
