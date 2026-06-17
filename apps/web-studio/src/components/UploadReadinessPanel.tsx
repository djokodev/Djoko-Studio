import { useEffect, useState } from 'react';
import { formatBytes } from '../recording/formatBytes';
import type { LocalMediaRecorderController } from '../recording/useLocalMediaRecorder';
import {
  getPersistedUploadQueueSummary,
  isUploadQueuePersistenceSupported,
  type UploadQueuePersistenceSummary,
} from '../upload/recordingUploadPersistence';

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
  }, []);

  const localRecordingLabel = getLocalRecordingSafetyCopyLabel(recorder);
  const queueSummary = queueState.summary ?? initialUploadQueueSummary;
  const uploadStatusLabel = 'Disabled / Not started';
  const queueAvailabilityLabel = queueState.isSupported ? 'Available' : 'Unavailable';

  return (
    <section className="upload-readiness" aria-labelledby="upload-readiness-title">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Upload readiness</p>
          <h4 id="upload-readiness-title">Upload readiness panel</h4>
        </div>
        <span className="status-pill upload-readiness__status">Disabled</span>
      </div>

      <p className="api-note upload-readiness__note">
        Upload is not active in this build. The local browser recording remains the
        source of truth until a future server-confirmed upload slice is explicitly
        enabled.
      </p>

      <div className="upload-readiness__actions" aria-label="Upload readiness actions">
        <button className="submit-button signaling-button" type="button" disabled>
          Upload disabled in this build
        </button>
      </div>

      <dl className="details-grid upload-readiness__details">
        <div className="detail-card">
          <dt>Upload status</dt>
          <dd className="mono">{uploadStatusLabel}</dd>
        </div>
        <div className="detail-card">
          <dt>Progress</dt>
          <dd>0%</dd>
        </div>
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

      {recorder.persistenceErrorMessage ? (
        <div className="message message--warning upload-readiness__message" role="status">
          Local recording persistence note: {recorder.persistenceErrorMessage}
        </div>
      ) : null}

      {queueState.status === 'failed' ? (
        <div className="message message--warning upload-readiness__message" role="status">
          Upload queue persistence note: {queueState.errorMessage}
        </div>
      ) : null}

      {queueState.status !== 'failed' && queueState.isSupported ? (
        <div className="message upload-readiness__message" role="status">
          Upload queue metadata is readable in this browser, but transport remains
          disabled.
        </div>
      ) : null}
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
