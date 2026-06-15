package httpserver

import (
	"context"
	"encoding/json"
	"net/http"

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

type welcomeResponse struct {
	Type    string `json:"type"`
	Service string `json:"service"`
}

type echoResponse struct {
	Type    string `json:"type"`
	Service string `json:"service"`
	Payload string `json:"payload"`
}

func newHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", allowOnly(http.MethodGet, healthzHandler))
	mux.HandleFunc("/readyz", allowOnly(http.MethodGet, readyzHandler))
	mux.HandleFunc("/ws", allowOnly(http.MethodGet, wsHandler))
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

func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()

	if err := writeWebSocketJSON(context.Background(), conn, welcomeResponse{
		Type:    "welcome",
		Service: serviceName,
	}); err != nil {
		return
	}

	for {
		messageType, payload, err := conn.Read(context.Background())
		if err != nil {
			return
		}

		if messageType != websocket.MessageText {
			continue
		}

		if err := writeWebSocketJSON(context.Background(), conn, echoResponse{
			Type:    "echo",
			Service: serviceName,
			Payload: string(payload),
		}); err != nil {
			return
		}
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
