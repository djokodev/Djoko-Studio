package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/djokodev/Djoko-Studio/services/api/internal/domain"
	"github.com/djokodev/Djoko-Studio/services/api/internal/storage"
)

type fakeExportStore struct {
	ensureExportFunc       func(ctx context.Context, params storage.EnsureExportParams) (domain.Export, bool, error)
	getExportByRecordingID func(ctx context.Context, recordingID string) (domain.Export, error)
	updateExportFunc       func(ctx context.Context, params storage.UpdateExportParams) (domain.Export, error)
}

func (f fakeExportStore) EnsureExport(ctx context.Context, params storage.EnsureExportParams) (domain.Export, bool, error) {
	if f.ensureExportFunc == nil {
		return domain.Export{}, false, errors.New("unexpected ensure export call")
	}

	return f.ensureExportFunc(ctx, params)
}

func (f fakeExportStore) GetExportByRecordingID(ctx context.Context, recordingID string) (domain.Export, error) {
	if f.getExportByRecordingID == nil {
		return domain.Export{}, errors.New("unexpected get export call")
	}

	return f.getExportByRecordingID(ctx, recordingID)
}

func (f fakeExportStore) UpdateExport(ctx context.Context, params storage.UpdateExportParams) (domain.Export, error) {
	if f.updateExportFunc == nil {
		return domain.Export{}, errors.New("unexpected update export call")
	}

	return f.updateExportFunc(ctx, params)
}

func TestGetRecordingExportReturnsExport(t *testing.T) {
	t.Parallel()

	completedAt := time.Date(2026, time.June, 16, 10, 0, 0, 0, time.UTC)
	createdAt := time.Date(2026, time.June, 15, 18, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(15 * time.Minute)
	storageObjectKey := "exports/recording-1/final.mp4"
	lastError := "FFmpeg missing"
	byteSize := int64(1024)
	durationMs := 12345

	handler := newHandler(Dependencies{
		ExportStore: fakeExportStore{
			getExportByRecordingID: func(ctx context.Context, recordingID string) (domain.Export, error) {
				if recordingID != "recording-1" {
					t.Fatalf("expected recording id lookup, got %q", recordingID)
				}

				return domain.Export{
					ID:               "export-1",
					RecordingID:      recordingID,
					Status:           domain.ExportStatusFailed,
					Format:           "mp4",
					Width:            1920,
					Height:           1080,
					StorageObjectKey: &storageObjectKey,
					ByteSize:         &byteSize,
					DurationMs:       &durationMs,
					LastError:        &lastError,
					CreatedAt:        createdAt,
					UpdatedAt:        updatedAt,
					CompletedAt:      &completedAt,
				}, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/recordings/recording-1/export", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if payload["recording_id"] != "recording-1" {
		t.Fatalf("expected recording id response, got %#v", payload["recording_id"])
	}

	if payload["status"] != "failed" {
		t.Fatalf("expected export status failed, got %#v", payload["status"])
	}

	if payload["last_error"] != lastError {
		t.Fatalf("expected last error %q, got %#v", lastError, payload["last_error"])
	}
}

func TestGetRecordingExportReturnsNotFound(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		ExportStore: fakeExportStore{
			getExportByRecordingID: func(ctx context.Context, recordingID string) (domain.Export, error) {
				return domain.Export{}, storage.ErrNotFound
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/recordings/recording-1/export", nil)

	handler.ServeHTTP(recorder, request)

	assertErrorResponse(t, recorder.Result(), http.StatusNotFound, "export not found")
}

func TestPostRecordingExportCreatesExportAndReturnsCreated(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 18, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(15 * time.Minute)

	var gotRecordingID string

	handler := newHandler(Dependencies{
		ExportStore: fakeExportStore{
			ensureExportFunc: func(ctx context.Context, params storage.EnsureExportParams) (domain.Export, bool, error) {
				gotRecordingID = params.RecordingID

				return domain.Export{
					ID:          "export-1",
					RecordingID: params.RecordingID,
					Status:      domain.ExportStatusPending,
					Format:      "mp4",
					Width:       1920,
					Height:      1080,
					CreatedAt:   createdAt,
					UpdatedAt:   updatedAt,
				}, true, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/recordings/recording-1/export", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, recorder.Code)
	}

	if gotRecordingID != "recording-1" {
		t.Fatalf("expected recording id %q, got %q", "recording-1", gotRecordingID)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if payload["status"] != "pending" {
		t.Fatalf("expected pending status, got %#v", payload["status"])
	}
}

func TestPostRecordingExportReturnsExistingExportWhenAlreadyPresent(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, time.June, 15, 18, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(15 * time.Minute)

	handler := newHandler(Dependencies{
		ExportStore: fakeExportStore{
			ensureExportFunc: func(ctx context.Context, params storage.EnsureExportParams) (domain.Export, bool, error) {
				return domain.Export{
					ID:          "export-1",
					RecordingID: params.RecordingID,
					Status:      domain.ExportStatusProcessing,
					Format:      "mp4",
					Width:       1920,
					Height:      1080,
					CreatedAt:   createdAt,
					UpdatedAt:   updatedAt,
				}, false, nil
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/recordings/recording-1/export", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if payload["status"] != "processing" {
		t.Fatalf("expected processing status, got %#v", payload["status"])
	}
}

func TestRecordingExportRoutesReturnServiceUnavailableWithoutStore(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{})

	tests := []struct {
		name   string
		method string
		target string
	}{
		{
			name:   "get export",
			method: http.MethodGet,
			target: "/v1/recordings/recording-1/export",
		},
		{
			name:   "create export",
			method: http.MethodPost,
			target: "/v1/recordings/recording-1/export",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(test.method, test.target, nil)

			handler.ServeHTTP(recorder, request)

			assertErrorResponse(t, recorder.Result(), http.StatusServiceUnavailable, "export store unavailable")
		})
	}
}

func TestRecordingExportRouteRejectsUnsupportedMethods(t *testing.T) {
	t.Parallel()

	handler := newHandler(Dependencies{
		ExportStore: fakeExportStore{
			getExportByRecordingID: func(ctx context.Context, recordingID string) (domain.Export, error) {
				return domain.Export{}, storage.ErrNotFound
			},
			ensureExportFunc: func(ctx context.Context, params storage.EnsureExportParams) (domain.Export, bool, error) {
				return domain.Export{}, false, storage.ErrNotFound
			},
		},
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/v1/recordings/recording-1/export", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status %d, got %d", http.StatusMethodNotAllowed, recorder.Code)
	}

	if got := recorder.Header().Get("Allow"); got != "GET, POST" {
		t.Fatalf("expected Allow header %q, got %q", "GET, POST", got)
	}
}
