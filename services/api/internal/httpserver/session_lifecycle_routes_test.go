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
	"github.com/djokodev/Djoko-Studio/services/api/internal/storage"
)

func TestPostSessionStartLifecycleRoutes(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(5 * time.Minute)
	startedAt := createdAt.Add(5 * time.Minute)

	tests := []struct {
		name       string
		method     string
		body       string
		store      storage.SessionStore
		wantStatus int
		wantError  string
		wantAllow  string
		verify     func(t *testing.T, body []byte)
	}{
		{
			name:   "success",
			method: http.MethodPost,
			body:   `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`,
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					if id != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
						t.Fatalf("expected session id lookup, got %q", id)
					}

					return domain.Session{
						ID:         id,
						StudioID:   "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
						HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
						Title:      "Interview with guest",
						Status:     domain.SessionStatusDraft,
						CreatedAt:  createdAt,
						UpdatedAt:  updatedAt,
					}, nil
				},
				startSessionFunc: func(ctx context.Context, params storage.StartSessionParams) (domain.Session, error) {
					if params.SessionID != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
						t.Fatalf("expected session id %q, got %q", "0f1ecf7c-5444-492d-a7a1-31172609a4fa", params.SessionID)
					}

					return domain.Session{
						ID:         params.SessionID,
						StudioID:   "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
						HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
						Title:      "Interview with guest",
						Status:     domain.SessionStatusLive,
						StartedAt:  &startedAt,
						CreatedAt:  createdAt,
						UpdatedAt:  updatedAt,
					}, nil
				},
			},
			wantStatus: http.StatusOK,
			verify: func(t *testing.T, body []byte) {
				t.Helper()

				var payload struct {
					Session sessionResponse `json:"session"`
				}
				if err := json.Unmarshal(body, &payload); err != nil {
					t.Fatalf("unmarshal response: %v", err)
				}

				if payload.Session.Status != "live" {
					t.Fatalf("expected live status, got %q", payload.Session.Status)
				}

				if payload.Session.StartedAt == nil || !payload.Session.StartedAt.Equal(startedAt) {
					t.Fatalf("expected started_at %v, got %v", startedAt, payload.Session.StartedAt)
				}
			},
		},
		{
			name:       "missing host_user_id",
			method:     http.MethodPost,
			body:       `{}`,
			wantStatus: http.StatusBadRequest,
			wantError:  "host_user_id is required",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					t.Fatal("expected session lookup not to be called")
					return domain.Session{}, nil
				},
				startSessionFunc: func(ctx context.Context, params storage.StartSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "malformed json",
			method:     http.MethodPost,
			body:       `{`,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid json body",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					t.Fatal("expected session lookup not to be called")
					return domain.Session{}, nil
				},
				startSessionFunc: func(ctx context.Context, params storage.StartSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "unknown json field",
			method:     http.MethodPost,
			body:       `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","unexpected":"field"}`,
			wantStatus: http.StatusBadRequest,
			wantError:  "unknown json field",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					t.Fatal("expected session lookup not to be called")
					return domain.Session{}, nil
				},
				startSessionFunc: func(ctx context.Context, params storage.StartSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "session not found",
			method:     http.MethodPost,
			body:       `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`,
			wantStatus: http.StatusNotFound,
			wantError:  "session not found",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					return domain.Session{}, storage.ErrNotFound
				},
				startSessionFunc: func(ctx context.Context, params storage.StartSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "wrong host_user_id",
			method:     http.MethodPost,
			body:       `{"host_user_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}`,
			wantStatus: http.StatusForbidden,
			wantError:  "host_user_id does not match session host_user_id",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					return domain.Session{
						ID:         id,
						HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
					}, nil
				},
				startSessionFunc: func(ctx context.Context, params storage.StartSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "store unavailable",
			method:     http.MethodPost,
			body:       `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`,
			wantStatus: http.StatusServiceUnavailable,
			wantError:  "session store unavailable",
			store:      nil,
		},
		{
			name:       "unexpected storage error",
			method:     http.MethodPost,
			body:       `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`,
			wantStatus: http.StatusInternalServerError,
			wantError:  "failed to start session",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					return domain.Session{
						ID:         id,
						HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
					}, nil
				},
				startSessionFunc: func(ctx context.Context, params storage.StartSessionParams) (domain.Session, error) {
					return domain.Session{}, errors.New("boom")
				},
			},
		},
		{
			name:       "wrong method",
			method:     http.MethodGet,
			body:       "",
			wantStatus: http.StatusMethodNotAllowed,
			wantError:  "method not allowed",
			wantAllow:  http.MethodPost,
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					t.Fatal("expected session lookup not to be called")
					return domain.Session{}, nil
				},
				startSessionFunc: func(ctx context.Context, params storage.StartSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			handler := newHandler(Dependencies{SessionStore: test.store})
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/start", strings.NewReader(test.body))

			handler.ServeHTTP(recorder, request)

			if recorder.Code != test.wantStatus {
				t.Fatalf("expected status %d, got %d", test.wantStatus, recorder.Code)
			}

			if test.wantError != "" {
				assertErrorResponse(t, recorder.Result(), test.wantStatus, test.wantError)
			}

			if test.wantAllow != "" {
				if got := recorder.Header().Get("Allow"); got != test.wantAllow {
					t.Fatalf("expected Allow header %q, got %q", test.wantAllow, got)
				}
			}

			if test.verify != nil {
				test.verify(t, recorder.Body.Bytes())
			}
		})
	}
}

