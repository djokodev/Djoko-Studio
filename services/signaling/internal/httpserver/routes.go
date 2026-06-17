package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/coder/websocket"
)

const serviceName = "signaling"

type statusResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

type errorResponse struct {
	Error string `json:"error"`
}

type wsErrorResponse struct {
	Type  string        `json:"type"`
	Error wsErrorDetail `json:"error"`
}

type wsErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type wsSignalEnvelope struct {
	Type    string          `json:"type"`
	From    wsSignalFrom    `json:"from"`
	Payload json.RawMessage `json:"payload"`
}

type wsSignalFrom struct {
	ParticipantID string `json:"participant_id"`
	Role          string `json:"role"`
}

type wsParticipantPayload struct {
	ParticipantID string `json:"participant_id"`
	Role          string `json:"role"`
}

type wsRoomStateMessage struct {
	Type      string                `json:"type"`
	SessionID string                `json:"session_id"`
	Self      wsParticipantPayload  `json:"self"`
	Peer      *wsParticipantPayload `json:"peer"`
}

type wsPeerEventMessage struct {
	Type        string               `json:"type"`
	SessionID   string               `json:"session_id"`
	Participant wsParticipantPayload `json:"participant"`
}

type wsSignalMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

const (
	signalingRoomRoutePrefix = "/v1/signaling/rooms/"
	hostRole                 = "host"
	guestRole                = "guest"
)

func newHandler() http.Handler {
	roomManager := newRoomManager()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", allowOnly(http.MethodGet, healthzHandler))
	mux.HandleFunc("/readyz", allowOnly(http.MethodGet, readyzHandler))
	mux.HandleFunc("/v1/signaling/rooms", allowOnly(http.MethodGet, func(w http.ResponseWriter, r *http.Request) {
		roomHandler(roomManager, w, r)
	}))
	mux.HandleFunc("/v1/signaling/rooms/", allowOnly(http.MethodGet, func(w http.ResponseWriter, r *http.Request) {
		roomHandler(roomManager, w, r)
	}))

	return mux
}

func healthzHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, statusResponse{
		Status:  "ok",
		Service: serviceName,
	})
}

func readyzHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, statusResponse{
		Status:  "ok",
		Service: serviceName,
	})
}

func roomHandler(roomManager *roomManager, w http.ResponseWriter, r *http.Request) {
	sessionID, ok := extractSessionID(r.URL.Path)
	if !ok {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "missing session_id"})
		return
	}

	participantID := strings.TrimSpace(r.URL.Query().Get("participant_id"))
	if participantID == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "missing participant_id"})
		return
	}

	role := strings.TrimSpace(r.URL.Query().Get("role"))
	if role == "" {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "missing role"})
		return
	}
	if role != hostRole && role != guestRole {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "unsupported role"})
		return
	}

	if !isWebSocketRequest(r) {
		writeJSON(w, http.StatusBadRequest, errorResponse{Error: "websocket upgrade required"})
		return
	}

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()

	membership, err := roomManager.join(sessionID, wsParticipant{
		participantID: participantID,
		role:          role,
	}, conn)
	if err != nil {
		joinErr, ok := err.(roomJoinError)
		if !ok {
			joinErr = roomJoinError{
				code:    "room_join_failed",
				message: err.Error(),
			}
		}

		_ = writeWebSocketJSON(context.Background(), conn, wsErrorResponse{
			Type: "error",
			Error: wsErrorDetail{
				Code:    joinErr.code,
				Message: joinErr.message,
			},
		})
		return
	}

	notifyPeerOnLeave := false
	defer func() {
		if notifyPeerOnLeave {
			_ = notifyPeerLeft(context.Background(), membership)
		}
		membership.leave()
	}()

	if err := writeRoomState(context.Background(), membership); err != nil {
		return
	}

	if err := notifyPeerJoined(context.Background(), membership); err != nil {
		return
	}
	notifyPeerOnLeave = true

	for {
		messageType, payload, err := conn.Read(context.Background())
		if err != nil {
			return
		}

		if messageType != websocket.MessageText {
			_ = writeWebSocketJSON(context.Background(), conn, wsErrorResponse{
				Type: "error",
				Error: wsErrorDetail{
					Code:    "unsupported_message_type",
					Message: "Only text messages are supported.",
				},
			})
			return
		}

		var incoming wsSignalMessage
		if err := json.Unmarshal(payload, &incoming); err != nil {
			_ = writeWebSocketJSON(context.Background(), conn, wsErrorResponse{
				Type: "error",
				Error: wsErrorDetail{
					Code:    "invalid_json",
					Message: "Message must be valid JSON.",
				},
			})
			return
		}

		if incoming.Type != "signal" {
			_ = writeWebSocketJSON(context.Background(), conn, wsErrorResponse{
				Type: "error",
				Error: wsErrorDetail{
					Code:    "unsupported_message_type",
					Message: "Only signal messages are supported.",
				},
			})
			continue
		}

		peer := membership.peer()
		if peer == nil {
			_ = writeWebSocketJSON(context.Background(), conn, wsErrorResponse{
				Type: "error",
				Error: wsErrorDetail{
					Code:    "peer_not_connected",
					Message: "Peer is not connected.",
				},
			})
			continue
		}

		if err := writeWebSocketJSON(context.Background(), peer.conn, wsSignalEnvelope{
			Type: "signal",
			From: wsSignalFrom{
				ParticipantID: membership.participant.participantID,
				Role:          membership.participant.role,
			},
			Payload: incoming.Payload,
		}); err != nil {
			return
		}
	}
}

