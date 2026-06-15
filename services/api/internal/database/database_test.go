package database

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestOpenWithEmptyDatabaseURLReturnsDisabledDB(t *testing.T) {
	t.Parallel()

	db, err := Open(context.Background(), "")
	if err != nil {
		t.Fatalf("open disabled db: %v", err)
	}

	if db == nil {
		t.Fatal("expected db, got nil")
	}

	if db.Enabled() {
		t.Fatal("expected disabled db")
	}

	if err := db.Ping(context.Background()); err != nil {
		t.Fatalf("expected disabled db ping to be a no-op, got %v", err)
	}

	db.Close()
	db.Close()
}

func TestOpenWithInvalidDatabaseURLReturnsError(t *testing.T) {
	t.Parallel()

	invalidURL := "://invalid"
	db, err := Open(context.Background(), invalidURL)
	if err == nil {
		db.Close()
		t.Fatal("expected error for invalid database url")
	}

	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("expected error %v, got %v", ErrInvalidConfig, err)
	}

	if strings.Contains(err.Error(), invalidURL) {
		t.Fatalf("expected sanitized error, got %q", err.Error())
	}
}
