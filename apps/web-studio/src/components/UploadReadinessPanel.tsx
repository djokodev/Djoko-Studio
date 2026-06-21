import { useEffect, useState } from 'react';
import { formatBytes } from '../recording/formatBytes';
import type { LocalMediaRecorderController } from '../recording/useLocalMediaRecorder';
import {
  getPersistedUploadQueueSummary,
  isUploadQueuePersistenceSupported,
  type UploadQueuePersistenceSummary,
} from '../upload/recordingUploadPersistence';
import { useRecordingUploadQueue } from '../upload/useRecordingUploadQueue';
import { DebugOnly } from './debug/DebugOnly';

interface UploadReadinessPanelProps {
  recorder: LocalMediaRecorderController;
}

type UploadQueueSummaryState =
  | {
      status: 'loading';
      isSupported: boolean;
      summary: UploadQueuePersistenceSummary | null;
      errorMessage: null;
    }
  | {
      status: 'ready';
      isSupported: boolean;
      summary: UploadQueuePersistenceSummary;
      errorMessage: null;
    }
  | {
      status: 'failed';
      isSupported: boolean;
      summary: UploadQueuePersistenceSummary | null;
      errorMessage: string;
    };

const initialUploadQueueSummary: UploadQueuePersistenceSummary = {
  uploadSessionCount: 0,
  uploadChunkCount: 0,
  totalExpectedBytes: 0,
  totalUploadedBytes: 0,
  latestUpdatedAt: null,
};