func writeRoomState(ctx context.Context, membership *roomMembership) error {
	peer := membership.peer()
	var peerPayload *wsParticipantPayload
	if peer != nil {
		payload := participantPayload(peer.participant)
		peerPayload = &payload
	}

	return writeWebSocketJSON(ctx, membership.conn, wsRoomStateMessage{
		Type:      "room-state",
		SessionID: membership.room.sessionID,
		Self:      participantPayload(membership.participant),
		Peer:      peerPayload,
	})
}

func notifyPeerJoined(ctx context.Context, membership *roomMembership) error {
	peer := membership.peer()
	if peer == nil {
		return nil
	}

	return writeWebSocketJSON(ctx, peer.conn, wsPeerEventMessage{
		Type:        "peer-joined",
		SessionID:   membership.room.sessionID,
		Participant: participantPayload(membership.participant),
	})
}

func notifyPeerLeft(ctx context.Context, membership *roomMembership) error {
	peer := membership.peer()
	if peer == nil {
		return nil
	}

	return writeWebSocketJSON(ctx, peer.conn, wsPeerEventMessage{
		Type:        "peer-left",
		SessionID:   membership.room.sessionID,
		Participant: participantPayload(membership.participant),
	})
}

func participantPayload(participant wsParticipant) wsParticipantPayload {
	return wsParticipantPayload{
		ParticipantID: participant.participantID,
		Role:          participant.role,
	}
}

func extractSessionID(path string) (string, bool) {
	if path == "/v1/signaling/rooms" || path == "/v1/signaling/rooms/" {
		return "", false
	}

	if !strings.HasPrefix(path, signalingRoomRoutePrefix) {
		return "", false
	}

	sessionID := strings.TrimPrefix(path, signalingRoomRoutePrefix)
	if sessionID == "" || strings.Contains(sessionID, "/") {
		return "", false
	}

	return sessionID, true
}

func isWebSocketRequest(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}

	if !strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
		return false
	}

	return strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key")) != ""
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

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, "failed to encode json response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_, _ = w.Write(data)
	_, _ = w.Write([]byte("\n"))
}

func writeWebSocketJSON(ctx context.Context, conn *websocket.Conn, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	return conn.Write(ctx, websocket.MessageText, data)
}
