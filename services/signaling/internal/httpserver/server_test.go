package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestHealthzReturnsOKJSON(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	newHandler().ServeHTTP(recorder, request)

	assertStatusResponse(t, recorder.Result(), http.StatusOK)
}

func TestReadyzReturnsOKJSON(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)

	newHandler().ServeHTTP(recorder, request)

	assertStatusResponse(t, recorder.Result(), http.StatusOK)
}

func TestUnknownRouteReturnsNotFound(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/unknown", nil)

	newHandler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, recorder.Code)
	}
}

func TestHealthzRejectsNonGetMethods(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/healthz", nil)

	newHandler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != http.MethodGet {
		t.Fatalf("expected Allow header %q, got %q", http.MethodGet, got)
	}
}

func TestReadyzRejectsNonGetMethods(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/readyz", nil)

	newHandler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != http.MethodGet {
		t.Fatalf("expected Allow header %q, got %q", http.MethodGet, got)
	}
}

func TestRoomRouteRejectsNonGetMethods(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/signaling/rooms/session-123", nil)

	newHandler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != http.MethodGet {
		t.Fatalf("expected Allow header %q, got %q", http.MethodGet, got)
	}
}

func TestRoomRouteRejectsMissingSessionID(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/signaling/rooms?participant_id=participant-abc&role=host", nil)

	newHandler().ServeHTTP(recorder, request)

	assertHTTPErrorResponse(t, recorder.Result(), http.StatusBadRequest, "missing session_id")
}

func TestRoomRouteRejectsMissingParticipantID(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/signaling/rooms/session-123?role=host", nil)

	newHandler().ServeHTTP(recorder, request)

	assertHTTPErrorResponse(t, recorder.Result(), http.StatusBadRequest, "missing participant_id")
}

func TestRoomRouteRejectsMissingRole(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/signaling/rooms/session-123?participant_id=participant-abc", nil)

	newHandler().ServeHTTP(recorder, request)

	assertHTTPErrorResponse(t, recorder.Result(), http.StatusBadRequest, "missing role")
}

func TestRoomRouteRejectsUnsupportedRole(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/signaling/rooms/session-123?participant_id=participant-abc&role=moderator", nil)

	newHandler().ServeHTTP(recorder, request)

	assertHTTPErrorResponse(t, recorder.Result(), http.StatusBadRequest, "unsupported role")
}

func TestRoomRouteRejectsNonWebSocketRequests(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/signaling/rooms/session-123?participant_id=participant-abc&role=host", nil)

	newHandler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, recorder.Code)
	}
}

func TestRoomRouteSendsRoomStateWhenHostJoinsAlone(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })

	_, payload := readWebSocketMessage(t, ctx, hostConn)
	assertWebSocketMessage(t, payload, wsRoomStateMessage{
		Type:      "room-state",
		SessionID: "session-123",
		Self: wsParticipantPayload{
			ParticipantID: "participant-host",
			Role:          hostRole,
		},
		Peer: nil,
	})
}

func TestRoomRouteSendsRoomStateWithPeerWhenGuestJoins(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })
	_, _ = readWebSocketMessage(t, ctx, hostConn)

	guestConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-guest", guestRole)
	t.Cleanup(func() { _ = guestConn.CloseNow() })

	_, payload := readWebSocketMessage(t, ctx, guestConn)
	assertWebSocketMessage(t, payload, wsRoomStateMessage{
		Type:      "room-state",
		SessionID: "session-123",
		Self: wsParticipantPayload{
			ParticipantID: "participant-guest",
			Role:          guestRole,
		},
		Peer: &wsParticipantPayload{
			ParticipantID: "participant-host",
			Role:          hostRole,
		},
	})
}

func TestRoomRouteNotifiesPeerJoined(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })
	_, _ = readWebSocketMessage(t, ctx, hostConn)

	guestConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-guest", guestRole)
	t.Cleanup(func() { _ = guestConn.CloseNow() })
	_, _ = readWebSocketMessage(t, ctx, guestConn)

	_, payload := readWebSocketMessage(t, ctx, hostConn)
	assertWebSocketMessage(t, payload, wsPeerEventMessage{
		Type:      "peer-joined",
		SessionID: "session-123",
		Participant: wsParticipantPayload{
			ParticipantID: "participant-guest",
			Role:          guestRole,
		},
	})
}

