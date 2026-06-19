package domain

import "time"

type ExportStatus string

const (
	ExportStatusPending    ExportStatus = "pending"
	ExportStatusProcessing ExportStatus = "processing"
	ExportStatusReady      ExportStatus = "ready"
	ExportStatusFailed     ExportStatus = "failed"
)

type Export struct {
	ID               string
	RecordingID      string
	Status           ExportStatus
	Format           string
	Width            int
	Height           int
	StorageObjectKey *string
	ByteSize         *int64
	DurationMs       *int
	LastError        *string
	CreatedAt        time.Time
	UpdatedAt        time.Time
	CompletedAt      *time.Time
}
