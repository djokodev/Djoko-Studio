package postgres

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
	"github.com/djokodev/Djoko-Studio/services/api/internal/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestScanExportReturnsNotFoundForMissingRow(t *testing.T) {
	t.Parallel()

	_, err := scanExport(stubRowScanner{
		scan: func(dest ...any) error {
			return pgx.ErrNoRows
		},
	})
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected error %v, got %v", storage.ErrNotFound, err)
	}
}

func TestScanExportMapsDatabaseRowToDomainExport(t *testing.T) {
	t.Parallel()

	completedAt := time.Date(2026, time.June, 16, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, time.June, 15, 18, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(15 * time.Minute)
	storageObjectKey := "exports/recording-1/final.mp4"
	lastError := "FFmpeg missing"
	byteSize := int64(1024)
	durationMs := int64(12345)

	export, err := scanExport(stubRowScanner{
		scan: func(dest ...any) error {
			*(dest[0].(*string)) = "export-1"
			*(dest[1].(*string)) = "recording-1"
			*(dest[2].(*string)) = "failed"
			*(dest[3].(*string)) = "mp4"
			*(dest[4].(*int64)) = 1920
			*(dest[5].(*int64)) = 1080
			*(dest[6].(*sql.NullString)) = sql.NullString{String: storageObjectKey, Valid: true}
			*(dest[7].(*sql.NullInt64)) = sql.NullInt64{Int64: byteSize, Valid: true}
			*(dest[8].(*sql.NullInt64)) = sql.NullInt64{Int64: durationMs, Valid: true}
			*(dest[9].(*sql.NullString)) = sql.NullString{String: lastError, Valid: true}
			*(dest[10].(*time.Time)) = createdAt
			*(dest[11].(*time.Time)) = updatedAt
			*(dest[12].(*sql.NullTime)) = sql.NullTime{Time: completedAt, Valid: true}
			return nil
		},
	})
	if err != nil {
		t.Fatalf("scan export: %v", err)
	}

	if export.ID != "export-1" {
		t.Fatalf("expected export id %q, got %q", "export-1", export.ID)
	}

	if export.RecordingID != "recording-1" {
		t.Fatalf("expected recording id %q, got %q", "recording-1", export.RecordingID)
	}

	if export.Status != domain.ExportStatusFailed {
		t.Fatalf("expected export status %q, got %q", domain.ExportStatusFailed, export.Status)
	}

	if export.Width != 1920 || export.Height != 1080 {
		t.Fatalf("expected 1920x1080, got %dx%d", export.Width, export.Height)
	}

	if export.StorageObjectKey == nil || *export.StorageObjectKey != storageObjectKey {
		t.Fatalf("expected storage object key %q, got %v", storageObjectKey, export.StorageObjectKey)
	}

	if export.ByteSize == nil || *export.ByteSize != byteSize {
		t.Fatalf("expected byte size %d, got %v", byteSize, export.ByteSize)
	}

	if export.DurationMs == nil || *export.DurationMs != int(durationMs) {
		t.Fatalf("expected duration %d, got %v", durationMs, export.DurationMs)
	}

	if export.LastError == nil || *export.LastError != lastError {
		t.Fatalf("expected last error %q, got %v", lastError, export.LastError)
	}

	if export.CompletedAt == nil || !export.CompletedAt.Equal(completedAt) {
		t.Fatalf("expected completed time %v, got %v", completedAt, export.CompletedAt)
	}
}

func TestEnsureExportCreatesExportWhenMissing(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 18, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(15 * time.Minute)

	var gotCreateQuery string
	var gotGetQuery string
	var gotCreateArgs []any
	var callCount int

	store := &ExportStore{
		db: stubQueryer{
			queryRow: func(ctx context.Context, query string, args ...any) pgx.Row {
				callCount++
				switch callCount {
				case 1:
					gotCreateQuery = query
					gotCreateArgs = append([]any(nil), args...)
					return stubRowScanner{
						scan: func(dest ...any) error {
							*(dest[0].(*string)) = "export-1"
							*(dest[1].(*string)) = "recording-1"
							*(dest[2].(*string)) = "pending"
							*(dest[3].(*string)) = "mp4"
							*(dest[4].(*int64)) = 1920
							*(dest[5].(*int64)) = 1080
							*(dest[6].(*sql.NullString)) = sql.NullString{}
							*(dest[7].(*sql.NullInt64)) = sql.NullInt64{}
							*(dest[8].(*sql.NullInt64)) = sql.NullInt64{}
							*(dest[9].(*sql.NullString)) = sql.NullString{}
							*(dest[10].(*time.Time)) = createdAt
							*(dest[11].(*time.Time)) = updatedAt
							*(dest[12].(*sql.NullTime)) = sql.NullTime{}
							return nil
						},
					}
				case 2:
					gotGetQuery = query
					return stubRowScanner{
						scan: func(dest ...any) error {
							*(dest[0].(*string)) = "export-1"
							*(dest[1].(*string)) = "recording-1"
							*(dest[2].(*string)) = "pending"
							*(dest[3].(*string)) = "mp4"
							*(dest[4].(*int64)) = 1920
							*(dest[5].(*int64)) = 1080
							*(dest[6].(*sql.NullString)) = sql.NullString{}
							*(dest[7].(*sql.NullInt64)) = sql.NullInt64{}
							*(dest[8].(*sql.NullInt64)) = sql.NullInt64{}
							*(dest[9].(*sql.NullString)) = sql.NullString{}
							*(dest[10].(*time.Time)) = createdAt
							*(dest[11].(*time.Time)) = updatedAt
							*(dest[12].(*sql.NullTime)) = sql.NullTime{}
							return nil
						},
					}
				default:
					t.Fatalf("unexpected query row call %d", callCount)
					return nil
				}
			},
		},
	}

	export, created, err := store.EnsureExport(context.Background(), storage.EnsureExportParams{
		RecordingID: "recording-1",
	})
	if err != nil {
		t.Fatalf("ensure export: %v", err)
	}

	if !created {
		t.Fatal("expected export to be created")
	}

	if gotCreateQuery != createExportQuery {
		t.Fatalf("expected create export query to be used")
	}

	if len(gotCreateArgs) != 1 || gotCreateArgs[0] != "recording-1" {
		t.Fatalf("expected recording id arg %q, got %v", "recording-1", gotCreateArgs)
	}

	if gotGetQuery != "" {
		t.Fatalf("expected no fallback get query, got %q", gotGetQuery)
	}

	if export.RecordingID != "recording-1" {
		t.Fatalf("expected recording id %q, got %q", "recording-1", export.RecordingID)
	}
}

func TestEnsureExportReturnsExistingExportWhenAlreadyPresent(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 18, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(15 * time.Minute)

	var createCalled bool
	var getCalled bool
	var callCount int

	store := &ExportStore{
		db: stubQueryer{
			queryRow: func(ctx context.Context, query string, args ...any) pgx.Row {
				callCount++
				switch callCount {
				case 1:
					createCalled = true
					return stubRowScanner{
						scan: func(dest ...any) error {
							return pgx.ErrNoRows
						},
					}
				case 2:
					getCalled = true
					return stubRowScanner{
						scan: func(dest ...any) error {
							*(dest[0].(*string)) = "export-1"
							*(dest[1].(*string)) = "recording-1"
							*(dest[2].(*string)) = "processing"
							*(dest[3].(*string)) = "mp4"
							*(dest[4].(*int64)) = 1920
							*(dest[5].(*int64)) = 1080
							*(dest[6].(*sql.NullString)) = sql.NullString{}
							*(dest[7].(*sql.NullInt64)) = sql.NullInt64{}
							*(dest[8].(*sql.NullInt64)) = sql.NullInt64{}
							*(dest[9].(*sql.NullString)) = sql.NullString{}
							*(dest[10].(*time.Time)) = createdAt
							*(dest[11].(*time.Time)) = updatedAt
							*(dest[12].(*sql.NullTime)) = sql.NullTime{}
							return nil
						},
					}
				default:
					t.Fatalf("unexpected query row call %d", callCount)
					return nil
				}
			},
		},
	}

	export, created, err := store.EnsureExport(context.Background(), storage.EnsureExportParams{
		RecordingID: "recording-1",
	})
	if err != nil {
		t.Fatalf("ensure export: %v", err)
	}

	if created {
		t.Fatal("expected export to already exist")
	}

	if !createCalled || !getCalled {
		t.Fatalf("expected create and get queries to be used, got create=%v get=%v", createCalled, getCalled)
	}

	if export.Status != domain.ExportStatusProcessing {
		t.Fatalf("expected processing status, got %q", export.Status)
	}
}

func TestEnsureExportReturnsNotFoundForMissingRecording(t *testing.T) {
	t.Parallel()

	store := &ExportStore{
		db: stubQueryer{
			queryRow: func(ctx context.Context, query string, args ...any) pgx.Row {
				return stubRowScanner{
					scan: func(dest ...any) error {
						return &pgconn.PgError{Code: "23503"}
					},
				}
			},
		},
	}

	_, _, err := store.EnsureExport(context.Background(), storage.EnsureExportParams{
		RecordingID: "missing-recording",
	})
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("expected error %v, got %v", storage.ErrNotFound, err)
	}
}

