import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  createIdleLocalMediaDiagnostics,
  describeLocalMediaStream,
  getLocalMediaErrorMessage,
  getLocalMediaStatusLabel,
  requestLocalMediaStream,
  stopMediaStream,
  type LocalMediaDiagnostics,
  type LocalMediaPreviewStatus,
} from '../media/localMedia';

interface LocalMediaPreviewProps {
  onStreamChange?: (stream: MediaStream | null) => void;
}

const idleDiagnostics = createIdleLocalMediaDiagnostics();

export function LocalMediaPreview({ onStreamChange }: LocalMediaPreviewProps) {
  const [status, setStatus] = useState<LocalMediaPreviewStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const isRequestInFlightRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      requestIdRef.current += 1;
      isRequestInFlightRef.current = false;
      stopMediaStream(streamRef.current);
      streamRef.current = null;
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
      onStreamChange?.(nextStream);
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
    onStreamChange?.(null);
    setStatus('idle');
    setErrorMessage('');
  }

  const diagnostics: LocalMediaDiagnostics = stream
    ? describeLocalMediaStream(stream, status, errorMessage)
    : { ...idleDiagnostics, previewStatus: status, errorMessage };

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
        This preview stays local to the browser. When WebRTC starts while it is active,
        its tracks can be attached during the initial negotiation in this release.
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
          <dt>Video track count</dt>
          <dd>{diagnostics.videoTrackCount}</dd>
        </div>
        <div className="detail-card">
          <dt>Audio track count</dt>
          <dd>{diagnostics.audioTrackCount}</dd>
        </div>
        <div className="detail-card">
          <dt>Video track readyState</dt>
          <dd>{diagnostics.videoTrackReadyState}</dd>
        </div>
        <div className="detail-card">
          <dt>Audio track readyState</dt>
          <dd>{diagnostics.audioTrackReadyState}</dd>
        </div>
      </dl>

      {diagnostics.errorMessage ? (
        <div className="message message--error" role="alert">
          {diagnostics.errorMessage}
        </div>
      ) : null}
    </section>
  );
}
