package network

import (
	"encoding/json"
	"fmt"
	"github.com/burntcustard/unicorn-mining-co/src/server/objects"
	"github.com/google/uuid"
	"io"
	"net/http"
	"slices"
	"strings"
)

type identityRequest struct {
	privateID string
	result    chan []any
}

// The session owner captures a read-only view. Verification never joins,
// creates a player, disconnects a socket or changes the saved identity.
func (s *GameSession) identityPreview(privateID string) []any {
	p, ok := s.players.Get(privateID)

	if !ok {
		return nil
	}

	ship := objects.CaptureShip(p.ship)
	paint := -1

	if ship.Paint != nil {
		paint = *ship.Paint
	}

	modules := make([]any, 0, len(ship.Modules))

	for _, module := range ship.Modules {
		shade := -1

		if module.Paint != nil {
			shade = *module.Paint
		}

		var health any

		if module.Health != nil {
			health = *module.Health
		}

		modules = append(modules, []any{slices.Index(s.World.Specification.ModuleIDs, module.Type), module.Mount, shade, health})
	}

	return []any{fmt.Sprintf("PILOT %03d", p.playerID), p.profile.Credits, []any{ship.Type, paint, ship.Hull, modules}}
}

func (s *GameServer) handleIdentity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")

	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}

	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64))
	privateID := strings.ToLower(strings.TrimSpace(string(data)))

	if _, parseErr := uuid.Parse(privateID); err != nil || len(privateID) != 36 || parseErr != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	request := identityRequest{privateID: privateID, result: make(chan []any, 1)}

	select {
	case s.identities <- request:
	case <-r.Context().Done():
		return
	case <-s.done:
		http.Error(w, "Server unavailable", http.StatusServiceUnavailable)
		return
	}

	select {
	case result := <-request.result:
		if result == nil {
			http.Error(w, "Unknown ID", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	case <-r.Context().Done():
	case <-s.done:
		http.Error(w, "Server unavailable", http.StatusServiceUnavailable)
	}
}
