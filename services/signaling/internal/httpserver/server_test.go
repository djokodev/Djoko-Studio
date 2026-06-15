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

func TestWSRejectsNonGetMethods(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/ws", nil)

	newHandler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != http.MethodGet {
		t.Fatalf("expected Allow header %q, got %q", http.MethodGet, got)
	}
}

func TestWSAcceptsConnectionAndEchoesMessages(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(newHandler())
	t.Cleanup(server.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.CloseNow()

	messageType, payload, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read welcome message: %v", err)
	}

	if messageType != websocket.MessageText {
		t.Fatalf("expected welcome message type text, got %v", messageType)
	}

	assertWebSocketMessage(t, payload, welcomeResponse{
		Type:    "welcome",
		Service: serviceName,
	})

	if err := conn.Write(ctx, websocket.MessageText, []byte("hello")); err != nil {
		t.Fatalf("write websocket message: %v", err)
	}

	messageType, payload, err = conn.Read(ctx)
	if err != nil {
		t.Fatalf("read echo message: %v", err)
	}

	if messageType != websocket.MessageText {
		t.Fatalf("expected echo message type text, got %v", messageType)
	}

	assertWebSocketMessage(t, payload, echoResponse{
		Type:    "echo",
		Service: serviceName,
		Payload: "hello",
	})
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
