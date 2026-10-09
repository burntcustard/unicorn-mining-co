package network

import (
	"context"
	"encoding/json"
	"github.com/burntcustard/unicorn-mining-co/src/server/protocol"
	"github.com/burntcustard/unicorn-mining-co/src/server/specs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIdentityPreviewIsReadOnly(t *testing.T) {
	catalog, err := specs.Load()

	if err != nil {
		t.Fatal(err)
	}

	server := NewGameServer(25, catalog)
	socket := &benchmarkSocket{}
	server.session.Receive(protocol.Control{Type: "hello"}, socket)
	p := server.session.playersBySocket[socket]
	before, _ := json.Marshal(server.session.identityPreview(p.profile.ID))
	nextID, nextEntity, tick := server.session.nextPlayerID, server.session.World.NextEntityID, server.session.World.Tick

	if server.session.identityPreview("00000000-0000-0000-0000-000000000000") != nil {
		t.Fatal("unknown ID was accepted")
	}

	after, _ := json.Marshal(server.session.identityPreview(p.profile.ID))

	if string(before) != string(after) || nextID != server.session.nextPlayerID || nextEntity != server.session.World.NextEntityID || tick != server.session.World.Tick || p.socket != socket {
		t.Fatal("verification mutated the session")
	}

	if strings.Contains(string(after), p.profile.ID) {
		t.Fatal("response disclosed the private ID")
	}

	go server.run()

	defer func() { _ = server.Stop(context.Background()); <-server.stopped }()

	for _, test := range []struct {
		method, body string
		status       int
	}{
		{"GET", "", 405}, {"POST", "invalid", 400}, {"POST", strings.Repeat("a", 100), 400},
		{"POST", "00000000-0000-0000-0000-000000000000", 404}, {"POST", p.profile.ID, 200},
	} {
		response := httptest.NewRecorder()
		server.handleIdentity(response, httptest.NewRequest(test.method, "/api/identity", strings.NewReader(test.body)))

		if response.Code != test.status {
			t.Fatalf("status = %d, want %d", response.Code, test.status)
		}

		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("identity response is cacheable")
		}

		if response.Code == http.StatusOK && response.Body.String() != string(before)+"\n" {
			t.Fatal("preview changed across HTTP")
		}
	}
}