func TestRoomRouteNotifiesPeerLeft(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })
	_, _ = readWebSocketMessage(t, ctx, hostConn)

	guestConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-guest", guestRole)
	_, _ = readWebSocketMessage(t, ctx, guestConn)
	_, _ = readWebSocketMessage(t, ctx, hostConn)

	if err := guestConn.Close(websocket.StatusNormalClosure, "test guest leaving"); err != nil {
		t.Fatalf("close guest websocket: %v", err)
	}

	_, payload := readWebSocketMessage(t, ctx, hostConn)
	assertWebSocketMessage(t, payload, wsPeerEventMessage{
		Type:      "peer-left",
		SessionID: "session-123",
		Participant: wsParticipantPayload{
			ParticipantID: "participant-guest",
			Role:          guestRole,
		},
	})
}

func TestRoomRelayForwardsSignalMessagesBetweenParticipants(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })
	_, _ = readWebSocketMessage(t, ctx, hostConn)

	guestConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-guest", guestRole)
	t.Cleanup(func() { _ = guestConn.CloseNow() })
	_, _ = readWebSocketMessage(t, ctx, guestConn)
	_, _ = readWebSocketMessage(t, ctx, hostConn)

	hostMessage := `{"type":"signal","payload":{"kind":"placeholder","data":{"from":"host"}}}`
	if err := hostConn.Write(ctx, websocket.MessageText, []byte(hostMessage)); err != nil {
		t.Fatalf("write host message: %v", err)
	}

	_, payload := readWebSocketMessage(t, ctx, guestConn)
	assertWebSocketMessage(t, payload, wsSignalEnvelope{
		Type: "signal",
		From: wsSignalFrom{
			ParticipantID: "participant-host",
			Role:          hostRole,
		},
		Payload: json.RawMessage(`{"kind":"placeholder","data":{"from":"host"}}`),
	})

	guestMessage := `{"type":"signal","payload":{"kind":"placeholder","data":{"from":"guest"}}}`
	if err := guestConn.Write(ctx, websocket.MessageText, []byte(guestMessage)); err != nil {
		t.Fatalf("write guest message: %v", err)
	}

	_, payload = readWebSocketMessage(t, ctx, hostConn)
	assertWebSocketMessage(t, payload, wsSignalEnvelope{
		Type: "signal",
		From: wsSignalFrom{
			ParticipantID: "participant-guest",
			Role:          guestRole,
		},
		Payload: json.RawMessage(`{"kind":"placeholder","data":{"from":"guest"}}`),
	})
}

func TestRoomRouteReportsPeerNotConnected(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })
	_, _ = readWebSocketMessage(t, ctx, hostConn)

	message := `{"type":"signal","payload":{"kind":"placeholder","data":{}}}`
	if err := hostConn.Write(ctx, websocket.MessageText, []byte(message)); err != nil {
		t.Fatalf("write host message: %v", err)
	}

	_, payload := readWebSocketMessage(t, ctx, hostConn)
	assertWebSocketMessage(t, payload, wsErrorResponse{
		Type: "error",
		Error: wsErrorDetail{
			Code:    "peer_not_connected",
			Message: "Peer is not connected.",
		},
	})
}

func TestRoomRouteRejectsUnsupportedMessageType(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })
	_, _ = readWebSocketMessage(t, ctx, hostConn)

	if err := hostConn.Write(ctx, websocket.MessageText, []byte(`{"type":"noop","payload":{}}`)); err != nil {
		t.Fatalf("write unsupported message: %v", err)
	}

	_, payload := readWebSocketMessage(t, ctx, hostConn)
	assertWebSocketMessage(t, payload, wsErrorResponse{
		Type: "error",
		Error: wsErrorDetail{
			Code:    "unsupported_message_type",
			Message: "Only signal messages are supported.",
		},
	})
}

func TestRoomRouteRejectsInvalidJSON(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })
	_, _ = readWebSocketMessage(t, ctx, hostConn)

	if err := hostConn.Write(ctx, websocket.MessageText, []byte(`not-json`)); err != nil {
		t.Fatalf("write invalid json: %v", err)
	}

	_, payload := readWebSocketMessage(t, ctx, hostConn)
	assertWebSocketMessage(t, payload, wsErrorResponse{
		Type: "error",
		Error: wsErrorDetail{
			Code:    "invalid_json",
			Message: "Message must be valid JSON.",
		},
	})
}

