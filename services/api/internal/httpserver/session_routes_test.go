package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
	"github.com/djokodev/Djoko-Studio/services/api/internal/invite"
	"github.com/djokodev/Djoko-Studio/services/api/internal/storage"
)

type fakeSessionStore struct {
	createSessionFunc               func(ctx context.Context, params storage.CreateSessionParams) (domain.Session, error)
	getSessionFunc                  func(ctx context.Context, id string) (domain.Session, error)
	getSessionByInviteTokenHashFunc func(ctx context.Context, inviteTokenHash string) (domain.Session, error)
	listSessionsFunc                func(ctx context.Context, studioID string) ([]domain.Session, error)
}

func (f fakeSessionStore) CreateSession(ctx context.Context, params storage.CreateSessionParams) (domain.Session, error) {
	return f.createSessionFunc(ctx, params)
}

func (f fakeSessionStore) GetSession(ctx context.Context, id string) (domain.Session, error) {
	return f.getSessionFunc(ctx, id)
}

func (f fakeSessionStore) GetSessionByInviteTokenHash(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
	return f.getSessionByInviteTokenHashFunc(ctx, inviteTokenHash)
}

func (f fakeSessionStore) ListSessionsByStudio(ctx context.Context, studioID string) ([]domain.Session, error) {
	return f.listSessionsFunc(ctx, studioID)
}

func TestPostSessionsCreatesSessionAndReturnsGuestInviteToken(t *testing.T) {
	t.Parallel()

	scheduledAt := time.Date(2026, time.January, 15, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(2 * time.Minute)

	var storedInviteTokenHash string

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			createSessionFunc: func(ctx context.Context, params storage.CreateSessionParams) (domain.Session, error) {
				if params.StudioID != "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d" {
					t.Fatalf("expected studio id to be forwarded, got %q", params.StudioID)
				}

				if params.HostUserID != "3c9abfe7-3133-4924-b159-f62277dfce7c" {
					t.Fatalf("expected host user id to be forwarded, got %q", params.HostUserID)
				}

				if params.InviteTokenHash == "" {
					t.Fatal("expected invite token hash to be generated")
				}
				storedInviteTokenHash = params.InviteTokenHash

				if params.Title != "Interview with guest" {
					t.Fatalf("expected title to be forwarded, got %q", params.Title)
				}

				if params.Status != domain.SessionStatusDraft {
					t.Fatalf("expected draft status, got %q", params.Status)
				}

				if params.ScheduledAt == nil || !params.ScheduledAt.Equal(scheduledAt) {
					t.Fatalf("expected scheduled at %v, got %v", scheduledAt, params.ScheduledAt)
				}

				return domain.Session{
					ID:          "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
					StudioID:    params.StudioID,
					HostUserID:  params.HostUserID,
					Title:       params.Title,
					Status:      params.Status,
					ScheduledAt: params.ScheduledAt,
					CreatedAt:   createdAt,
					UpdatedAt:   updatedAt,
				}, nil
			},
		},
	})

	body := `{"studio_id":"2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d","host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","title":"Interview with guest","scheduled_at":"2026-01-15T10:00:00Z"}`
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/sessions", strings.NewReader(body))

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, recorder.Code)
	}

	var payload struct {
		Session struct {
			ID              string `json:"id"`
			Status          string `json:"status"`
			InviteTokenHash string `json:"invite_token_hash"`
		} `json:"session"`
		GuestInviteToken string `json:"guest_invite_token"`
		InviteTokenHash  string `json:"invite_token_hash"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if payload.Session.ID != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
		t.Fatalf("expected response id, got %#v", payload.Session.ID)
	}

	if payload.Session.Status != "draft" {
		t.Fatalf("expected response status draft, got %#v", payload.Session.Status)
	}

	if payload.GuestInviteToken == "" {
		t.Fatal("expected guest invite token in response")
	}

	if want := invite.HashToken(payload.GuestInviteToken); storedInviteTokenHash != want {
		t.Fatalf("expected stored invite token hash %q, got %q", want, storedInviteTokenHash)
	}

	if payload.InviteTokenHash != "" {
		t.Fatalf("expected no invite token hash at top level, got %q", payload.InviteTokenHash)
	}

	if payload.Session.InviteTokenHash != "" {
		t.Fatalf("expected no invite token hash in session response, got %q", payload.Session.InviteTokenHash)
	}
}

func TestPostSessionsRejectsMissingRequiredField(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			createSessionFunc: func(ctx context.Context, params storage.CreateSessionParams) (domain.Session, error) {
				t.Fatal("expected create session not to be called")
				return domain.Session{}, nil
			},
		},
	})

	body := `{"studio_id":"2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d","host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/sessions", strings.NewReader(body))

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusBadRequest, "title is required")
}

