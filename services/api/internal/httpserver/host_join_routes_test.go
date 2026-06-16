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

func TestPostHostSessionJoinReturnsSessionAndParticipant(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(2 * time.Minute)
	joinedAt := createdAt.Add(3 * time.Minute)

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
					Status:     domain.SessionStatusDraft,
					CreatedAt:  createdAt,
					UpdatedAt:  updatedAt,
				}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinHostParticipantFunc: func(ctx context.Context, params storage.JoinHostParticipantParams) (domain.Participant, error) {
				if params.SessionID != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
					t.Fatalf("expected session id %q, got %q", "0f1ecf7c-5444-492d-a7a1-31172609a4fa", params.SessionID)
				}

				if params.HostUserID != "3c9abfe7-3133-4924-b159-f62277dfce7c" {
					t.Fatalf("expected host user id %q, got %q", "3c9abfe7-3133-4924-b159-f62277dfce7c", params.HostUserID)
				}

				if params.DisplayName != "Host Name" {
					t.Fatalf("expected display name %q, got %q", "Host Name", params.DisplayName)
				}

				displayName := params.DisplayName
				hostUserID := params.HostUserID
				return domain.Participant{
					ID:          "5d0cf5cb-b436-4e48-af38-df557dc519fe",
					SessionID:   params.SessionID,
					UserID:      &hostUserID,
					Role:        domain.ParticipantRoleHost,
					DisplayName: &displayName,
					Status:      domain.ParticipantStatusJoined,
					JoinedAt:    &joinedAt,
					CreatedAt:   createdAt,
					UpdatedAt:   updatedAt,
				}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/join",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","display_name":"Host Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Session     sessionResponse     `json:"session"`
		Participant participantResponse `json:"participant"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if payload.Session.ID != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
		t.Fatalf("expected session id, got %q", payload.Session.ID)
	}

	if payload.Participant.ID != "5d0cf5cb-b436-4e48-af38-df557dc519fe" {
		t.Fatalf("expected participant id, got %q", payload.Participant.ID)
	}

	if payload.Participant.Role != "host" {
		t.Fatalf("expected host role, got %q", payload.Participant.Role)
	}

	if payload.Participant.DisplayName != "Host Name" {
		t.Fatalf("expected display name, got %q", payload.Participant.DisplayName)
	}

	if payload.Participant.Status != "joined" {
		t.Fatalf("expected joined status, got %q", payload.Participant.Status)
	}

	if payload.Participant.JoinedAt == nil || !payload.Participant.JoinedAt.Equal(joinedAt) {
		t.Fatalf("expected joined_at %v, got %v", joinedAt, payload.Participant.JoinedAt)
	}
}

func TestPostHostSessionJoinValidatesRequestBody(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		body    string
		wantErr string
	}{
		{
			name:    "missing host user id",
			body:    `{"display_name":"Host Name"}`,
			wantErr: "host_user_id is required",
		},
		{
			name:    "missing display name",
			body:    `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`,
			wantErr: "display_name is required",
		},
		{
			name:    "empty display name",
			body:    `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","display_name":"   "}`,
			wantErr: "display_name is required",
		},
		{
			name:    "malformed json",
			body:    `{`,
			wantErr: "invalid json body",
		},
		{
			name:    "unknown json field",
			body:    `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","display_name":"Host Name","role":"host"}`,
			wantErr: "unknown json field",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			handler := newHandler(Dependencies{
				SessionStore: fakeSessionStore{
					getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
						t.Fatal("expected session lookup not to be called")
						return domain.Session{}, nil
					},
				},
				ParticipantStore: fakeParticipantStore{
					joinHostParticipantFunc: func(ctx context.Context, params storage.JoinHostParticipantParams) (domain.Participant, error) {
						t.Fatal("expected participant join not to be called")
						return domain.Participant{}, nil
					},
				},
			})

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/join", strings.NewReader(test.body))

			handler.ServeHTTP(recorder, request)

			assertErrorResponse(t, recorder.Result(), http.StatusBadRequest, test.wantErr)
		})
	}
}

func TestPostHostSessionJoinReturnsNotFoundWhenSessionDoesNotExist(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				return domain.Session{}, storage.ErrNotFound
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinHostParticipantFunc: func(ctx context.Context, params storage.JoinHostParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/join",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","display_name":"Host Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusNotFound, "session not found")
}

func TestPostHostSessionJoinReturnsForbiddenWhenHostUserDoesNotMatch(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				return domain.Session{
					ID:         id,
					HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
				}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinHostParticipantFunc: func(ctx context.Context, params storage.JoinHostParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/join",
		strings.NewReader(`{"host_user_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","display_name":"Host Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusForbidden, "host_user_id does not match session host_user_id")
}

func TestPostHostSessionJoinReturnsServiceUnavailableWithoutSessionStore(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		ParticipantStore: fakeParticipantStore{
			joinHostParticipantFunc: func(ctx context.Context, params storage.JoinHostParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/join",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","display_name":"Host Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "session store unavailable")
}

func TestPostHostSessionJoinReturnsServiceUnavailableWithoutParticipantStore(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				t.Fatal("expected session lookup not to be called")
				return domain.Session{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/join",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","display_name":"Host Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "participant store unavailable")
}

func TestPostHostSessionJoinRejectsUnsupportedMethod(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				t.Fatal("expected session lookup not to be called")
				return domain.Session{}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinHostParticipantFunc: func(ctx context.Context, params storage.JoinHostParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/join", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != http.MethodPost {
		t.Fatalf("expected Allow header %q, got %q", http.MethodPost, got)
	}
}

func TestPostHostSessionJoinReturnsInternalServerErrorOnUnexpectedParticipantStoreError(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				return domain.Session{
					ID:         id,
					HostUserID: "3c9abfe7-3133-4924-b159-f62277dfce7c",
				}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinHostParticipantFunc: func(ctx context.Context, params storage.JoinHostParticipantParams) (domain.Participant, error) {
				return domain.Participant{}, errors.New("boom")
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/join",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","display_name":"Host Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusInternalServerError, "failed to join host participant")
}
