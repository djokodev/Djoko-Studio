package httpserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
	"github.com/djokodev/Djoko-Studio/services/api/internal/invite"
	"github.com/djokodev/Djoko-Studio/services/api/internal/storage"
)

type statusResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type Dependencies struct {
	SessionStore     storage.SessionStore
	ParticipantStore storage.ParticipantStore
}

type createSessionRequest struct {
	StudioID    string     `json:"studio_id"`
	HostUserID  string     `json:"host_user_id"`
	Title       string     `json:"title"`
	Status      string     `json:"status"`
	ScheduledAt *time.Time `json:"scheduled_at"`
}

type createSessionResponse struct {
	Session          sessionResponse `json:"session"`
	GuestInviteToken string          `json:"guest_invite_token"`
}

type joinGuestSessionRequest struct {
	DisplayName string `json:"display_name"`
}

type joinGuestSessionResponse struct {
	Session     sessionResponse     `json:"session"`
	Participant participantResponse `json:"participant"`
}

type joinHostSessionRequest struct {
	HostUserID  string `json:"host_user_id"`
	DisplayName string `json:"display_name"`
}

type joinHostSessionResponse struct {
	Session     sessionResponse     `json:"session"`
	Participant participantResponse `json:"participant"`
}

type sessionResponse struct {
	ID          string     `json:"id"`
	StudioID    string     `json:"studio_id"`
	HostUserID  string     `json:"host_user_id"`
	Title       string     `json:"title"`
	Status      string     `json:"status"`
	ScheduledAt *time.Time `json:"scheduled_at,omitempty"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	EndedAt     *time.Time `json:"ended_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type participantResponse struct {
	ID          string     `json:"id"`
	SessionID   string     `json:"session_id"`
	Role        string     `json:"role"`
	DisplayName string     `json:"display_name"`
	Status      string     `json:"status"`
	JoinedAt    *time.Time `json:"joined_at,omitempty"`
	LeftAt      *time.Time `json:"left_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func newHandler(deps Dependencies) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", allowOnly(http.MethodGet, healthzHandler))
	mux.HandleFunc("/readyz", allowOnly(http.MethodGet, readyzHandler))
	mux.HandleFunc("/v1/sessions", allowOnly(http.MethodPost, createSessionHandler(deps.SessionStore)))
	mux.HandleFunc("/v1/guest/sessions/{invite_token}", allowOnly(http.MethodGet, getGuestSessionHandler(deps.SessionStore)))
	mux.HandleFunc("/v1/guest/sessions/{invite_token}/join", allowOnly(http.MethodPost, joinGuestSessionHandler(deps.SessionStore, deps.ParticipantStore)))
	mux.HandleFunc("/v1/sessions/{session_id}/host/join", allowOnly(http.MethodPost, joinHostSessionHandler(deps.SessionStore, deps.ParticipantStore)))
	mux.HandleFunc("/v1/sessions/{id}", allowOnly(http.MethodGet, getSessionHandler(deps.SessionStore)))
	mux.HandleFunc("/v1/studios/{studio_id}/sessions", allowOnly(http.MethodGet, listStudioSessionsHandler(deps.SessionStore)))
	return mux
}

func healthzHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, statusResponse{
		Status:  "ok",
		Service: "api",
	})
}

func readyzHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, statusResponse{
		Status:  "ok",
		Service: "api",
	})
}

func createSessionHandler(store storage.SessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessionStoreAvailable(store) {
			writeJSON(w, http.StatusServiceUnavailable, errorResponse{
				Error: "session store unavailable",
			})
			return
		}

		payload, err := decodeCreateSessionRequest(r.Body)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{
				Error: err.Error(),
			})
			return
		}

		status, err := normalizeSessionStatus(payload.Status)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{
				Error: err.Error(),
			})
			return
		}

		rawInviteToken, err := invite.GenerateToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse{
				Error: "failed to generate invite token",
			})
			return
		}

		session, err := store.CreateSession(r.Context(), storage.CreateSessionParams{
			StudioID:        payload.StudioID,
			HostUserID:      payload.HostUserID,
			InviteTokenHash: invite.HashToken(rawInviteToken),
			Title:           payload.Title,
			Status:          status,
			ScheduledAt:     payload.ScheduledAt,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse{
				Error: "failed to create session",
			})
			return
		}

		writeJSON(w, http.StatusCreated, createSessionResponse{
			Session:          newSessionResponse(session),
			GuestInviteToken: rawInviteToken,
		})
	}
}

func getSessionHandler(store storage.SessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessionStoreAvailable(store) {
			writeJSON(w, http.StatusServiceUnavailable, errorResponse{
				Error: "session store unavailable",
			})
			return
		}

		session, err := store.GetSession(r.Context(), r.PathValue("id"))
		if err != nil {
			if errors.Is(err, storage.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, errorResponse{
					Error: "session not found",
				})
				return
			}

			writeJSON(w, http.StatusInternalServerError, errorResponse{
				Error: "failed to fetch session",
			})
			return
		}

		writeJSON(w, http.StatusOK, newSessionResponse(session))
	}
}

func getGuestSessionHandler(store storage.SessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessionStoreAvailable(store) {
			writeJSON(w, http.StatusServiceUnavailable, errorResponse{
				Error: "session store unavailable",
			})
			return
		}

		session, err := store.GetSessionByInviteTokenHash(r.Context(), invite.HashToken(r.PathValue("invite_token")))
		if err != nil {
			if errors.Is(err, storage.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, errorResponse{
					Error: "session not found",
				})
				return
			}

			writeJSON(w, http.StatusInternalServerError, errorResponse{
				Error: "failed to fetch session",
			})
			return
		}

		writeJSON(w, http.StatusOK, newSessionResponse(session))
	}
}

func joinGuestSessionHandler(sessionStore storage.SessionStore, participantStore storage.ParticipantStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessionStoreAvailable(sessionStore) {
			writeJSON(w, http.StatusServiceUnavailable, errorResponse{
				Error: "session store unavailable",
			})
			return
		}

		if !participantStoreAvailable(participantStore) {
			writeJSON(w, http.StatusServiceUnavailable, errorResponse{
				Error: "participant store unavailable",
			})
			return
		}

		payload, err := decodeJoinGuestSessionRequest(r.Body)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{
				Error: err.Error(),
			})
			return
		}

		inviteToken := strings.TrimSpace(r.PathValue("invite_token"))
		if inviteToken == "" {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: "session not found",
			})
			return
		}

		session, err := sessionStore.GetSessionByInviteTokenHash(r.Context(), invite.HashToken(inviteToken))
		if err != nil {
			if errors.Is(err, storage.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, errorResponse{
					Error: "session not found",
				})
				return
			}

			writeJSON(w, http.StatusInternalServerError, errorResponse{
				Error: "failed to fetch session",
			})
			return
		}

		participant, err := participantStore.JoinGuestParticipant(r.Context(), storage.JoinGuestParticipantParams{
			SessionID:   session.ID,
			DisplayName: payload.DisplayName,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse{
				Error: "failed to join guest participant",
			})
			return
		}

		writeJSON(w, http.StatusOK, joinGuestSessionResponse{
			Session:     newSessionResponse(session),
			Participant: newParticipantResponse(participant),
		})
	}
}

func joinHostSessionHandler(sessionStore storage.SessionStore, participantStore storage.ParticipantStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessionStoreAvailable(sessionStore) {
			writeJSON(w, http.StatusServiceUnavailable, errorResponse{
				Error: "session store unavailable",
			})
			return
		}

		if !participantStoreAvailable(participantStore) {
			writeJSON(w, http.StatusServiceUnavailable, errorResponse{
				Error: "participant store unavailable",
			})
			return
		}

		payload, err := decodeJoinHostSessionRequest(r.Body)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{
				Error: err.Error(),
			})
			return
		}

		sessionID := strings.TrimSpace(r.PathValue("session_id"))
		if sessionID == "" {
			writeJSON(w, http.StatusNotFound, errorResponse{
				Error: "session not found",
			})
			return
		}

		session, err := sessionStore.GetSession(r.Context(), sessionID)
		if err != nil {
			if errors.Is(err, storage.ErrNotFound) {
				writeJSON(w, http.StatusNotFound, errorResponse{
					Error: "session not found",
				})
				return
			}

			writeJSON(w, http.StatusInternalServerError, errorResponse{
				Error: "failed to fetch session",
			})
			return
		}

		hostUserID := strings.TrimSpace(payload.HostUserID)
		if hostUserID != session.HostUserID {
			writeJSON(w, http.StatusForbidden, errorResponse{
				Error: "host_user_id does not match session host_user_id",
			})
			return
		}

		participant, err := participantStore.JoinHostParticipant(r.Context(), storage.JoinHostParticipantParams{
			SessionID:   session.ID,
			HostUserID:  hostUserID,
			DisplayName: payload.DisplayName,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse{
				Error: "failed to join host participant",
			})
			return
		}

		writeJSON(w, http.StatusOK, joinHostSessionResponse{
			Session:     newSessionResponse(session),
			Participant: newParticipantResponse(participant),
		})
	}
}

func listStudioSessionsHandler(store storage.SessionStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !sessionStoreAvailable(store) {
			writeJSON(w, http.StatusServiceUnavailable, errorResponse{
				Error: "session store unavailable",
			})
			return
		}

		sessions, err := store.ListSessionsByStudio(r.Context(), r.PathValue("studio_id"))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse{
				Error: "failed to list sessions",
			})
			return
		}

		payload := make([]sessionResponse, 0, len(sessions))
		for _, session := range sessions {
			payload = append(payload, newSessionResponse(session))
		}

		writeJSON(w, http.StatusOK, payload)
	}
}

func allowOnly(method string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != method {
			w.Header().Set("Allow", method)
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse{
				Error: "method not allowed",
			})
			return
		}

		next(w, r)
	}
}

func decodeCreateSessionRequest(body io.Reader) (createSessionRequest, error) {
	var payload createSessionRequest

	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		if strings.Contains(err.Error(), "unknown field") {
			return createSessionRequest{}, errors.New("unknown json field")
		}

		return createSessionRequest{}, errors.New("invalid json body")
	}

	if strings.TrimSpace(payload.StudioID) == "" {
		return createSessionRequest{}, errors.New("studio_id is required")
	}

	if strings.TrimSpace(payload.HostUserID) == "" {
		return createSessionRequest{}, errors.New("host_user_id is required")
	}

	if strings.TrimSpace(payload.Title) == "" {
		return createSessionRequest{}, errors.New("title is required")
	}

	return payload, nil
}

func decodeJoinGuestSessionRequest(body io.Reader) (joinGuestSessionRequest, error) {
	var payload joinGuestSessionRequest

	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		if strings.Contains(err.Error(), "unknown field") {
			return joinGuestSessionRequest{}, errors.New("unknown json field")
		}

		return joinGuestSessionRequest{}, errors.New("invalid json body")
	}

	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return joinGuestSessionRequest{}, errors.New("invalid json body")
	}

	payload.DisplayName = strings.TrimSpace(payload.DisplayName)
	if payload.DisplayName == "" {
		return joinGuestSessionRequest{}, errors.New("display_name is required")
	}

	return payload, nil
}

func decodeJoinHostSessionRequest(body io.Reader) (joinHostSessionRequest, error) {
	var payload joinHostSessionRequest

	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		if strings.Contains(err.Error(), "unknown field") {
			return joinHostSessionRequest{}, errors.New("unknown json field")
		}

		return joinHostSessionRequest{}, errors.New("invalid json body")
	}

	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return joinHostSessionRequest{}, errors.New("invalid json body")
	}

	payload.HostUserID = strings.TrimSpace(payload.HostUserID)
	if payload.HostUserID == "" {
		return joinHostSessionRequest{}, errors.New("host_user_id is required")
	}

	payload.DisplayName = strings.TrimSpace(payload.DisplayName)
	if payload.DisplayName == "" {
		return joinHostSessionRequest{}, errors.New("display_name is required")
	}

	return payload, nil
}

func normalizeSessionStatus(value string) (domain.SessionStatus, error) {
	if strings.TrimSpace(value) == "" {
		return domain.SessionStatusDraft, nil
	}

	status := domain.SessionStatus(value)
	switch status {
	case domain.SessionStatusDraft, domain.SessionStatusWaiting, domain.SessionStatusLive, domain.SessionStatusEnded, domain.SessionStatusCancelled:
		return status, nil
	default:
		return "", errors.New("status is invalid")
	}
}

func newSessionResponse(session domain.Session) sessionResponse {
	return sessionResponse{
		ID:          session.ID,
		StudioID:    session.StudioID,
		HostUserID:  session.HostUserID,
		Title:       session.Title,
		Status:      string(session.Status),
		ScheduledAt: session.ScheduledAt,
		StartedAt:   session.StartedAt,
		EndedAt:     session.EndedAt,
		CreatedAt:   session.CreatedAt,
		UpdatedAt:   session.UpdatedAt,
	}
}

func newParticipantResponse(participant domain.Participant) participantResponse {
	displayName := ""
	if participant.DisplayName != nil {
		displayName = *participant.DisplayName
	}

	return participantResponse{
		ID:          participant.ID,
		SessionID:   participant.SessionID,
		Role:        string(participant.Role),
		DisplayName: displayName,
		Status:      string(participant.Status),
		JoinedAt:    participant.JoinedAt,
		LeftAt:      participant.LeftAt,
		CreatedAt:   participant.CreatedAt,
		UpdatedAt:   participant.UpdatedAt,
	}
}

func sessionStoreAvailable(store storage.SessionStore) bool {
	return store != nil
}

func participantStoreAvailable(store storage.ParticipantStore) bool {
	return store != nil
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	var buffer bytes.Buffer
	if err := json.NewEncoder(&buffer).Encode(payload); err != nil {
		http.Error(w, "failed to encode json response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_, _ = w.Write(buffer.Bytes())
}
