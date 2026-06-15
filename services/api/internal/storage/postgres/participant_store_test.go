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

func TestScanParticipantReturnsNotFoundForMissingRow(t *testing.T) {
	t.Parallel()

	_, err := scanParticipant(stubRowScanner{
		scan: func(dest ...any) error {
			return pgx.ErrNoRows
		},
	})
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected error %v, got %v", storage.ErrNotFound, err)
	}
}

func TestScanParticipantMapsDatabaseRowToDomainParticipant(t *testing.T) {
	t.Parallel()

	joinedAt := time.Date(2026, time.June, 15, 20, 3, 0, 0, time.UTC)
	createdAt := time.Date(2026, time.June, 15, 20, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(2 * time.Minute)

	participant, err := scanParticipant(stubRowScanner{
		scan: func(dest ...any) error {
			*(dest[0].(*string)) = "participant-1"
			*(dest[1].(*string)) = "session-1"
			*(dest[2].(*sql.NullString)) = sql.NullString{}
			*(dest[3].(*string)) = "guest"
			*(dest[4].(*sql.NullString)) = sql.NullString{String: "Guest Name", Valid: true}
			*(dest[5].(*sql.NullString)) = sql.NullString{}
			*(dest[6].(*string)) = "joined"
			*(dest[7].(*sql.NullTime)) = sql.NullTime{Time: joinedAt, Valid: true}
			*(dest[8].(*sql.NullTime)) = sql.NullTime{}
			*(dest[9].(*time.Time)) = createdAt
			*(dest[10].(*time.Time)) = updatedAt
			return nil
		},
	})
	if err != nil {
		t.Fatalf("scan participant: %v", err)
	}

	if participant.ID != "participant-1" {
		t.Fatalf("expected participant id %q, got %q", "participant-1", participant.ID)
	}

	if participant.Role != domain.ParticipantRoleGuest {
		t.Fatalf("expected participant role %q, got %q", domain.ParticipantRoleGuest, participant.Role)
	}

	if participant.DisplayName == nil || *participant.DisplayName != "Guest Name" {
		t.Fatalf("expected display name %q, got %v", "Guest Name", participant.DisplayName)
	}

	if participant.Status != domain.ParticipantStatusJoined {
		t.Fatalf("expected participant status %q, got %q", domain.ParticipantStatusJoined, participant.Status)
	}

	if participant.JoinedAt == nil || !participant.JoinedAt.Equal(joinedAt) {
		t.Fatalf("expected joined time %v, got %v", joinedAt, participant.JoinedAt)
	}
}

func TestNullableStringPtr(t *testing.T) {
	t.Parallel()

	if got := nullableStringPtr(sql.NullString{}); got != nil {
		t.Fatalf("expected nil string pointer, got %v", got)
	}

	got := nullableStringPtr(sql.NullString{String: "Guest Name", Valid: true})
	if got == nil || *got != "Guest Name" {
		t.Fatalf("expected string %q, got %v", "Guest Name", got)
	}
}
