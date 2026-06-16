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

type fakeParticipantStore struct {
	joinGuestParticipantFunc  func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error)
	joinHostParticipantFunc   func(ctx context.Context, params storage.JoinHostParticipantParams) (domain.Participant, error)
	leaveGuestParticipantFunc func(ctx context.Context, params storage.LeaveGuestParticipantParams) (domain.Participant, error)
	leaveHostParticipantFunc  func(ctx context.Context, params storage.LeaveHostParticipantParams) (domain.Participant, error)
}

func (f fakeParticipantStore) JoinGuestParticipant(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
	return f.joinGuestParticipantFunc(ctx, params)
}

func (f fakeParticipantStore) JoinHostParticipant(ctx context.Context, params storage.JoinHostParticipantParams) (domain.Participant, error) {
	return f.joinHostParticipantFunc(ctx, params)
}

func (f fakeParticipantStore) LeaveGuestParticipant(ctx context.Context, params storage.LeaveGuestParticipantParams) (domain.Participant, error) {
	if f.leaveGuestParticipantFunc == nil {
		return domain.Participant{}, errors.New("unexpected leave guest participant call")
	}

	return f.leaveGuestParticipantFunc(ctx, params)
}

func (f fakeParticipantStore) LeaveHostParticipant(ctx context.Context, params storage.LeaveHostParticipantParams) (domain.Participant, error) {
	if f.leaveHostParticipantFunc == nil {
		return domain.Participant{}, errors.New("unexpected leave host participant call")
	}

	return f.leaveHostParticipantFunc(ctx, params)
}

func TestPostGuestSessionJoinReturnsSessionAndParticipant(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(2 * time.Minute)
	joinedAt := createdAt.Add(3 * time.Minute)
	rawInviteToken := "guest-token-for-join"

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
					Status:     domain.SessionStatusDraft,
					CreatedAt:  createdAt,
					UpdatedAt:  updatedAt,
				}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				if params.SessionID != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
					t.Fatalf("expected session id %q, got %q", "0f1ecf7c-5444-492d-a7a1-31172609a4fa", params.SessionID)
				}

				if params.DisplayName != "Guest Name" {
					t.Fatalf("expected display name %q, got %q", "Guest Name", params.DisplayName)
				}

				displayName := params.DisplayName
				return domain.Participant{
					ID:          "5d0cf5cb-b436-4e48-af38-df557dc519fe",
					SessionID:   params.SessionID,
					Role:        domain.ParticipantRoleGuest,
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
		"/v1/guest/sessions/"+rawInviteToken+"/join",
		strings.NewReader(`{"display_name":"Guest Name"}`),
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

	if payload.Participant.Role != "guest" {
		t.Fatalf("expected guest role, got %q", payload.Participant.Role)
	}

	if payload.Participant.DisplayName != "Guest Name" {
		t.Fatalf("expected display name, got %q", payload.Participant.DisplayName)
	}

	if payload.Participant.Status != "joined" {
		t.Fatalf("expected joined status, got %q", payload.Participant.Status)
	}

	if payload.Participant.JoinedAt == nil || !payload.Participant.JoinedAt.Equal(joinedAt) {
		t.Fatalf("expected joined_at %v, got %v", joinedAt, payload.Participant.JoinedAt)
	}
}

func TestPostGuestSessionJoinHashesInviteTokenBeforeLookup(t *testing.T) {
	t.Parallel()

	rawInviteToken := "guest-token-for-hash-check"

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				if want := invite.HashToken(rawInviteToken); inviteTokenHash != want {
					t.Fatalf("expected invite token hash %q, got %q", want, inviteTokenHash)
				}

				return domain.Session{ID: "session-1"}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				return domain.Participant{ID: "participant-1"}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/"+rawInviteToken+"/join",
		strings.NewReader(`{"display_name":"Guest Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
}

func TestPostGuestSessionJoinRejectsMissingDisplayName(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				t.Fatal("expected session lookup not to be called")
				return domain.Session{}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/guest-token-for-join/join",
		strings.NewReader(`{}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusBadRequest, "display_name is required")
}

func TestPostGuestSessionJoinRejectsEmptyDisplayName(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				t.Fatal("expected session lookup not to be called")
				return domain.Session{}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/guest-token-for-join/join",
		strings.NewReader(`{"display_name":"   "}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusBadRequest, "display_name is required")
}

func TestPostGuestSessionJoinRejectsMalformedJSON(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				t.Fatal("expected session lookup not to be called")
				return domain.Session{}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/guest-token-for-join/join",
		strings.NewReader("{"),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusBadRequest, "invalid json body")
}

func TestPostGuestSessionJoinRejectsUnknownJSONField(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				t.Fatal("expected session lookup not to be called")
				return domain.Session{}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/guest-token-for-join/join",
		strings.NewReader(`{"display_name":"Guest Name","role":"guest"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusBadRequest, "unknown json field")
}

func TestPostGuestSessionJoinReturnsNotFoundWhenInviteDoesNotExist(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				return domain.Session{}, storage.ErrNotFound
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/guest-token-for-join/join",
		strings.NewReader(`{"display_name":"Guest Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusNotFound, "session not found")
}

func TestPostGuestSessionJoinReturnsServiceUnavailableWithoutSessionStore(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/guest-token-for-join/join",
		strings.NewReader(`{"display_name":"Guest Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "session store unavailable")
}

func TestPostGuestSessionJoinReturnsServiceUnavailableWithoutParticipantStore(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				t.Fatal("expected session lookup not to be called")
				return domain.Session{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/guest-token-for-join/join",
		strings.NewReader(`{"display_name":"Guest Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "participant store unavailable")
}

func TestPostGuestSessionJoinRejectsUnsupportedMethod(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				t.Fatal("expected session lookup not to be called")
				return domain.Session{}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant join not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/guest/sessions/guest-token-for-join/join", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != http.MethodPost {
		t.Fatalf("expected Allow header %q, got %q", http.MethodPost, got)
	}
}

func TestPostGuestSessionJoinReturnsInternalServerErrorOnUnexpectedParticipantStoreError(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				return domain.Session{ID: "session-1"}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			joinGuestParticipantFunc: func(ctx context.Context, params storage.JoinGuestParticipantParams) (domain.Participant, error) {
				return domain.Participant{}, errors.New("boom")
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/guest-token-for-join/join",
		strings.NewReader(`{"display_name":"Guest Name"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusInternalServerError, "failed to join guest participant")
}
