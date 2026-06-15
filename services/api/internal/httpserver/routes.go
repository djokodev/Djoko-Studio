package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
)

type statusResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func newHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", allowOnly(http.MethodGet, healthzHandler))
	mux.HandleFunc("/readyz", allowOnly(http.MethodGet, readyzHandler))
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
	var buffer bytes.Buffer
	if err := json.NewEncoder(&buffer).Encode(payload); err != nil {
		http.Error(w, "failed to encode json response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_, _ = w.Write(buffer.Bytes())
}
