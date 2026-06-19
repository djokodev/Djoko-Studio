package postgres

import (
	"context"
	"database/sql"
	"errors"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
	"github.com/djokodev/Djoko-Studio/services/api/internal/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const exportColumnList = `
  id::text,
  recording_id::text,
  status,
  format,
  width,
  height,
  storage_object_key,
  byte_size,
  duration_ms,
  last_error,
  created_at,
  updated_at,
  completed_at
`

const createExportQuery = `
INSERT INTO exports (
  recording_id
) VALUES (
  $1::uuid
)
ON CONFLICT (recording_id) DO NOTHING
RETURNING
` + exportColumnList

const getExportByRecordingIDQuery = `
SELECT
` + exportColumnList + `
FROM exports
WHERE recording_id = $1::uuid
`

const updateExportQuery = `
UPDATE exports
SET
  status = $2,
  storage_object_key = $3,
  byte_size = $4,
  duration_ms = $5,
  last_error = $6,
  completed_at = $7,
  updated_at = now()
WHERE recording_id = $1::uuid
RETURNING
` + exportColumnList

type ExportStore struct {
	db queryer
}

var _ storage.ExportStore = (*ExportStore)(nil)

func NewExportStore(pool *pgxpool.Pool) *ExportStore {
	return &ExportStore{db: pool}
}

func (s *ExportStore) EnsureExport(ctx context.Context, params storage.EnsureExportParams) (domain.Export, bool, error) {
	export, err := scanExport(s.db.QueryRow(ctx, createExportQuery, params.RecordingID))
	if err == nil {
		return export, true, nil
	}

	if isForeignKeyViolation(err) {
		return domain.Export{}, false, storage.ErrNotFound
	}

	if !errors.Is(err, storage.ErrNotFound) {
		return domain.Export{}, false, err
	}

	export, err = s.GetExportByRecordingID(ctx, params.RecordingID)
	if err != nil {
		return domain.Export{}, false, err
	}

	return export, false, nil
}

func (s *ExportStore) GetExportByRecordingID(ctx context.Context, recordingID string) (domain.Export, error) {
	return scanExport(s.db.QueryRow(ctx, getExportByRecordingIDQuery, recordingID))
}

func (s *ExportStore) UpdateExport(ctx context.Context, params storage.UpdateExportParams) (domain.Export, error) {
	export, err := scanExport(s.db.QueryRow(
		ctx,
		updateExportQuery,
		params.RecordingID,
		params.Status,
		params.StorageObjectKey,
		params.ByteSize,
		params.DurationMs,
		params.LastError,
		params.CompletedAt,
	))
	if err != nil {
		if isForeignKeyViolation(err) {
			return domain.Export{}, storage.ErrNotFound
		}

		return domain.Export{}, err
	}

	return export, nil
}

func scanExport(scanner rowScanner) (domain.Export, error) {
	var (
		export           domain.Export
		status           string
		storageObjectKey sql.NullString
		byteSize         sql.NullInt64
		durationMs       sql.NullInt64
		lastError        sql.NullString
		completedAt      sql.NullTime
		width            int64
		height           int64
	)

	err := scanner.Scan(
		&export.ID,
		&export.RecordingID,
		&status,
		&export.Format,
		&width,
		&height,
		&storageObjectKey,
		&byteSize,
		&durationMs,
		&lastError,
		&export.CreatedAt,
		&export.UpdatedAt,
		&completedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Export{}, storage.ErrNotFound
		}

		return domain.Export{}, err
	}

	export.Status = domain.ExportStatus(status)
	export.Width = int(width)
	export.Height = int(height)
	export.StorageObjectKey = nullableStringPtr(storageObjectKey)
	export.ByteSize = nullableInt64Ptr(byteSize)
	export.DurationMs = nullableIntPtr(durationMs)
	export.LastError = nullableStringPtr(lastError)
	export.CompletedAt = nullableTimePtr(completedAt)

	return export, nil
}

func nullableInt64Ptr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}

	number := value.Int64
	return &number
}

func nullableIntPtr(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}

	number := int(value.Int64)
	return &number
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}

	return pgErr.Code == "23503"
}
