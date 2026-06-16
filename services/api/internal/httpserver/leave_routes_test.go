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

func TestPostGuestSessionLeaveHashesInviteTokenBeforeLookup(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(6 * time.Minute)
	leftAt := createdAt.Add(7 * time.Minute)
	rawInviteToken := "guest-token-for-leave"

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
					Status:     domain.SessionStatusLive,
					CreatedAt:  createdAt,
					UpdatedAt:  updatedAt,
				}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			leaveGuestParticipantFunc: func(ctx context.Context, params storage.LeaveGuestParticipantParams) (domain.Participant, error) {
				if params.SessionID != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
					t.Fatalf("expected session id %q, got %q", "0f1ecf7c-5444-492d-a7a1-31172609a4fa", params.SessionID)
				}

				displayName := "Guest Name"
				return domain.Participant{
					ID:          "5d0cf5cb-b436-4e48-af38-df557dc519fe",
					SessionID:   params.SessionID,
					Role:        domain.ParticipantRoleGuest,
					DisplayName: &displayName,
					Status:      domain.ParticipantStatusLeft,
					LeftAt:      &leftAt,
					CreatedAt:   createdAt,
					UpdatedAt:   updatedAt,
				}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/guest/sessions/"+rawInviteToken+"/leave",
		nil,
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

	if payload.Participant.Status != "left" {
		t.Fatalf("expected left status, got %q", payload.Participant.Status)
	}

	if payload.Participant.LeftAt == nil || !payload.Participant.LeftAt.Equal(leftAt) {
		t.Fatalf("expected left_at %v, got %v", leftAt, payload.Participant.LeftAt)
	}
}

func TestPostGuestSessionLeaveReturnsNotFoundWhenInviteDoesNotExist(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				return domain.Session{}, storage.ErrNotFound
			},
		},
		ParticipantStore: fakeParticipantStore{
			leaveGuestParticipantFunc: func(ctx context.Context, params storage.LeaveGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected guest leave not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/guest/sessions/guest-token-for-leave/leave", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusNotFound, "session not found")
}

func TestPostGuestSessionLeaveReturnsNotFoundWhenGuestParticipantDoesNotExist(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				return domain.Session{ID: "session-1"}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			leaveGuestParticipantFunc: func(ctx context.Context, params storage.LeaveGuestParticipantParams) (domain.Participant, error) {
				return domain.Participant{}, storage.ErrNotFound
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/guest/sessions/guest-token-for-leave/leave", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusNotFound, "participant not found")
}

func TestPostGuestSessionLeaveReturnsServiceUnavailableWithoutSessionStore(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		ParticipantStore: fakeParticipantStore{
			leaveGuestParticipantFunc: func(ctx context.Context, params storage.LeaveGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected guest leave not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/guest/sessions/guest-token-for-leave/leave", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "session store unavailable")
}

func TestPostGuestSessionLeaveReturnsServiceUnavailableWithoutParticipantStore(t *testing.T) {
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
	request := httptest.NewRequest(http.MethodPost, "/v1/guest/sessions/guest-token-for-leave/leave", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "participant store unavailable")
}

func TestPostGuestSessionLeaveReturnsInternalServerErrorOnUnexpectedStoreError(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionByInviteTokenHashFunc: func(ctx context.Context, inviteTokenHash string) (domain.Session, error) {
				return domain.Session{}, errors.New("boom")
			},
		},
		ParticipantStore: fakeParticipantStore{
			leaveGuestParticipantFunc: func(ctx context.Context, params storage.LeaveGuestParticipantParams) (domain.Participant, error) {
				t.Fatal("expected guest leave not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/guest/sessions/guest-token-for-leave/leave", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusInternalServerError, "failed to fetch session")
}

func TestPostGuestSessionLeaveRejectsUnsupportedMethod(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/guest/sessions/guest-token-for-leave/leave", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != http.MethodPost {
		t.Fatalf("expected Allow header %q, got %q", http.MethodPost, got)
	}
}

func TestPostHostSessionLeaveReturnsSessionAndParticipant(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(7 * time.Minute)
	leftAt := createdAt.Add(8 * time.Minute)

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
					Status:     domain.SessionStatusLive,
					CreatedAt:  createdAt,
					UpdatedAt:  updatedAt,
				}, nil
			},
		},
		ParticipantStore: fakeParticipantStore{
			leaveHostParticipantFunc: func(ctx context.Context, params storage.LeaveHostParticipantParams) (domain.Participant, error) {
				if params.SessionID != "0f1ecf7c-5444-492d-a7a1-31172609a4fa" {
					t.Fatalf("expected session id %q, got %q", "0f1ecf7c-5444-492d-a7a1-31172609a4fa", params.SessionID)
				}

				if params.HostUserID != "3c9abfe7-3133-4924-b159-f62277dfce7c" {
					t.Fatalf("expected host user id %q, got %q", "3c9abfe7-3133-4924-b159-f62277dfce7c", params.HostUserID)
				}

				displayName := "Host Name"
				hostUserID := params.HostUserID
				return domain.Participant{
					ID:          "5d0cf5cb-b436-4e48-af38-df557dc519fe",
					SessionID:   params.SessionID,
					UserID:      &hostUserID,
					Role:        domain.ParticipantRoleHost,
					DisplayName: &displayName,
					Status:      domain.ParticipantStatusLeft,
					LeftAt:      &leftAt,
					CreatedAt:   createdAt,
					UpdatedAt:   updatedAt,
				}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/leave",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`),
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

	if payload.Participant.Status != "left" {
		t.Fatalf("expected left status, got %q", payload.Participant.Status)
	}

	if payload.Participant.LeftAt == nil || !payload.Participant.LeftAt.Equal(leftAt) {
		t.Fatalf("expected left_at %v, got %v", leftAt, payload.Participant.LeftAt)
	}
}

func TestPostHostSessionLeaveValidatesRequestBody(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		body    string
		wantErr string
	}{
		{
			name:    "missing host user id",
			body:    `{}`,
			wantErr: "host_user_id is required",
		},
		{
			name:    "malformed json",
			body:    `{`,
			wantErr: "invalid json body",
		},
		{
			name:    "unknown json field",
			body:    `{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c","unexpected":"field"}`,
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
					leaveHostParticipantFunc: func(ctx context.Context, params storage.LeaveHostParticipantParams) (domain.Participant, error) {
						t.Fatal("expected participant leave not to be called")
						return domain.Participant{}, nil
					},
				},
			})

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/leave", strings.NewReader(test.body))

			handler.ServeHTTP(recorder, request)

			assertErrorResponse(t, recorder.Result(), http.StatusBadRequest, test.wantErr)
		})
	}
}