func TestRoomRouteRejectsDuplicateHost(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })

	duplicateConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host-duplicate", hostRole)
	t.Cleanup(func() { _ = duplicateConn.CloseNow() })

	_, payload := readWebSocketMessage(t, ctx, duplicateConn)
	assertWebSocketMessage(t, payload, wsErrorResponse{
		Type: "error",
		Error: wsErrorDetail{
			Code:    "duplicate_participant",
			Message: "Host is already connected.",
		},
	})
}

func TestRoomRouteRejectsDuplicateGuest(t *testing.T) {
	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	hostConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-host", hostRole)
	t.Cleanup(func() { _ = hostConn.CloseNow() })

	guestConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-guest", guestRole)
	t.Cleanup(func() { _ = guestConn.CloseNow() })

	duplicateConn := dialRoomParticipant(t, ctx, server.URL, "session-123", "participant-guest-duplicate", guestRole)
	t.Cleanup(func() { _ = duplicateConn.CloseNow() })

	_, payload := readWebSocketMessage(t, ctx, duplicateConn)
	assertWebSocketMessage(t, payload, wsErrorResponse{
		Type: "error",
		Error: wsErrorDetail{
			Code:    "duplicate_participant",
			Message: "Guest is already connected.",
		},
	})
}

func TestRoomCleanupRemovesEmptyRoom(t *testing.T) {
	manager := newRoomManager()

	hostMembership, err := manager.join("session-123", wsParticipant{
		participantID: "participant-host",
		role:          hostRole,
	}, nil)
	if err != nil {
		t.Fatalf("join host: %v", err)
	}

	guestMembership, err := manager.join("session-123", wsParticipant{
		participantID: "participant-guest",
		role:          guestRole,
	}, nil)
	if err != nil {
		t.Fatalf("join guest: %v", err)
	}

	if got := len(manager.rooms); got != 1 {
		t.Fatalf("expected 1 room, got %d", got)
	}

	hostMembership.leave()
	if got := len(manager.rooms); got != 1 {
		t.Fatalf("expected room to stay while guest is connected, got %d", got)
	}

	guestMembership.leave()
	if got := len(manager.rooms); got != 0 {
		t.Fatalf("expected empty room to be removed, got %d", got)
	}
}

func dialRoomParticipant(t *testing.T, ctx context.Context, serverURL, sessionID, participantID, role string) *websocket.Conn {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + "/v1/signaling/rooms/" + sessionID + "?participant_id=" + participantID + "&role=" + role
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}

	return conn
}

func readWebSocketMessage(t *testing.T, ctx context.Context, conn *websocket.Conn) (websocket.MessageType, []byte) {
	t.Helper()

	messageType, payload, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read websocket message: %v", err)
	}
	if messageType != websocket.MessageText {
		t.Fatalf("expected text message type, got %v", messageType)
	}

	return messageType, payload
}

func assertHTTPErrorResponse(t *testing.T, response *http.Response, expectedStatus int, expectedError string) {
	t.Helper()
	defer response.Body.Close()

	if response.StatusCode != expectedStatus {
		t.Fatalf("expected status %d, got %d", expectedStatus, response.StatusCode)
	}

	contentType := response.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("expected JSON content type, got %q", contentType)
	}

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}

	var payload errorResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}

	if payload.Error != expectedError {
		t.Fatalf("expected error %q, got %q", expectedError, payload.Error)
	}
}

func assertStatusResponse(t *testing.T, response *http.Response, expectedStatus int) {
	t.Helper()
	defer response.Body.Close()

	if response.StatusCode != expectedStatus {
		t.Fatalf("expected status %d, got %d", expectedStatus, response.StatusCode)
	}

	contentType := response.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		t.Fatalf("expected JSON content type, got %q", contentType)
	}

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}

	var payload statusResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}

	if payload.Status != "ok" {
		t.Fatalf("expected status %q, got %q", "ok", payload.Status)
	}

	if payload.Service != serviceName {
		t.Fatalf("expected service %q, got %q", serviceName, payload.Service)
	}
}

func assertWebSocketMessage[T any](t *testing.T, payload []byte, expected T) {
	t.Helper()

	var got T
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("unmarshal websocket payload: %v", err)
	}

	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("expected %+v, got %+v", expected, got)
	}
}
