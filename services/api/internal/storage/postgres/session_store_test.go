package postgres

import (
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
	"github.com/djokodev/Djoko-Studio/services/api/internal/storage"
	"github.com/jackc/pgx/v5"
)

type stubRowScanner struct {
	scan func(dest ...any) error
}

func (s stubRowScanner) Scan(dest ...any) error {
	return s.scan(dest...)
}

func TestScanSessionReturnsNotFoundForMissingRow(t *testing.T) {
	t.Parallel()

	_, err := scanSession(stubRowScanner{
		scan: func(dest ...any) error {
			return pgx.ErrNoRows
		},
	})
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected error %v, got %v", storage.ErrNotFound, err)
	}
}

func TestScanSessionMapsDatabaseRowToDomainSession(t *testing.T) {
	t.Parallel()

	scheduledAt := time.Date(2026, time.June, 20, 14, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, time.June, 15, 18, 0, 0, 0, time.UTC)
	updatedAt := time.Date(2026, time.June, 15, 18, 30, 0, 0, time.UTC)

	session, err := scanSession(stubRowScanner{
		scan: func(dest ...any) error {
			*(dest[0].(*string)) = "session-1"
			*(dest[1].(*string)) = "studio-1"
			*(dest[2].(*string)) = "user-1"
			*(dest[3].(*string)) = "Launch recording"
			*(dest[4].(*string)) = "waiting"
			*(dest[5].(*sql.NullTime)) = sql.NullTime{Time: scheduledAt, Valid: true}
			*(dest[6].(*sql.NullTime)) = sql.NullTime{}
			*(dest[7].(*sql.NullTime)) = sql.NullTime{}
			*(dest[8].(*time.Time)) = createdAt
			*(dest[9].(*time.Time)) = updatedAt
			return nil
		},
	})
	if err != nil {
		t.Fatalf("scan session: %v", err)
	}

	if session.ID != "session-1" {
		t.Fatalf("expected session id %q, got %q", "session-1", session.ID)
	}

	if session.Status != domain.SessionStatusWaiting {
		t.Fatalf("expected session status %q, got %q", domain.SessionStatusWaiting, session.Status)
	}

	if session.ScheduledAt == nil || !session.ScheduledAt.Equal(scheduledAt) {
		t.Fatalf("expected scheduled time %v, got %v", scheduledAt, session.ScheduledAt)
	}

	if session.StartedAt != nil {
		t.Fatalf("expected nil started time, got %v", session.StartedAt)
	}

	if session.EndedAt != nil {
		t.Fatalf("expected nil ended time, got %v", session.EndedAt)
	}
}

func TestNullableTimePtr(t *testing.T) {
	t.Parallel()

	if got := nullableTimePtr(sql.NullTime{}); got != nil {
		t.Fatalf("expected nil time pointer, got %v", got)
	}

	value := time.Date(2026, time.June, 21, 9, 0, 0, 0, time.UTC)
	got := nullableTimePtr(sql.NullTime{Time: value, Valid: true})
	if got == nil || !got.Equal(value) {
		t.Fatalf("expected time %v, got %v", value, got)
	}
}
