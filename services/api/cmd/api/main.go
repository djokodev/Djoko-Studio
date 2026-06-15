package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/djokodev/Djoko-Studio/services/api/internal/config"
	"github.com/djokodev/Djoko-Studio/services/api/internal/httpserver"
)

func main() {
	cfg := config.Load(os.Getenv)

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})).With("app_env", cfg.Environment)

	server := httpserver.New(cfg.Port, logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("api server exited unexpectedly", "error", err)
			os.Exit(1)
		}
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Error("api server shutdown failed", "error", err)
			os.Exit(1)
		}

		if err := <-errCh; err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("api server exited unexpectedly", "error", err)
			os.Exit(1)
		}
	}

	logger.Info("api server stopped")
}