func TestPostSessionEndLifecycleRoutes(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(45 * time.Minute)
	startedAt := createdAt.Add(5 * time.Minute)
	endedAt := createdAt.Add(45 * time.Minute)

	tests := []struct {
		name       string
		method     string
		body       string
		store      storage.SessionStore
		wantStatus int
		wantError  string
		wantAllow  string
		verify     func(t *testing.T, body []byte)
	}{
		{
			name:   "success",
			method: http.MethodPost,
			body:   `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`,
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					return domain.Session{
						ID:         id,
						StudioID:   "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
						HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
						Title:      "Interview with guest",
						Status:     domain.SessionStatusLive,
						StartedAt:  &startedAt,
						CreatedAt:  createdAt,
						UpdatedAt:  updatedAt,
					}, nil
				},
				endSessionFunc: func(ctx context.Context, params storage.EndSessionParams) (domain.Session, error) {
					if params.SessionID != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
						t.Fatalf("expected session id %q, got %q", "0f1ecf7c-5444-492d-a7a1-31172609a4fa", params.SessionID)
					}

					return domain.Session{
						ID:         params.SessionID,
						StudioID:   "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
						HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
						Title:      "Interview with guest",
						Status:     domain.SessionStatusEnded,
						StartedAt:  &startedAt,
						EndedAt:    &endedAt,
						CreatedAt:  createdAt,
						UpdatedAt:  updatedAt,
					}, nil
				},
			},
			wantStatus: http.StatusOK,
			verify: func(t *testing.T, body []byte) {
				t.Helper()

				var payload struct {
					Session sessionResponse `json:"session"`
				}
				if err := json.Unmarshal(body, &payload); err != nil {
					t.Fatalf("unmarshal response: %v", err)
				}

				if payload.Session.Status != "ended" {
					t.Fatalf("expected ended status, got %q", payload.Session.Status)
				}

				if payload.Session.EndedAt == nil || !payload.Session.EndedAt.Equal(endedAt) {
					t.Fatalf("expected ended_at %v, got %v", endedAt, payload.Session.EndedAt)
				}
			},
		},
		{
			name:       "missing host_user_id",
			method:     http.MethodPost,
			body:       `{}`,
			wantStatus: http.StatusBadRequest,
			wantError:  "host_user_id is required",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					t.Fatal("expected session lookup not to be called")
					return domain.Session{}, nil
				},
				endSessionFunc: func(ctx context.Context, params storage.EndSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "malformed json",
			method:     http.MethodPost,
			body:       `{`,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid json body",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					t.Fatal("expected session lookup not to be called")
					return domain.Session{}, nil
				},
				endSessionFunc: func(ctx context.Context, params storage.EndSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "unknown json field",
			method:     http.MethodPost,
			body:       `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","unexpected":"field"}`,
			wantStatus: http.StatusBadRequest,
			wantError:  "unknown json field",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					t.Fatal("expected session lookup not to be called")
					return domain.Session{}, nil
				},
				endSessionFunc: func(ctx context.Context, params storage.EndSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "session not found",
			method:     http.MethodPost,
			body:       `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`,
			wantStatus: http.StatusNotFound,
			wantError:  "session not found",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					return domain.Session{}, storage.ErrNotFound
				},
				endSessionFunc: func(ctx context.Context, params storage.EndSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "wrong host_user_id",
			method:     http.MethodPost,
			body:       `{"host_user_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}`,
			wantStatus: http.StatusForbidden,
			wantError:  "host_user_id does not match session host_user_id",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					return domain.Session{
						ID:         id,
						HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
					}, nil
				},
				endSessionFunc: func(ctx context.Context, params storage.EndSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
		{
			name:       "store unavailable",
			method:     http.MethodPost,
			body:       `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`,
			wantStatus: http.StatusServiceUnavailable,
			wantError:  "session store unavailable",
			store:      nil,
		},
		{
			name:       "unexpected storage error",
			method:     http.MethodPost,
			body:       `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`,
			wantStatus: http.StatusInternalServerError,
			wantError:  "failed to end session",
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					return domain.Session{
						ID:         id,
						HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
					}, nil
				},
				endSessionFunc: func(ctx context.Context, params storage.EndSessionParams) (domain.Session, error) {
					return domain.Session{}, errors.New("boom")
				},
			},
		},
		{
			name:       "wrong method",
			method:     http.MethodGet,
			body:       "",
			wantStatus: http.StatusMethodNotAllowed,
			wantError:  "method not allowed",
			wantAllow:  http.MethodPost,
			store: fakeSessionStore{
				getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
					t.Fatal("expected session lookup not to be called")
					return domain.Session{}, nil
				},
				endSessionFunc: func(ctx context.Context, params storage.EndSessionParams) (domain.Session, error) {
					t.Fatal("expected session update not to be called")
					return domain.Session{}, nil
				},
			},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			handler := newHandler(Dependencies{SessionStore: test.store})
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/end", strings.NewReader(test.body))

			handler.ServeHTTP(recorder, request)

			if recorder.Code != test.wantStatus {
				t.Fatalf("expected status %d, got %d", test.wantStatus, recorder.Code)
			}

			if test.wantError != "" {
				assertErrorResponse(t, recorder.Result(), test.wantStatus, test.wantError)
			}

			if test.wantAllow != "" {
				if got := recorder.Header().Get("Allow"); got != test.wantAllow {
					t.Fatalf("expected Allow header %q, got %q", test.wantAllow, got)
				}
			}

			if test.verify != nil {
				test.verify(t, recorder.Body.Bytes())
			}
		})
	}
}
