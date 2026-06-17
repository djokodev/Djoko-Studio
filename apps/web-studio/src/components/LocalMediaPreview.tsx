import { useEffect, useReducer, useRef, useState, type MouseEvent } from 'react';
import {
  describeLocalMediaStream,
  getLocalMediaErrorMessage,
  getLocalMediaStatusLabel,
  requestLocalMediaStream,
  setLocalMediaTracksEnabled,
  stopMediaStream,
  type LocalMediaDiagnostics,
  type LocalMediaPreviewStatus,
} from '../media/localMedia';
import {
  getRecordingCapabilityReport,
  type RecordingCapabilityReport,
} from '../recording/recordingCapabilities';
import { getAllowedRecordingEvents, type RecordingEvent } from '../recording/recordingStateMachine';
import {
  type LocalMediaRecorderController,
  useLocalMediaRecorder,
} from '../recording/useLocalMediaRecorder';
import { buildLocalRecordingFilename } from '../recording/recordingDownload';
import { formatBytes } from '../recording/formatBytes';

interface LocalMediaPreviewProps {
  onStreamChange?: (stream: MediaStream | null) => void;
}

export function LocalMediaPreview({ onStreamChange }: LocalMediaPreviewProps) {
  const [status, setStatus] = useState<LocalMediaPreviewStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [, refreshDiagnostics] = useReducer((value: number) => value + 1, 0);
  const recordingCapabilityReport = getRecordingCapabilityReport(stream);
  const localRecording = useLocalMediaRecorder();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onStreamChangeRef = useRef(onStreamChange);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const isRequestInFlightRef = useRef(false);

  useEffect(() => {
    onStreamChangeRef.current = onStreamChange;
  }, [onStreamChange]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      requestIdRef.current += 1;
      isRequestInFlightRef.current = false;
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      notifyStreamChange(null);
    };
  }, []);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (videoElement === null) {
      return;
    }

    videoElement.srcObject = stream;

    if (stream !== null) {
      void videoElement.play().catch(() => {
        // Muted autoplay usually succeeds, but browsers can still reject play().
      });
    }

    return () => {
      if (videoElement.srcObject === stream) {
        videoElement.srcObject = null;
      }
    };
  }, [stream]);

  async function handleStartPreview(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    if (isRequestInFlightRef.current || status === 'requesting' || streamRef.current !== null) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    isRequestInFlightRef.current = true;
    setStatus('requesting');
    setErrorMessage('');

    try {
      const nextStream = await requestLocalMediaStream();

      if (!isMountedRef.current || requestId !== requestIdRef.current) {
        stopMediaStream(nextStream);
        return;
      }

      stopMediaStream(streamRef.current);
      streamRef.current = nextStream;
      setStream(nextStream);
      notifyStreamChange(nextStream);
      setStatus('active');
    } catch (error) {
      if (!isMountedRef.current || requestId !== requestIdRef.current) {
        return;
      }

      stopMediaStream(streamRef.current);
      streamRef.current = null;
      setStream(null);
      setStatus('error');
      setErrorMessage(
        getLocalMediaErrorMessage(error, 'Unable to access camera or microphone.'),
      );
    } finally {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        isRequestInFlightRef.current = false;
      }
    }
  }

  function handleStopPreview(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    requestIdRef.current += 1;
    isRequestInFlightRef.current = false;
    if (localRecording.snapshot.state === 'recording') {
      localRecording.stopRecording();
    }
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    setStream(null);
    notifyStreamChange(null);
    setStatus('idle');
    setErrorMessage('');
  }

  const diagnostics: LocalMediaDiagnostics = describeLocalMediaStream(stream, status, errorMessage);
  const audioTrack = stream?.getAudioTracks()[0] ?? null;
  const videoTrack = stream?.getVideoTracks()[0] ?? null;
  const microphoneToggleDisabled =
    status !== 'active' || audioTrack === null || audioTrack.readyState !== 'live';
  const cameraToggleDisabled =
    status !== 'active' || videoTrack === null || videoTrack.readyState !== 'live';
  const microphoneToggleLabel =
    diagnostics.audioTrackEnabledState === 'muted'
      ? 'Unmute microphone'
      : diagnostics.audioTrackEnabledState === 'enabled'
        ? 'Mute microphone'
        : 'Microphone unavailable';
  const cameraToggleLabel =
    diagnostics.videoTrackEnabledState === 'disabled'
      ? 'Enable camera'
      : diagnostics.videoTrackEnabledState === 'enabled'
        ? 'Disable camera'
        : 'Camera unavailable';

  const startDisabled = status === 'requesting' || status === 'active';
  const stopDisabled = status !== 'requesting' && stream === null;
  const statusLabel = getLocalMediaStatusLabel(diagnostics.previewStatus);

  return (
    <section className="panel media-preview" aria-labelledby="local-media-preview-title">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Local media</p>
          <h2 id="local-media-preview-title">Local camera/microphone preview</h2>
        </div>
        <span
          className={`status-pill media-status-pill media-status-pill--${diagnostics.previewStatus}`}
        >
          {statusLabel}
        </span>
      </div>

      <p className="api-note media-preview__note">
        This preview stays local to the browser. The microphone and camera buttons
        toggle MediaStreamTrack.enabled on the live tracks, so already attached WebRTC
        senders see the change without renegotiation.
      </p>
      <p className="api-note media-preview__note">
        Recording capability diagnostics are read-only. They inspect browser support
        and the current preview stream, but they do not create a recording, prompt for
        permissions, or persist any media.
      </p>

      <div className="media-preview__actions" aria-label="Local media preview actions">
        <button
          className="submit-button signaling-button"
          type="button"
          onClick={handleStartPreview}
          disabled={startDisabled}
        >
          {status === 'requesting' ? 'Requesting preview…' : 'Start preview'}
        </button>
        <button
          className="submit-button signaling-button signaling-button--secondary"
          type="button"
          onClick={handleStopPreview}
          disabled={stopDisabled}
        >
          Stop preview
        </button>
        <button
          className="submit-button signaling-button"
          type="button"
          onClick={handleToggleMicrophone}
          disabled={microphoneToggleDisabled}
        >
          {microphoneToggleLabel}
        </button>
        <button
          className="submit-button signaling-button signaling-button--secondary"
          type="button"
          onClick={handleToggleCamera}
          disabled={cameraToggleDisabled}
        >
          {cameraToggleLabel}
        </button>
      </div>

      <div className="media-preview__stage">
        <video
          ref={videoRef}
          className="media-preview__video"
          muted
          playsInline
          autoPlay
        />
        {diagnostics.hasStream ? null : (
          <div className="media-preview__placeholder">
            Start the preview to see your local camera feed here.
          </div>
        )}
      </div>

      <dl className="details-grid media-preview__details">
        <div className="detail-card">
          <dt>Permission status</dt>
          <dd>{statusLabel}</dd>
        </div>
        <div className="detail-card">
          <dt>Local stream</dt>
          <dd>{diagnostics.hasStream ? 'Yes' : 'No'}</dd>
        </div>
        <div className="detail-card">
          <dt>Microphone track count</dt>
          <dd>{diagnostics.audioTrackCount}</dd>
        </div>
        <div className="detail-card">
          <dt>Camera track count</dt>
          <dd>{diagnostics.videoTrackCount}</dd>
        </div>
        <div className="detail-card">
          <dt>Microphone state</dt>
          <dd>{diagnostics.audioTrackEnabledState}</dd>
        </div>
        <div className="detail-card">
          <dt>Camera state</dt>
          <dd>{diagnostics.videoTrackEnabledState}</dd>
        </div>
        <div className="detail-card">
          <dt>Microphone readyState</dt>
          <dd>{diagnostics.audioTrackReadyState}</dd>
        </div>
        <div className="detail-card">
          <dt>Camera readyState</dt>
          <dd>{diagnostics.videoTrackReadyState}</dd>
        </div>
      </dl>

      <RecordingCapabilityDiagnostics stream={stream} />
      <LocalRecordingPrototype
        stream={stream}
        recordingCapability={recordingCapabilityReport}
        recorder={localRecording}
      />

      {diagnostics.errorMessage ? (
        <div className="message message--error" role="alert">
          {diagnostics.errorMessage}
        </div>
      ) : null}
    </section>
  );

  function notifyStreamChange(nextStream: MediaStream | null) {
    onStreamChangeRef.current?.(nextStream);
  }

  function handleToggleMicrophone() {
    const activeStream = streamRef.current;
    const audioTrack = activeStream?.getAudioTracks()[0];

    if (activeStream === null || audioTrack === undefined || audioTrack.readyState !== 'live') {
      return;
    }

    setLocalMediaTracksEnabled(activeStream, 'audio', !audioTrack.enabled);
    refreshDiagnostics();
  }

  function handleToggleCamera() {
    const activeStream = streamRef.current;
    const videoTrack = activeStream?.getVideoTracks()[0];

    if (activeStream === null || videoTrack === undefined || videoTrack.readyState !== 'live') {
      return;
    }

    setLocalMediaTracksEnabled(activeStream, 'video', !videoTrack.enabled);
    refreshDiagnostics();
  }
}

