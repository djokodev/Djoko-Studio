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
import {
  createInitialRecordingSnapshot,
  getAllowedRecordingEvents,
  type RecordingEvent,
} from '../recording/recordingStateMachine';

interface LocalMediaPreviewProps {
  onStreamChange?: (stream: MediaStream | null) => void;
}

export function LocalMediaPreview({ onStreamChange }: LocalMediaPreviewProps) {
  const [status, setStatus] = useState<LocalMediaPreviewStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [, refreshDiagnostics] = useReducer((value: number) => value + 1, 0);
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
      <RecordingStateMachineDiagnostics />

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
        stream. No MediaRecorder instance is created here.
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
          The browser and current preview stream look ready for a future local recording
          prototype.
        </div>
      )}
    </section>
  );
}

function RecordingStateMachineDiagnostics() {
  const snapshot = createInitialRecordingSnapshot();
  const allowedEvents = getAllowedRecordingEvents(snapshot.state);

  return (
    <section
      className="recording-diagnostics"
      aria-labelledby="recording-state-machine-diagnostics-title"
    >
      <div className="panel__header">
        <div>
          <p className="eyebrow">Recording lifecycle</p>
          <h3 id="recording-state-machine-diagnostics-title">
            Recording state machine diagnostics
          </h3>
        </div>
        <span className="status-pill">Read only</span>
      </div>

      <p className="api-note recording-diagnostics__note">
        This pure helper models the future local recording lifecycle. Recording is not
        implemented yet, and the diagnostics do not create MediaRecorder instances,
        chunks, or files.
      </p>

      <dl className="details-grid recording-diagnostics__details">
        <div className="detail-card">
          <dt>Initial state</dt>
          <dd className="mono">{snapshot.state}</dd>
        </div>
        <div className="detail-card">
          <dt>Available next actions</dt>
          <dd className="mono">{formatRecordingEventList(allowedEvents)}</dd>
        </div>
      </dl>
    </section>
  );
}

function formatMimeTypeList(mimeTypes: RecordingCapabilityReport['supportedMimeTypes']): string {
  if (mimeTypes.length === 0) {
    return '—';
  }

  return mimeTypes.join(', ');
}

function formatRecordingEventList(events: RecordingEvent[]): string {
  if (events.length === 0) {
    return '—';
  }

  return events.join(', ');
}