func TestPostSessionsRejectsInvalidStatus(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			createSessionFunc: func(ctx context.Context, params storage.CreateSessionParams) (domain.Session, error) {
				t.Fatal("expected create session not to be called")
				return domain.Session{}, nil
			},
		},
	})

	body := `{"studio_id":"2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d","host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","title":"Interview with guest","status":"broken"}`
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/sessions", strings.NewReader(body))

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusBadRequest, "status is invalid")
}

func TestPostSessionsRejectsMalformedJSON(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			createSessionFunc: func(ctx context.Context, params storage.CreateSessionParams) (domain.Session, error) {
				t.Fatal("expected create session not to be called")
				return domain.Session{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/sessions", strings.NewReader("{"))

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusBadRequest, "invalid json body")
}

func TestGetSessionByIDReturnsSession(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(2 * time.Minute)

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				if id != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
					t.Fatalf("expected session id lookup, got %q", id)
				}

				return domain.Session{
					ID:         id,
					StudioID:   "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
					HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
					Title:      "Interview with guest",
					Status:     domain.SessionStatusWaiting,
					CreatedAt:  createdAt,
					UpdatedAt:  updatedAt,
				}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if payload["id"] != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
		t.Fatalf("expected response id, got %#v", payload["id"])
	}

	if payload["status"] != "waiting" {
		t.Fatalf("expected response status waiting, got %#v", payload["status"])
	}
}

func TestGetSessionByIDReturnsNotFound(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				return domain.Session{}, storage.ErrNotFound
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusNotFound, "session not found")
}

func TestGetGuestSessionByInviteTokenReturnsSession(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(2 * time.Minute)
	rawInviteToken := "guest-token-for-lookup"

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				if want := invite.HashToken(rawInviteToken); inviteTokenHash != want {
					t.Fatalf("expected invite token hash %q, got %q", want, inviteTokenHash)
				}

				return domain.Session{
					ID:         "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
					StudioID:   "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
					HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
					Title:      "Interview with guest",
					Status:     domain.SessionStatusWaiting,
					CreatedAt:  createdAt,
					UpdatedAt:  updatedAt,
				}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/guest/sessions/"+rawInviteToken, nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if payload["id"] != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
		t.Fatalf("expected response id, got %#v", payload["id"])
	}
}

func TestGetGuestSessionByInviteTokenReturnsNotFound(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				return domain.Session{}, storage.ErrNotFound
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/guest/sessions/guest-token-for-lookup", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusNotFound, "session not found")
}

func TestGetGuestSessionByInviteTokenReturnsInternalServerErrorOnUnexpectedStoreError(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				return domain.Session{}, errors.New("boom")
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/guest/sessions/guest-token-for-lookup", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusInternalServerError, "failed to fetch session")
}

