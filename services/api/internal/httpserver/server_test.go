package httpserver

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthzReturnsOKJSON(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	newHandler(Dependencies{}).ServeHTTP(recorder, request)

	assertStatusResponse(t, recorder.Result(), http.StatusOK)
}

func TestReadyzReturnsOKJSON(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)

	newHandler(Dependencies{}).ServeHTTP(recorder, request)

	assertStatusResponse(t, recorder.Result(), http.StatusOK)
}

func TestUnknownRouteReturnsNotFound(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/unknown", nil)

	newHandler(Dependencies{}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, recorder.Code)
	}
}

func TestHealthzRejectsNonGetMethods(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/healthz", nil)

	newHandler(Dependencies{}).ServeHTTP(recorder, request)

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

	newHandler(Dependencies{}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != http.MethodGet {
		t.Fatalf("expected Allow header %q, got %q", http.MethodGet, got)
	}
}

func TestOptionsRequestsReturnCORSPreflightHeaders(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/v1/sessions", nil)
	request.Header.Set("Origin", "http://localhost:5175")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)

	newHandler(Dependencies{}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected status %d, got %d", http.StatusNoContent, recorder.Code)
	}

	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("expected Access-Control-Allow-Origin %q, got %q", "*", got)
	}

	if got := recorder.Header().Get("Access-Control-Allow-Methods"); got != "GET, POST, OPTIONS" {
		t.Fatalf("expected Access-Control-Allow-Methods %q, got %q", "GET, POST, OPTIONS", got)
	}

	if got := recorder.Header().Get("Access-Control-Allow-Headers"); got != "Content-Type" {
		t.Fatalf("expected Access-Control-Allow-Headers %q, got %q", "Content-Type", got)
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

	if payload.Service != "api" {
		t.Fatalf("expected service %q, got %q", "api", payload.Service)
	}
}