function RecordingCapabilityDiagnostics({ stream }: { stream: MediaStream | null }) {
  const report = getRecordingCapabilityReport(stream);

  return (
    <section
      className="recording-diagnostics"
      aria-labelledby="recording-capability-diagnostics-title"
    >
      <div className="panel__header">
        <div>
          <p className="eyebrow">Recording diagnostics</p>
          <h3 id="recording-capability-diagnostics-title">Recording capability diagnostics</h3>
        </div>
        <span className="status-pill">
          {report.canAttemptAudioVideoRecording ? 'Prototype-ready' : 'Diagnostics only'}
        </span>
      </div>

      <p className="api-note recording-diagnostics__note">
        This section only inspects browser capability and the active local preview
        stream. No MediaRecorder instance is created here, and the local recording
        prototype below will fall back to the browser default MIME type if no supported
        MIME type is reported.
      </p>

      <dl className="details-grid recording-diagnostics__details">
        <div className="detail-card">
          <dt>MediaRecorder available</dt>
          <dd>{report.mediaRecorderAvailable ? 'Yes' : 'No'}</dd>
        </div>
        <div className="detail-card">
          <dt>isTypeSupported available</dt>
          <dd>{report.isTypeSupportedAvailable ? 'Yes' : 'No'}</dd>
        </div>
        <div className="detail-card">
          <dt>Supported MIME types</dt>
          <dd>{formatMimeTypeList(report.supportedMimeTypes)}</dd>
        </div>
        <div className="detail-card">
          <dt>Preferred MIME type</dt>
          <dd className="mono">{report.preferredMimeType ?? '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>Local stream available</dt>
          <dd>{report.localStreamAvailable ? 'Yes' : 'No'}</dd>
        </div>
        <div className="detail-card">
          <dt>Audio track count</dt>
          <dd>{report.audioTrackCount}</dd>
        </div>
        <div className="detail-card">
          <dt>Video track count</dt>
          <dd>{report.videoTrackCount}</dd>
        </div>
        <div className="detail-card">
          <dt>Future prototype ready</dt>
          <dd>{report.canAttemptAudioVideoRecording ? 'Yes' : 'No'}</dd>
        </div>
      </dl>

      {report.warnings.length > 0 ? (
        <div className="message recording-diagnostics__warnings" role="status">
          <p className="recording-diagnostics__warnings-title">Current notes</p>
          <ul className="recording-diagnostics__warnings-list">
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="message recording-diagnostics__ready" role="status">
          The browser and current preview stream look ready for the local recording
          prototype.
        </div>
      )}
    </section>
  );
}

function LocalRecordingPrototype({
  stream,
  recordingCapability,
  recorder,
}: {
  stream: MediaStream | null;
  recordingCapability: RecordingCapabilityReport;
  recorder: LocalMediaRecorderController;
}) {
  const [discardingRecordingId, setDiscardingRecordingId] = useState<string | null>(null);
  const allowedEvents = getAllowedRecordingEvents(recorder.snapshot.state);
  const summary = recorder.summary;
  const recoveredPreview = recorder.recoveredPreview;
  const recoveredRecording =
    recoveredPreview.recordingId === null
      ? null
      : recorder.persistedRecordings.find(
          (record) => record.recordingId === recoveredPreview.recordingId,
        ) ?? null;
  const currentRecordingDownloadFilename = buildLocalRecordingFilename({
    recordingId: summary.recordingId,
    startedAt: summary.startedAt,
    mimeType: recorder.previewMimeType ?? summary.selectedMimeType,
  });
  const recoveredPreviewDownloadFilename = buildLocalRecordingFilename({
    recordingId: recoveredPreview.recordingId,
    startedAt: recoveredRecording?.manifest.startedAt ?? null,
    mimeType:
      recoveredPreview.previewMimeType ?? recoveredRecording?.manifest.selectedMimeType ?? null,
  });
  const hasLocalPreviewStream = stream !== null;
  const hasAudioAndVideoTracks =
    recordingCapability.audioTrackCount > 0 && recordingCapability.videoTrackCount > 0;
  const startDisabled =
    recorder.snapshot.state !== 'idle' ||
    !recordingCapability.mediaRecorderAvailable ||
    !hasLocalPreviewStream ||
    !hasAudioAndVideoTracks;
  const stopDisabled = recorder.snapshot.state !== 'recording';
  const resetDisabled =
    recorder.snapshot.state !== 'stopped' && recorder.snapshot.state !== 'failed';
  const recoveredPreviewStatusLabel = formatRecoveredPreviewStatusLabel(recoveredPreview.status);

  return (
    <section
      className="recording-prototype"
      aria-labelledby="local-recording-prototype-title"
    >
      <div className="panel__header">
        <div>
          <p className="eyebrow">Recording prototype</p>
          <h3 id="local-recording-prototype-title">Local recording prototype</h3>
        </div>
        <span
          className={`status-pill recording-prototype__status recording-prototype__status--${summary.status}`}
        >
          {formatRecordingStateLabel(summary.status)}
        </span>
      </div>

      <p className="api-note recording-prototype__note">
        Prototype only: the recorder keeps the playback preview in memory, while
        IndexedDB persistence stores the manifest and chunks locally when the browser
        supports it. The recovery panel can now preview a persisted local copy from
        IndexedDB after refresh. The recorder prefers the supported MIME type from the
        diagnostics and falls back to the browser default when needed.
      </p>

      <div className="recording-prototype__actions" aria-label="Local recording prototype actions">
        <button
          className="submit-button signaling-button"
          type="button"
          onClick={() =>
            recorder.startRecording(stream, recordingCapability.preferredMimeType)
          }
          disabled={startDisabled}
        >
          {recorder.snapshot.state === 'preparing'
            ? 'Starting local recording…'
            : 'Start local recording'}
        </button>
        <button
          className="submit-button signaling-button signaling-button--secondary"
          type="button"
          onClick={recorder.stopRecording}
          disabled={stopDisabled}
        >
          {recorder.snapshot.state === 'stopping'
            ? 'Stopping local recording…'
            : 'Stop local recording'}
        </button>
        <button
          className="submit-button signaling-button signaling-button--secondary"
          type="button"
          onClick={recorder.resetRecording}
          disabled={resetDisabled}
        >
          Discard local recording / Reset
        </button>
      </div>

      <dl className="details-grid recording-prototype__details">
        <div className="detail-card">
          <dt>Recording ID</dt>
          <dd className="mono">{formatNullableText(summary.recordingId)}</dd>
        </div>
        <div className="detail-card">
          <dt>Manifest status</dt>
          <dd className="mono">{formatRecordingStateLabel(summary.status)}</dd>
        </div>
        <div className="detail-card">
          <dt>Source kind</dt>
          <dd className="mono">{formatNullableText(summary.sourceKind)}</dd>
        </div>
        <div className="detail-card">
          <dt>Selected MIME type</dt>
          <dd className="mono">{formatNullableText(summary.selectedMimeType)}</dd>
        </div>
        <div className="detail-card">
          <dt>Started at</dt>
          <dd>{formatDiagnosticTimestamp(summary.startedAt)}</dd>
        </div>
        <div className="detail-card">
          <dt>Stopped at</dt>
          <dd>{formatDiagnosticTimestamp(summary.stoppedAt)}</dd>
        </div>
        <div className="detail-card">
          <dt>Approximate duration</dt>
          <dd>{formatApproximateDuration(summary.approximateDurationMs)}</dd>
        </div>
        <div className="detail-card">
          <dt>Manifest chunk count</dt>
          <dd>{summary.chunkCount}</dd>
        </div>
        <div className="detail-card">
          <dt>Manifest total bytes</dt>
          <dd>{formatByteCount(summary.totalBytes)}</dd>
        </div>
        <div className="detail-card">
          <dt>Latest chunk index</dt>
          <dd>{formatNullableNumber(summary.latestChunkIndex)}</dd>
        </div>
        <div className="detail-card">
          <dt>Latest chunk size</dt>
          <dd>{formatNullableByteCount(summary.latestChunkSizeBytes)}</dd>
        </div>
        <div className="detail-card">
          <dt>Latest chunk timestamp</dt>
          <dd>{formatDiagnosticTimestamp(summary.latestChunkAt)}</dd>
        </div>
        <div className="detail-card">
          <dt>Preview available</dt>
          <dd>{summary.previewAvailable ? 'Yes' : 'No'}</dd>
        </div>
        <div className="detail-card">
          <dt>Preview blob size</dt>
          <dd>{summary.previewAvailable ? formatByteCount(summary.previewBlobSizeBytes) : '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>Persistence support</dt>
          <dd className="mono">{formatPersistenceSupportLabel(recorder.persistenceSupportStatus)}</dd>
        </div>
        <div className="detail-card">
          <dt>Persistence status</dt>
          <dd className="mono">{formatPersistenceStatusLabel(summary.persistenceStatus)}</dd>
        </div>
        <div className="detail-card">
          <dt>Persistence error</dt>
          <dd>{recorder.persistenceErrorMessage ?? '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>Persisted recordings detected</dt>
          <dd>{summary.persistedRecordingCount}</dd>
        </div>
        <div className="detail-card">
          <dt>Current recording persisted</dt>
          <dd>{summary.currentRecordingPersisted ? 'Yes' : 'No'}</dd>
        </div>
        <div className="detail-card">
          <dt>Recording error</dt>
          <dd>{recorder.snapshot.errorMessage ?? '—'}</dd>
        </div>
        <div className="detail-card">
          <dt>Upload status</dt>
          <dd className="mono">{summary.uploadStatus}</dd>
        </div>
        <div className="detail-card">
          <dt>Available next actions</dt>
          <dd className="mono">{formatRecordingEventList(allowedEvents)}</dd>
        </div>
      </dl>

      <LocalBrowserStoragePanel recorder={recorder} />

      <section
        className="recording-prototype__preview"
        aria-labelledby="local-recording-playback-preview-title"
      >
        <div className="panel__header">
          <div>
            <p className="eyebrow">Playback preview</p>
            <h4 id="local-recording-playback-preview-title">
              Local recording playback preview
            </h4>
          </div>
          <span
            className={`status-pill ${summary.previewAvailable ? 'status-pill--live' : ''}`}
          >
            {summary.previewAvailable ? 'Available' : 'Unavailable'}
          </span>
        </div>

        {summary.previewAvailable && recorder.previewUrl !== null ? (
          <>
            <div className="media-preview__stage recording-prototype__preview-stage">
              <video
                className="media-preview__video recording-prototype__preview-video"
                controls
                playsInline
                src={recorder.previewUrl}
              />
            </div>
            <div className="recording-prototype__download">
              <a
                className="submit-button signaling-button recording-prototype__download-link"
                href={recorder.previewUrl}
                download={currentRecordingDownloadFilename}
              >
                Download raw local copy
              </a>
              <p className="api-note recording-prototype__download-note">
                This is the raw browser recording, not the final exported interview.
              </p>
            </div>
          </>
        ) : (
          <div className="message recording-prototype__preview-empty" role="status">
            No local recording preview available yet.
          </div>
        )}

        <dl className="details-grid recording-prototype__preview-details">
          <div className="detail-card">
            <dt>Preview available</dt>
            <dd>{summary.previewAvailable ? 'Yes' : 'No'}</dd>
          </div>
          <div className="detail-card">
            <dt>Preview blob size</dt>
            <dd>
              {summary.previewAvailable
                ? formatByteCount(summary.previewBlobSizeBytes)
                : '—'}
            </dd>
          </div>
          <div className="detail-card">
            <dt>Preview MIME type</dt>
            <dd className="mono">{recorder.previewMimeType ?? '—'}</dd>
          </div>
          <div className="detail-card">
            <dt>Object URL exists</dt>
            <dd>{recorder.previewUrl !== null ? 'Yes' : 'No'}</dd>
          </div>
        </dl>

        <div className="message message--warning recording-prototype__preview-warning" role="status">
          Temporary local preview only. The persisted copy is listed below for discard
          and recovered playback from IndexedDB is available in the recovery panel.
        </div>
      </section>

      <section
        className="recording-recovery"
        aria-labelledby="local-recording-recovery-title"
      >
        <div className="panel__header">
          <div>
            <p className="eyebrow">Recovery</p>
            <h4 id="local-recording-recovery-title">Local recording found in this browser</h4>
          </div>
          <span
            className={`status-pill ${
              recorder.persistedRecordings.length > 0 ? 'status-pill--live' : ''
            }`}
          >
            {recorder.persistedRecordings.length > 0 ? 'Detected' : 'None'}
          </span>
        </div>

        <p className="api-note recording-recovery__note">
          Local recording recovery stays browser-only. The app can detect persisted
          recordings in IndexedDB after refresh, preview a local copy from browser
          storage, and discard the local copy. Upload/recovery sync is not implemented
          yet.
        </p>

        <article className="recording-recovery__preview">
          <div className="panel__header recording-recovery__preview-header">
            <div>
              <p className="eyebrow">Recovered playback</p>
              <h5 className="recording-recovery__preview-title">
                Recovered local browser copy
              </h5>
            </div>
            <span
              className={`status-pill recording-recovery__preview-status recording-recovery__preview-status--${recoveredPreview.status}`}
            >
              {recoveredPreviewStatusLabel}
            </span>
          </div>

          <p className="api-note recording-recovery__preview-note">
            Recovered playback is read from local browser storage only. It is labeled
            here as a browser copy so it is easy to distinguish from the live in-memory
            playback preview.
          </p>

          {recoveredPreview.status === 'idle' ? (
            <div className="message recording-recovery__empty" role="status">
              Choose Preview local copy on a persisted recording to load the recovered
              browser copy here.
            </div>
          ) : null}

          {recoveredPreview.status === 'loading' ? (
            <div className="message" role="status">
              Loading recovered local copy…
            </div>
          ) : null}

          {recoveredPreview.status === 'failed' ? (
            <div className="message message--error" role="alert">
              {recoveredPreview.errorMessage ??
                'Unable to recover the persisted local recording preview.'}
            </div>
          ) : null}

          {recoveredPreview.status === 'ready' && recoveredPreview.previewUrl !== null ? (
            <>
              <div className="media-preview__stage recording-recovery__preview-stage">
                <video
                  className="media-preview__video recording-recovery__preview-video"
                  controls
                  playsInline
                  src={recoveredPreview.previewUrl}
                />
              </div>
              <div className="recording-recovery__download">
                <a
                  className="submit-button signaling-button recording-recovery__download-link"
                  href={recoveredPreview.previewUrl}
                  download={recoveredPreviewDownloadFilename}
                >
                  Download raw local copy
                </a>
                <p className="api-note recording-recovery__download-note">
                  This raw browser recording comes from browser local storage only. It is
                  not the final exported interview, and no upload is performed.
                </p>
              </div>
            </>
          ) : null}

          <dl className="details-grid recording-recovery__preview-details">
            <div className="detail-card">
              <dt>Recording ID</dt>
              <dd className="mono">{formatNullableText(recoveredPreview.recordingId)}</dd>
            </div>
            <div className="detail-card">
              <dt>Browser storage status</dt>
              <dd className="mono">{recoveredPreviewStatusLabel}</dd>
            </div>
            <div className="detail-card">
              <dt>Source kind</dt>
              <dd className="mono">
                {formatNullableText(recoveredRecording?.manifest.sourceKind ?? null)}
              </dd>
            </div>
            <div className="detail-card">
              <dt>Selected MIME type</dt>
              <dd className="mono">
                {formatNullableText(recoveredRecording?.manifest.selectedMimeType ?? null)}
              </dd>
            </div>
            <div className="detail-card">
              <dt>Preview MIME type</dt>
              <dd className="mono">{formatNullableText(recoveredPreview.previewMimeType)}</dd>
            </div>
            <div className="detail-card">
              <dt>Preview blob size</dt>
              <dd>
                {recoveredPreview.previewAvailable
                  ? formatByteCount(recoveredPreview.previewBlobSizeBytes)
                  : '—'}
              </dd>
            </div>
            <div className="detail-card">
              <dt>Started at</dt>
              <dd>{formatDiagnosticTimestamp(recoveredRecording?.manifest.startedAt ?? null)}</dd>
            </div>
            <div className="detail-card">
              <dt>Stopped at</dt>
              <dd>{formatDiagnosticTimestamp(recoveredRecording?.manifest.stoppedAt ?? null)}</dd>
            </div>
            <div className="detail-card">
              <dt>Chunk count</dt>
              <dd>{recoveredRecording?.manifest.chunkCount ?? '—'}</dd>
            </div>
            <div className="detail-card">
              <dt>Total bytes</dt>
              <dd>
                {recoveredRecording?.manifest.totalBytes !== undefined
                  ? formatByteCount(recoveredRecording.manifest.totalBytes)
                  : '—'}
              </dd>
            </div>
            <div className="detail-card">
              <dt>Approximate duration</dt>
              <dd>
                {recoveredRecording?.manifest.approximateDurationMs !== undefined
                  ? formatApproximateDuration(recoveredRecording.manifest.approximateDurationMs)
                  : '—'}
              </dd>
            </div>
            <div className="detail-card">
              <dt>Recovery note</dt>
              <dd>Recovered from local browser storage only.</dd>
            </div>
          </dl>
        </article>

        {recorder.persistedRecordings.length > 0 ? (
          <div className="recording-recovery__list">
            {recorder.persistedRecordings.map((record) => {
              const isPreviewLoadingForRecord =
                recoveredPreview.status === 'loading' &&
                recoveredPreview.recordingId === record.recordingId;
              const isCurrentRecoveredRecording =
                recoveredPreview.recordingId === record.recordingId &&
                recoveredPreview.status !== 'idle';

              return (
                <article className="recording-recovery__item" key={record.recordingId}>
                  <div className="panel__header recording-recovery__item-header">
                    <div>
                      <p className="eyebrow">Persisted recording</p>
                      <h5 className="recording-recovery__item-title">{record.recordingId}</h5>
                    </div>
                    <div className="recording-recovery__item-actions">
                      <button
                        className="submit-button signaling-button recording-recovery__preview-button"
                        type="button"
                        onClick={() => handlePreviewPersistedRecording(record.recordingId)}
                        disabled={recoveredPreview.status === 'loading'}
                      >
                        {isPreviewLoadingForRecord
                          ? 'Previewing…'
                          : isCurrentRecoveredRecording && recoveredPreview.status === 'ready'
                            ? 'Preview local copy'
                            : 'Preview local copy'}
                      </button>
                      <button
                        className="submit-button signaling-button signaling-button--secondary recording-recovery__discard"
                        type="button"
                        onClick={() => handleDiscardPersistedRecording(record.recordingId)}
                        disabled={discardingRecordingId === record.recordingId}
                      >
                        {discardingRecordingId === record.recordingId
                          ? 'Discarding…'
                          : 'Discard local copy'}
                      </button>
                    </div>
                  </div>

                  <dl className="details-grid recording-recovery__details">
                    <div className="detail-card">
                      <dt>Status</dt>
                      <dd className="mono">{formatRecordingStateLabel(record.manifest.status)}</dd>
                    </div>
                    <div className="detail-card">
                      <dt>Source kind</dt>
                      <dd className="mono">{formatNullableText(record.manifest.sourceKind)}</dd>
                    </div>
                    <div className="detail-card">
                      <dt>Selected MIME type</dt>
                      <dd className="mono">{formatNullableText(record.manifest.selectedMimeType)}</dd>
                    </div>
                    <div className="detail-card">
                      <dt>Started at</dt>
                      <dd>{formatDiagnosticTimestamp(record.manifest.startedAt)}</dd>
                    </div>
                    <div className="detail-card">
                      <dt>Stopped at</dt>
                      <dd>{formatDiagnosticTimestamp(record.manifest.stoppedAt)}</dd>
                    </div>
                    <div className="detail-card">
                      <dt>Chunk count</dt>
                      <dd>{record.manifest.chunkCount}</dd>
                    </div>
                    <div className="detail-card">
                      <dt>Total bytes</dt>
                      <dd>{formatByteCount(record.manifest.totalBytes)}</dd>
                    </div>
                    <div className="detail-card">
                      <dt>Approximate duration</dt>
                      <dd>{formatApproximateDuration(record.manifest.approximateDurationMs)}</dd>
                    </div>
                    <div className="detail-card">
                      <dt>First persisted at</dt>
                      <dd>{formatDiagnosticTimestamp(record.firstPersistedAt)}</dd>
                    </div>
                    <div className="detail-card">
                      <dt>Last persisted at</dt>
                      <dd>{formatDiagnosticTimestamp(record.lastPersistedAt)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="message recording-recovery__empty" role="status">
            No persisted local recordings were detected in this browser.
          </div>
        )}
      </section>

      <div className="message message--warning recording-prototype__warning" role="status">
        Prototype only: the in-memory playback preview stays separate from the recovered
        browser copy. IndexedDB keeps a local manifest/chunk copy for recovery
        detection and local preview when available.
      </div>
    </section>
  );

  async function handleDiscardPersistedRecording(recordingId: string) {
    if (discardingRecordingId !== null) {
      return;
    }

    setDiscardingRecordingId(recordingId);

    try {
      await recorder.discardPersistedRecording(recordingId);
    } finally {
      setDiscardingRecordingId((currentRecordingId) =>
        currentRecordingId === recordingId ? null : currentRecordingId,
      );
    }
  }

  async function handlePreviewPersistedRecording(recordingId: string) {
    await recorder.loadRecoveredPreview(recordingId);
  }
}

function LocalBrowserStoragePanel({
  recorder,
}: {
  recorder: LocalMediaRecorderController;
}) {
  const storageSummary = recorder.localStorageSummary;
  const browserStorageEstimate = recorder.browserStorageEstimate;
  const summaryReady = recorder.storageSummaryStatus === 'ready';
  const hasPersistedRecordings = (storageSummary?.persistedRecordingCount ?? 0) > 0;
  const clearAllDisabled =
    recorder.storageSummaryStatus === 'loading' ||
    !summaryReady ||
    storageSummary?.supportStatus !== 'supported' ||
    !hasPersistedRecordings;
  const refreshButtonLabel =
    recorder.storageSummaryStatus === 'loading'
      ? 'Refreshing storage summary…'
      : 'Refresh storage summary';
  const clearAllButtonLabel =
    recorder.storageSummaryStatus === 'loading'
      ? 'Clearing local recordings…'
      : 'Clear all local recordings';
  const storageStatusLabel = formatStorageSummaryStatusLabel(recorder.storageSummaryStatus);
  const persistenceSupportLabel =
    storageSummary === null
      ? 'Not checked'
      : formatPersistenceSupportLabel(storageSummary.supportStatus);
  const browserStorageStateLabel =
    browserStorageEstimate === null
      ? 'Not checked'
      : formatBrowserStorageEstimateStateLabel(browserStorageEstimate.state);
  const browserUsageLabel =
    browserStorageEstimate?.state === 'available' &&
    browserStorageEstimate.usageBytes !== null
      ? formatBytes(browserStorageEstimate.usageBytes)
      : browserStorageEstimate === null
        ? 'Not checked'
        : 'Unavailable';
  const browserQuotaLabel =
    browserStorageEstimate?.state === 'available' &&
    browserStorageEstimate.quotaBytes !== null
      ? formatBytes(browserStorageEstimate.quotaBytes)
      : browserStorageEstimate === null
        ? 'Not checked'
        : 'Unavailable';

  return (
    <section
      className="recording-storage"
      aria-labelledby="local-browser-storage-title"
    >
      <div className="panel__header">
        <div>
          <p className="eyebrow">Storage</p>
          <h4 id="local-browser-storage-title">Local browser storage</h4>
        </div>
        <span
          className={`status-pill ${
            summaryReady && storageSummary?.supportStatus === 'supported' ? 'status-pill--live' : ''
          }`}
        >
          {storageStatusLabel}
        </span>
      </div>

      <p className="api-note recording-storage__note">
        Stored only in this browser. No upload has been performed. Approximate size is
        based on persisted manifest and chunk metadata, so it can help you understand
        local browser usage without doing a full storage scan.
      </p>

      <div className="recording-storage__actions" aria-label="Local browser storage actions">
        <button
          className="submit-button signaling-button"
          type="button"
          onClick={() => {
            void recorder.refreshLocalStorageSummary();
          }}
          disabled={recorder.storageSummaryStatus === 'loading'}
        >
          {refreshButtonLabel}
        </button>
        <button
          className="submit-button signaling-button signaling-button--secondary"
          type="button"
          onClick={() => {
            const confirmed = window.confirm(
              'Clear all local recordings stored in this browser? This cannot be undone. This does not affect any cloud copy because upload is not implemented yet.',
            );

            if (!confirmed) {
              return;
            }

            void recorder.clearAllPersistedLocalRecordings();
          }}
          disabled={clearAllDisabled}
        >
          {clearAllButtonLabel}
        </button>
      </div>

      <dl className="details-grid recording-storage__details">
        <div className="detail-card">
          <dt>Persistence support</dt>
          <dd className="mono">{persistenceSupportLabel}</dd>
        </div>
        <div className="detail-card">
          <dt>Persisted local recordings</dt>
          <dd>{storageSummary?.persistedRecordingCount ?? 0}</dd>
        </div>
        <div className="detail-card">
          <dt>Approximate size</dt>
          <dd>{formatBytes(storageSummary?.totalPersistedBytes ?? 0)}</dd>
        </div>
        <div className="detail-card">
          <dt>Persisted chunks</dt>
          <dd>{storageSummary?.totalPersistedChunks ?? 0}</dd>
        </div>
        <div className="detail-card">
          <dt>Browser estimate</dt>
          <dd className="mono">{browserStorageStateLabel}</dd>
        </div>
        <div className="detail-card">
          <dt>Browser usage</dt>
          <dd>{browserUsageLabel}</dd>
        </div>
        <div className="detail-card">
          <dt>Browser quota</dt>
          <dd>{browserQuotaLabel}</dd>
        </div>
        <div className="detail-card">
          <dt>Latest recording ID</dt>
          <dd className="mono">{formatNullableText(storageSummary?.latestRecordingId ?? null)}</dd>
        </div>
        <div className="detail-card">
          <dt>Latest started at</dt>
          <dd>{formatDiagnosticTimestamp(storageSummary?.latestRecordingStartedAt ?? null)}</dd>
        </div>
        <div className="detail-card">
          <dt>Latest persisted at</dt>
          <dd>{formatDiagnosticTimestamp(storageSummary?.latestPersistedAt ?? null)}</dd>
        </div>
      </dl>

      {recorder.storageSummaryError ? (
        <div className="message message--error" role="alert">
          {recorder.storageSummaryError}
        </div>
      ) : browserStorageEstimate?.state === 'failed' &&
        browserStorageEstimate.errorMessage !== null ? (
        <div className="message message--warning" role="status">
          {browserStorageEstimate.errorMessage}
        </div>
      ) : null}
    </section>
  );
}

function formatMimeTypeList(mimeTypes: RecordingCapabilityReport['supportedMimeTypes']): string {
  if (mimeTypes.length === 0) {
    return '—';
  }

  return mimeTypes.join(', ');
}

function formatNullableText(value: string | null): string {
  return value ?? '—';
}

function formatNullableNumber(value: number | null): string {
  return value === null ? '—' : String(value);
}

function formatNullableByteCount(value: number | null): string {
  return value === null ? '—' : formatByteCount(value);
}

function formatRecordingEventList(events: RecordingEvent[]): string {
  if (events.length === 0) {
    return '—';
  }

  return events.join(', ');
}

function formatRecordingStateLabel(state: LocalMediaRecorderController['snapshot']['state']): string {
  switch (state) {
    case 'idle':
      return 'Idle';
    case 'preparing':
      return 'Preparing';
    case 'recording':
      return 'Recording';
    case 'stopping':
      return 'Stopping';
    case 'stopped':
      return 'Stopped';
    case 'failed':
      return 'Failed';
  }
}

function formatPersistenceSupportLabel(
  status: LocalMediaRecorderController['persistenceSupportStatus'],
): string {
  switch (status) {
    case 'not_checked':
      return 'Not checked';
    case 'supported':
      return 'Supported';
    case 'unavailable':
      return 'Unavailable';
    case 'failed':
      return 'Failed';
  }
}

function formatPersistenceStatusLabel(
  status: LocalMediaRecorderController['summary']['persistenceStatus'],
): string {
  switch (status) {
    case 'not_checked':
      return 'Not checked';
    case 'unsupported':
      return 'Unsupported';
    case 'available':
      return 'Available';
    case 'persisting':
      return 'Persisting';
    case 'persisted':
      return 'Persisted';
    case 'failed':
      return 'Failed';
  }
}

function formatStorageSummaryStatusLabel(
  status: LocalMediaRecorderController['storageSummaryStatus'],
): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'loading':
      return 'Loading';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
  }
}

function formatBrowserStorageEstimateStateLabel(
  state: NonNullable<LocalMediaRecorderController['browserStorageEstimate']>['state'],
): string {
  switch (state) {
    case 'available':
      return 'Available';
    case 'unavailable':
      return 'Unavailable';
    case 'failed':
      return 'Failed';
  }
}

function formatRecoveredPreviewStatusLabel(
  status: 'idle' | 'loading' | 'ready' | 'failed',
): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'loading':
      return 'Loading';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
  }
}

function formatDiagnosticTimestamp(epochMilliseconds: number | null): string {
  if (epochMilliseconds === null) {
    return '—';
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(epochMilliseconds);
}

function formatByteCount(byteCount: number): string {
  return formatBytes(byteCount);
}

function formatApproximateDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return '—';
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (hours > 0 || minutes > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${String(seconds).padStart(2, '0')}s`);

  return parts.join(' ');
}
