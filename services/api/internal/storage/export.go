package storage

import (
	"context"
	"time"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
)

type EnsureExportParams struct {
	RecordingID string
}

type UpdateExportParams struct {
	RecordingID      string
	Status           domain.ExportStatus
	StorageObjectKey *string
	ByteSize         *int64
	DurationMs       *int
	LastError        *string
	CompletedAt      *time.Time
}

type ExportStore interface {
	EnsureExport(ctx context.Context, params EnsureExportParams) (domain.Export, bool, error)
	GetExportByRecordingID(ctx context.Context, recordingID string) (domain.Export, error)
	UpdateExport(ctx context.Context, params UpdateExportParams) (domain.Export, error)
}