func TestListSessionsByStudioReturnsSessions(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(2 * time.Minute)

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			listSessionsFunc: func(ctx context.Context, studioID string) ([]domain.Session, error) {
				if studioID != "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d" {
					t.Fatalf("expected studio id lookup, got %q", studioID)
				}

				return []domain.Session{
					{
						ID:         "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
						StudioID:   studioID,
						HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
						Title:      "Interview with guest",
						Status:     domain.SessionStatusDraft,
						CreatedAt:  createdAt,
						UpdatedAt:  updatedAt,
					},
				}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/studios/2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d/sessions", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload []map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if len(payload) != 1 {
		t.Fatalf("expected 1 session, got %d", len(payload))
	}

	if payload[0]["studio_id"] != "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d" {
		t.Fatalf("expected response studio id, got %#v", payload[0]["studio_id"])
	}
}

func TestSessionRoutesReturnServiceUnavailableWithoutStore(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{})

	tests := []struct {
		name   string
		method string
		target string
		body   string
	}{
		{
			name:   "create session",
			method: http.MethodPost,
			target: "/v1/sessions",
			body:   `{"studio_id":"2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d","host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","title":"Interview with guest"}`,
		},
		{
			name:   "get session",
			method: http.MethodGet,
			target: "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa",
		},
		{
			name:   "get guest session",
			method: http.MethodGet,
			target: "/v1/guest/sessions/guest-token-for-lookup",
		},
		{
			name:   "list sessions",
			method: http.MethodGet,
			target: "/v1/studios/2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d/sessions",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, test.target, strings.NewReader(test.body))

			handler.ServeHTTP(recorder, request)

			assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "session store unavailable")
		})
	}
}

func TestGetSessionByIDReturnsInternalServerErrorOnUnexpectedStoreError(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				return domain.Session{}, errors.New("boom")
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusInternalServerError, "failed to fetch session")
}

func TestListSessionsByStudioReturnsInternalServerErrorOnUnexpectedStoreError(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			listSessionsFunc: func(ctx context.Context, studioID string) ([]domain.Session, error) {
				return nil, errors.New("boom")
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/studios/2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d/sessions", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusInternalServerError, "failed to list sessions")
}

func TestSessionRoutesRejectUnsupportedMethods(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			createSessionFunc: func(ctx context.Context, params storage.CreateSessionParams) (domain.Session, error) {
				t.Fatal("expected create session not to be called")
				return domain.Session{}, nil
			},
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				t.Fatal("expected get session not to be called")
				return domain.Session{}, nil
			},
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				t.Fatal("expected get guest session not to be called")
				return domain.Session{}, nil
			},
			listSessionsFunc: func(ctx context.Context, studioID string) ([]domain.Session, error) {
				t.Fatal("expected list sessions not to be called")
				return nil, nil
			},
		},
	})

	tests := []struct {
		name        string
		method      string
		target      string
		allowHeader string
	}{
		{
			name:        "create session wrong method",
			method:      http.MethodGet,
			target:      "/v1/sessions",
			allowHeader: http.MethodPost,
		},
		{
			name:        "get session wrong method",
			method:      http.MethodPost,
			target:      "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa",
			allowHeader: http.MethodGet,
		},
		{
			name:        "get guest session wrong method",
			method:      http.MethodPost,
			target:      "/v1/guest/sessions/guest-token-for-lookup",
			allowHeader: http.MethodGet,
		},
		{
			name:        "list sessions wrong method",
			method:      http.MethodPost,
			target:      "/v1/studios/2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d/sessions",
			allowHeader: http.MethodGet,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, test.target, nil)

			handler.ServeHTTP(recorder, request)

			if recorder.Code != http.StatusMethodNotAllowed {
				t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
			}

			if got := recorder.Header().Get("Allow"); got != test.allowHeader {
				t.Fatalf("expected Allow header %q, got %q", test.allowHeader, got)
			}
		})
	}
}

func assertErrorResponse(t *testing.T, response *http.Response, expectedStatus int, expectedError string) {
	t.Helper()
	defer response.Body.Close()

	if response.StatusCode != expectedStatus {
		t.Fatalf("expected status %d, got %d", expectedStatus, response.StatusCode)
	}

	var payload errorResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}

	if payload.Error != expectedError {
		t.Fatalf("expected error %q, got %q", expectedError, payload.Error)
	}
}
