import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../recording/formatBytes';
import type { LocalMediaRecorderController } from '../recording/useLocalMediaRecorder';
import { useRecordingUploadQueue } from '../upload/useRecordingUploadQueue';
import {
  createRecordingExportApiClient,
  getExportBaseUrl,
  isExportWorkerReady,
  type RecordingExportManifest,
  type RecordingExportReadyzResponse,
} from '../export/recordingExportApiClient';
import {
  getPersistedExportId,
  savePersistedExportId,
} from '../export/recordingExportPersistence';
import {
  getExportStatusSummaryLabel,
  getExportTargetLabel,
  selectLatestExportCandidate,
} from '../export/recordingExportSelection';

interface ProcessingExportPanelProps {
  recorder: LocalMediaRecorderController;
}

type ExportReadinessState =
  | { status: 'loading'; configured: boolean; response: null; errorMessage: null }
  | { status: 'ready'; configured: boolean; response: RecordingExportReadyzResponse; errorMessage: null }
  | { status: 'failed'; configured: boolean; response: null; errorMessage: string };

const initialReadinessState: ExportReadinessState = {
  status: 'loading',
  configured: getExportBaseUrl().trim() !== '',
  response: null,
  errorMessage: null,
};

export function ProcessingExportPanel({ recorder }: ProcessingExportPanelProps) {
  const [readinessState, setReadinessState] = useState<ExportReadinessState>(initialReadinessState);
  const [exportManifest, setExportManifest] = useState<RecordingExportManifest | null>(null);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [activeExportId, setActiveExportId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const uploadQueue = useRecordingUploadQueue(recorder.persistedRecordings);
  const exportBaseUrl = getExportBaseUrl().trim();
  const exportClient = createRecordingExportApiClient(exportBaseUrl);
  const candidate = selectLatestExportCandidate(uploadQueue.items);
  const hasConfiguredService = exportBaseUrl !== '';
  const exportReady = exportManifest?.status === 'ready';
  const workerReady = readinessState.status === 'ready' && isExportWorkerReady(readinessState.response);
  const targetLabel = getExportTargetLabel();

  useEffect(() => {
    let isActive = true;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!hasConfiguredService) {
      setReadinessState({
        status: 'loading',
        configured: false,
        response: null,
        errorMessage: null,
      });
      return () => {
        isActive = false;
      };
    }

    void exportClient
      .getReadyz()
      .then((response) => {
        if (!isActive || requestId !== requestIdRef.current) {
          return;
        }

        setReadinessState({
          status: 'ready',
          configured: true,
          response,
          errorMessage: null,
        });
      })
      .catch((error: unknown) => {
        if (!isActive || requestId !== requestIdRef.current) {
          return;
        }

        setReadinessState({
          status: 'failed',
          configured: true,
          response: null,
          errorMessage: getErrorMessage(error, 'Unable to read export service readiness.'),
        });
      });

    return () => {
      isActive = false;
    };
  }, [exportBaseUrl]);

  useEffect(() => {
    let isActive = true;

    if (candidate === null) {
      setActiveExportId(null);
      setExportManifest(null);
      setExportMessage('');
      setExportError('');
      return () => {
        isActive = false;
      };
    }

    const persistedExportId = getPersistedExportId(candidate.recordingId);
    const candidateExportId = persistedExportId ?? getCandidateExportId(candidate.recordingId);
    if (candidateExportId === null) {
      setActiveExportId(null);
      setExportManifest(null);
      setExportMessage('');
      setExportError('');
      return () => {
        isActive = false;
      };
    }

    setActiveExportId(candidateExportId);

    void loadExportStatus(candidateExportId).then((manifest) => {
      if (!isActive) {
        return;
      }

      setExportManifest(manifest);
      if (manifest !== null) {
        savePersistedExportId(manifest.recordingId, manifest.exportId);
        setActiveExportId(manifest.exportId);
        setExportError('');
        setExportMessage(getExportStatusMessage(manifest));
      }
    });

    return () => {
      isActive = false;
    };
  }, [candidate?.recordingId, uploadQueue.summaryRevision]);

  const startDisabled = isStartExportDisabled({
    hasConfiguredService,
    hasCandidate: candidate !== null,
    isSubmitting,
    readinessStatus: readinessState.status,
    readinessConfigured: readinessState.configured,
    workerReady,
  });
  const refreshDisabled = !hasConfiguredService || isRefreshing;
  const downloadDisabled = !exportReady || isDownloading || activeExportId === null;

  return (
    <section className="panel export-panel" aria-labelledby="processing-export-title">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Processing & export</p>
          <h3 id="processing-export-title">Processing & Export dashboard</h3>
        </div>
        <span className={`status-pill ${readinessState.status === 'ready' ? 'status-pill--live' : ''}`}>
          {hasConfiguredService
            ? readinessState.status === 'ready'
              ? readinessState.response?.status === 'ok'
                ? 'Configured'
                : 'Degraded'
              : readinessState.status === 'failed'
                ? 'Unavailable'
                : 'Checking'
            : 'Not configured'}
        </span>
      </div>

      <p className="api-note export-panel__note">
        The browser can start a direct export against the local export worker. The
        source of truth for the source recording stays in IndexedDB and the upload
        service until the export worker confirms the final MP4.
      </p>

      {!hasConfiguredService ? (
        <div className="message message--warning export-panel__message" role="status">
          Export service is not configured. Set VITE_EXPORT_BASE_URL.
        </div>
      ) : null}

      {readinessState.status === 'failed' ? (
        <div className="message message--warning export-panel__message" role="status">
          Export service readiness: {readinessState.errorMessage}
        </div>
      ) : null}

      {candidate === null ? (
        <div className="message export-panel__message" role="status">
          No uploaded local recording is ready for export yet.
        </div>
      ) : null}

      <dl className="details-grid export-panel__details">
        <div className="detail-card">
          <dt>Service configured</dt>
          <dd>{hasConfiguredService ? 'Yes' : 'No'}</dd>
        </div>
        <div className="detail-card">
          <dt>Service status</dt>
          <dd>{readinessState.response?.status ?? '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>Storage</dt>
          <dd>{readinessState.response?.storage ?? '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>FFmpeg</dt>
          <dd>{readinessState.response?.ffmpeg ?? '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>Recording ID</dt>
          <dd className="mono">{candidate?.recordingId ?? '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>Upload ID</dt>
          <dd className="mono">{candidate?.uploadId ?? '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>Upload status</dt>
          <dd>{candidate?.uploadStatus ?? '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>Target</dt>
          <dd>{targetLabel}</dd>
        </div>
        <div className="detail-card">
          <dt>Export status</dt>
          <dd>{getExportStatusSummaryLabel(exportManifest?.status ?? null)}</dd>
        </div>
        <div className="detail-card">
          <dt>Output bytes</dt>
          <dd>{exportManifest?.status === 'ready' && exportManifest.outputBytes !== null ? formatBytes(exportManifest.outputBytes) : '—'}</dd>
        </div>
      </dl>

      {exportError ? (
        <div className="message message--error export-panel__message" role="alert">
          {exportError}
        </div>
      ) : null}

      {exportMessage ? (
        <div className="message export-panel__message" role="status">
          {exportMessage}
        </div>
      ) : null}

      {exportManifest?.status === 'failed' ? (
        <div className="message message--warning export-panel__message" role="status">
          {getExportFailureMessage(exportManifest)}
        </div>
      ) : null}

      <div className="upload-readiness__actions" aria-label="Export actions">
        <button
          className="submit-button signaling-button"
          type="button"
          onClick={() => {
            void handleStartExport();
          }}
          disabled={startDisabled}
        >
          {isSubmitting ? 'Starting export…' : 'Start 1080p export'}
        </button>
        <button
          className="submit-button signaling-button signaling-button--secondary"
          type="button"
          onClick={() => {
            void handleRefreshExportStatus();
          }}
          disabled={refreshDisabled}
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh export status'}
        </button>
        <button
          className="submit-button signaling-button signaling-button--secondary"
          type="button"
          onClick={() => {
            void handleDownloadExport();
          }}
          disabled={downloadDisabled}
        >
          {isDownloading ? 'Downloading…' : 'Download export'}
        </button>
      </div>
    </section>
  );

  async function loadExportStatus(exportId: string): Promise<RecordingExportManifest | null> {
    if (!hasConfiguredService || exportId.trim() === '') {
      return null;
    }

    try {
      return await exportClient.getExport(exportId);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'export_not_found') {
        return null;
      }

      setExportError(getErrorMessage(error, 'Unable to read export status.'));
      return null;
    }
  }

  async function handleRefreshExportStatus(): Promise<void> {
    if (!hasConfiguredService) {
      return;
    }

    setIsRefreshing(true);
    setExportError('');
    setExportMessage('');

    try {
      const exportId = activeExportId ?? getCandidateExportId(candidate?.recordingId ?? null);
      if (exportId === null) {
        setExportManifest(null);
        return;
      }

      const manifest = await loadExportStatus(exportId);
      if (manifest !== null) {
        setExportManifest(manifest);
        setActiveExportId(manifest.exportId);
        savePersistedExportId(manifest.recordingId, manifest.exportId);
        setExportMessage(getExportStatusMessage(manifest));
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleStartExport(): Promise<void> {
    if (!hasConfiguredService || candidate === null) {
      return;
    }

    setIsSubmitting(true);
    setExportError('');
    setExportMessage('');

    try {
      const response = await exportClient.createExport({
        recordingId: candidate.recordingId,
        uploadId: candidate.uploadId,
        sessionId: candidate.sessionId,
        participantId: candidate.participantId,
        role: candidate.role,
        target: {
          format: 'mp4',
          resolution: '1920x1080',
        },
      });

      setExportManifest(response);
      setActiveExportId(response.exportId);
      savePersistedExportId(response.recordingId, response.exportId);
      setExportMessage(getExportStatusMessage(response));
      setExportError('');
    } catch (error) {
      const exportId = getCandidateExportId(candidate.recordingId);
      if (exportId !== null) {
        setActiveExportId(exportId);
        savePersistedExportId(candidate.recordingId, exportId);
      }

      setExportError(getErrorMessage(error, 'Unable to start export.'));

      const manifest = exportId === null ? null : await loadExportStatus(exportId);
      if (manifest !== null) {
        setExportManifest(manifest);
        setExportMessage(getExportStatusMessage(manifest));
        setExportError('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDownloadExport(): Promise<void> {
    if (!hasConfiguredService || !exportReady || activeExportId === null) {
      return;
    }

    setIsDownloading(true);
    setExportError('');

    try {
      window.location.assign(exportClient.getDownloadUrl(activeExportId));
    } catch (error) {
      setExportError(getErrorMessage(error, 'Unable to download export.'));
    } finally {
      setIsDownloading(false);
    }
  }

  function getCandidateExportId(recordingId: string | null): string | null {
    if (recordingId === null || recordingId.trim() === '') {
      return null;
    }

    return `exp-${recordingId.trim()}`;
  }
}

export function isStartExportDisabled(input: {
  hasConfiguredService: boolean;
  hasCandidate: boolean;
  isSubmitting: boolean;
  readinessStatus: ExportReadinessState['status'];
  readinessConfigured: boolean;
  workerReady: boolean;
}): boolean {
  return (
    !input.hasConfiguredService ||
    !input.hasCandidate ||
    input.isSubmitting ||
    !input.workerReady ||
    input.readinessStatus === 'failed' ||
    (input.readinessStatus === 'loading' && input.readinessConfigured)
  );
}

export function getExportFailureMessage(
  manifest: RecordingExportManifest | null,
): string {
  if (manifest === null || manifest.status !== 'failed') {
    return 'Export failed.';
  }

  return manifest.error?.message ?? 'Export failed.';
}

export function getExportStatusMessage(manifest: RecordingExportManifest): string {
  switch (manifest.status) {
    case 'processing':
      return 'Export is processing.';
    case 'ready':
      return 'Export completed and is ready to download.';
    case 'failed':
      return manifest.error?.message ?? 'Export failed.';
    case 'pending':
      return 'Export is pending.';
    default:
      return 'Export status updated.';
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallback;
}