func TestPostHostSessionLeaveReturnsNotFoundWhenSessionDoesNotExist(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				return domain.Session{}, storage.ErrNotFound
			},
		},
		ParticipantStore: fakeParticipantStore{
			leaveHostParticipantFunc: func(ctx context.Context, params storage.LeaveHostParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant leave not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/leave",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusNotFound, "session not found")
}

func TestPostHostSessionLeaveReturnsNotFoundWhenHostParticipantDoesNotExist(t *testing.T) {
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
			leaveHostParticipantFunc: func(ctx context.Context, params storage.LeaveHostParticipantParams) (domain.Participant, error) {
				return domain.Participant{}, storage.ErrNotFound
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/leave",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusNotFound, "participant not found")
}

func TestPostHostSessionLeaveReturnsForbiddenWhenHostUserDoesNotMatch(t *testing.T) {
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
			leaveHostParticipantFunc: func(ctx context.Context, params storage.LeaveHostParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant leave not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/leave",
		strings.NewReader(`{"host_user_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusForbidden, "host_user_id does not match session host_user_id")
}

func TestPostHostSessionLeaveReturnsServiceUnavailableWithoutSessionStore(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		ParticipantStore: fakeParticipantStore{
			leaveHostParticipantFunc: func(ctx context.Context, params storage.LeaveHostParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant leave not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/leave",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "session store unavailable")
}

func TestPostHostSessionLeaveReturnsServiceUnavailableWithoutParticipantStore(t *testing.T) {
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
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/leave",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "participant store unavailable")
}

func TestPostHostSessionLeaveReturnsInternalServerErrorOnUnexpectedStoreError(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		SessionStore: fakeSessionStore{
			getSessionFunc: func(ctx context.Context, id string) (domain.Session, error) {
				return domain.Session{}, errors.New("boom")
			},
		},
		ParticipantStore: fakeParticipantStore{
			leaveHostParticipantFunc: func(ctx context.Context, params storage.LeaveHostParticipantParams) (domain.Participant, error) {
				t.Fatal("expected participant leave not to be called")
				return domain.Participant{}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/leave",
		strings.NewReader(`{"host_user_id":"3c9abfe7-3133-4924-b159-f62277dfce7c"}`),
	)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusInternalServerError, "failed to fetch session")
}

func TestPostHostSessionLeaveRejectsUnsupportedMethod(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/sessions/0f1ecf7c-5444-492d-a7a1-31172609a4fa/host/leave", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != http.MethodPost {
		t.Fatalf("expected Allow header %q, got %q", http.MethodPost, got)
	}
}