export function UploadReadinessPanel({ recorder }: UploadReadinessPanelProps) {
  const [queueState, setQueueState] = useState<UploadQueueSummaryState>({
    status: 'loading',
    isSupported: isUploadQueuePersistenceSupported(),
    summary: null,
    errorMessage: null,
  });
  const uploadQueue = useRecordingUploadQueue(recorder.persistedRecordings);

  useEffect(() => {
    let isActive = true;

    setQueueState({
      status: 'loading',
      isSupported: isUploadQueuePersistenceSupported(),
      summary: null,
      errorMessage: null,
    });

    getPersistedUploadQueueSummary()
      .then((summary) => {
        if (!isActive) {
          return;
        }

        setQueueState({
          status: 'ready',
          isSupported: isUploadQueuePersistenceSupported(),
          summary,
          errorMessage: null,
        });
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setQueueState({
          status: 'failed',
          isSupported: isUploadQueuePersistenceSupported(),
          summary: null,
          errorMessage: getErrorMessage(error, 'Unable to read upload queue persistence.'),
        });
      });

    return () => {
      isActive = false;
    };
  }, [recorder.persistedRecordings.length, uploadQueue.summaryRevision]);

  const localRecordingLabel = getLocalRecordingSafetyCopyLabel(recorder);
  const queueSummary = queueState.summary ?? initialUploadQueueSummary;
  const queueAvailabilityLabel = queueState.isSupported ? 'Available' : 'Unavailable';
  const hasVisibleUploadItems = uploadQueue.items.length > 0;

  return (
    <section
      className="upload-readiness"
      aria-labelledby="upload-readiness-title"
      id="app-upload-flow"
    >
      <div className="panel__header">
        <div>
          <p className="eyebrow">Upload readiness</p>
          <h4 id="upload-readiness-title">Upload local copy</h4>
        </div>
        <span className={`status-pill ${hasVisibleUploadItems ? 'status-pill--live' : ''}`}>
          {hasVisibleUploadItems ? 'Ready' : 'Idle'}
        </span>
      </div>

      <p className="api-note upload-readiness__note">
        The browser keeps the local copy until the server confirms the upload.
      </p>

      {uploadQueue.errorMessage ? (
        <div className="message message--warning upload-readiness__message" role="status">
          Upload progress needs attention.
        </div>
      ) : null}

      {queueState.status === 'failed' ? (
        <div className="message message--warning upload-readiness__message" role="status">
          Upload queue is temporarily unavailable.
        </div>
      ) : null}

      <DebugOnly>
        <dl className="details-grid upload-readiness__details">
          <div className="detail-card">
            <dt>Local safety copy</dt>
            <dd>{localRecordingLabel}</dd>
          </div>
          <div className="detail-card">
            <dt>Current recording persisted</dt>
            <dd>{recorder.summary.currentRecordingPersisted ? 'Yes' : 'No'}</dd>
          </div>
          <div className="detail-card">
            <dt>Persisted local recordings</dt>
            <dd>{recorder.persistedRecordings.length}</dd>
          </div>
          <div className="detail-card">
            <dt>Upload queue persistence</dt>
            <dd>{queueAvailabilityLabel}</dd>
          </div>
          <div className="detail-card">
            <dt>Persisted upload sessions</dt>
            <dd>{queueSummary.uploadSessionCount}</dd>
          </div>
          <div className="detail-card">
            <dt>Persisted upload chunks</dt>
            <dd>{queueSummary.uploadChunkCount}</dd>
          </div>
          <div className="detail-card">
            <dt>Tracked expected bytes</dt>
            <dd>{formatBytes(queueSummary.totalExpectedBytes)}</dd>
          </div>
          <div className="detail-card">
            <dt>Tracked uploaded bytes</dt>
            <dd>{formatBytes(queueSummary.totalUploadedBytes)}</dd>
          </div>
        </dl>
      </DebugOnly>

      {queueState.status === 'ready' && uploadQueue.items.length === 0 ? (
        <div className="message upload-readiness__message" role="status">
          No persisted local recording is ready to upload yet.
        </div>
      ) : null}

      <div className="upload-readiness__cards">
        {uploadQueue.items.map((item) => (
          <article className="recording-recovery__item" key={item.recording.recordingId}>
            <div className="panel__header recording-recovery__item-header">
              <div>
                <p className="eyebrow">Upload queue item</p>
                <h5 className="recording-recovery__item-title">Local recording</h5>
              </div>
              <span className="status-pill">{item.statusLabel}</span>
            </div>

            <p className="api-note upload-readiness__note">{item.progressLabel}</p>

            <DebugOnly>
              <dl className="details-grid recording-recovery__details">
                <div className="detail-card">
                  <dt>Session ID</dt>
                  <dd className="mono">{item.recording.manifest.sessionId ?? '—'}</dd>
                </div>
                <div className="detail-card">
                  <dt>Participant ID</dt>
                  <dd className="mono">{item.recording.manifest.participantId ?? '—'}</dd>
                </div>
                <div className="detail-card">
                  <dt>Role</dt>
                  <dd className="mono">{item.recording.manifest.role ?? '—'}</dd>
                </div>
                <div className="detail-card">
                  <dt>Upload status</dt>
                  <dd className="mono">{item.uploadLabel}</dd>
                </div>
                <div className="detail-card">
                  <dt>Progress</dt>
                  <dd>{item.progressLabel}</dd>
                </div>
                <div className="detail-card">
                  <dt>Chunk count</dt>
                  <dd>{item.recording.manifest.chunkCount}</dd>
                </div>
                <div className="detail-card">
                  <dt>Total bytes</dt>
                  <dd>{formatBytes(item.recording.manifest.totalBytes)}</dd>
                </div>
                <div className="detail-card">
                  <dt>Upload error</dt>
                  <dd>{item.state?.errorMessage ?? '—'}</dd>
                </div>
              </dl>
            </DebugOnly>

            <div className="upload-readiness__actions" aria-label="Upload actions">
              <button
                className="submit-button signaling-button"
                type="button"
                onClick={() => {
                  if (item.state === null || item.state.status === 'not_started' || item.state.status === 'canceled') {
                    void uploadQueue.startUpload(item.recording);
                    return;
                  }

                  void uploadQueue.resumeUpload(item.recording);
                }}
                disabled={
                  !item.canUpload ||
                  uploadQueue.loading ||
                  item.state?.status === 'uploaded' ||
                  item.state?.status === 'uploading' ||
                  item.state?.status === 'initializing'
                }
              >
                {item.uploadLabel}
              </button>
              <button
                className="submit-button signaling-button signaling-button--secondary"
                type="button"
                onClick={() => {
                  void uploadQueue.pauseUpload(item.recording.recordingId);
                }}
                disabled={!item.canPause || uploadQueue.loading}
              >
                Pause
              </button>
              <button
                className="submit-button signaling-button signaling-button--secondary"
                type="button"
                onClick={() => {
                  void uploadQueue.resumeUpload(item.recording);
                }}
                disabled={!item.canResume || uploadQueue.loading}
              >
                Resume
              </button>
              <button
                className="submit-button signaling-button signaling-button--secondary"
                type="button"
                onClick={() => {
                  void uploadQueue.cancelUpload(item.recording.recordingId);
                }}
                disabled={!item.canCancel || uploadQueue.loading}
              >
                Cancel
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function getLocalRecordingSafetyCopyLabel(recorder: LocalMediaRecorderController): string {
  if (recorder.summary.recordingId === null) {
    return 'No local recording yet';
  }

  if (recorder.summary.currentRecordingPersisted) {
    return 'Current recording persisted locally';
  }

  if (recorder.persistedRecordings.length > 0) {
    return 'Persisted local recordings are available';
  }

  return 'Local browser copy only';
}

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallbackMessage;
}