func TestUpdateExportUpdatesStatusAndLastError(t *testing.T) {
	t.Parallel()

	completedAt := time.Date(2026, time.June, 16, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, time.June, 15, 18, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(20 * time.Minute)
	storageObjectKey := "exports/recording-1/final.mp4"
	lastError := "FFmpeg missing"
	byteSize := int64(1024)
	durationMs := 12345

	var gotQuery string
	var gotArgs []any

	store := &ExportStore{
		db: stubQueryer{
			queryRow: func(ctx context.Context, query string, args ...any) pgx.Row {
				gotQuery = query
				gotArgs = append([]any(nil), args...)

				return stubRowScanner{
					scan: func(dest ...any) error {
						*(dest[0].(*string)) = "export-1"
						*(dest[1].(*string)) = "recording-1"
						*(dest[2].(*string)) = "failed"
						*(dest[3].(*string)) = "mp4"
						*(dest[4].(*int64)) = 1920
						*(dest[5].(*int64)) = 1080
						*(dest[6].(*sql.NullString)) = sql.NullString{String: storageObjectKey, Valid: true}
						*(dest[7].(*sql.NullInt64)) = sql.NullInt64{Int64: byteSize, Valid: true}
						*(dest[8].(*sql.NullInt64)) = sql.NullInt64{Int64: int64(durationMs), Valid: true}
						*(dest[9].(*sql.NullString)) = sql.NullString{String: lastError, Valid: true}
						*(dest[10].(*time.Time)) = createdAt
						*(dest[11].(*time.Time)) = updatedAt
						*(dest[12].(*sql.NullTime)) = sql.NullTime{Time: completedAt, Valid: true}
						return nil
					},
				}
			},
		},
	}

	export, err := store.UpdateExport(context.Background(), storage.UpdateExportParams{
		RecordingID:      "recording-1",
		Status:           domain.ExportStatusFailed,
		StorageObjectKey: &storageObjectKey,
		ByteSize:         &byteSize,
		DurationMs:       &durationMs,
		LastError:        &lastError,
		CompletedAt:      &completedAt,
	})
	if err != nil {
		t.Fatalf("update export: %v", err)
	}

	if gotQuery != updateExportQuery {
		t.Fatalf("expected update export query to be used")
	}

	if len(gotArgs) != 7 {
		t.Fatalf("expected 7 query args, got %d", len(gotArgs))
	}

	if gotArgs[0] != "recording-1" {
		t.Fatalf("expected recording id arg %q, got %v", "recording-1", gotArgs[0])
	}

	if gotArgs[1] != domain.ExportStatusFailed {
		t.Fatalf("expected status arg %q, got %v", domain.ExportStatusFailed, gotArgs[1])
	}

	if export.LastError == nil || *export.LastError != lastError {
		t.Fatalf("expected last error %q, got %v", lastError, export.LastError)
	}
}
