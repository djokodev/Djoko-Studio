package httpserver

import (
	"context"
	"log/slog"
	"net/http"
	"time"
)

const defaultPort = "8081"

type Server struct {
	addr       string
	logger     *slog.Logger
	httpServer *http.Server
}

func New(port string, logger *slog.Logger) *Server {
	if port == "" {
		port = defaultPort
	}

	if logger == nil {
		logger = slog.Default()
	}

	srv := &Server{
		addr:   ":" + port,
		logger: logger,
	}
	srv.httpServer = &http.Server{
		Addr:              srv.addr,
		Handler:           newHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	return srv
}

func (s *Server) Addr() string {
	return s.addr
}

func (s *Server) Handler() http.Handler {
	return s.httpServer.Handler
}

func (s *Server) ListenAndServe() error {
	s.logger.Info("signaling server listening", "addr", s.addr)
	return s.httpServer.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("signaling server shutting down")
	return s.httpServer.Shutdown(ctx)
}
