import { useEffect, useRef, useState } from 'react';
import {
  buildSignalingRoomUrl,
  connectToSignalingRoom,
  type SignalingConnection,
  type SignalingIncomingMessage,
  type SignalingRole,
} from '../signaling/client';
import {
  createWebRtcPeerConnection,
  rtcIceServersConfig,
  type WebRtcPeerConnectionController,
  type WebRtcPeerConnectionEvent,
  type WebRtcPeerConnectionState,
  type WebRtcSignalPayload,
} from '../webrtc/peerConnection';

type SignalingStatus = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'error';

type PanelLogKind = 'open' | 'message' | 'signal' | 'error' | 'close' | 'state' | 'data' | 'info';

type PanelLogEntry = {
  id: string;
  kind: PanelLogKind;
  summary: string;
  details?: string;
  at: string;
};

interface SignalingPanelProps {
  heading: string;
  sessionId: string | null | undefined;
  participantId: string | null | undefined;
  role: SignalingRole;
}

const statusLabels: Record<SignalingStatus, string> = {
  idle: 'Ready',
  connecting: 'Connecting',
  open: 'Connected',
  closing: 'Disconnecting',
  closed: 'Closed',
  error: 'Connection error',
};

const maxLogEntries = 10;

const idleWebRtcState: WebRtcPeerConnectionState = {
  connectionState: 'not-created',
  iceConnectionState: 'not-created',
  signalingState: 'not-created',
  dataChannelState: 'none',
  peerConnectionCreated: false,
  localDescriptionState: 'not-set',
  remoteDescriptionState: 'not-set',
};

export function SignalingPanel({ heading, sessionId, participantId, role }: SignalingPanelProps) {
  const [status, setStatus] = useState<SignalingStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [webRtcMessage, setWebRtcMessage] = useState('');
  const [webRtcMessageKind, setWebRtcMessageKind] = useState<'info' | 'error'>('info');
  const [webRtcState, setWebRtcState] = useState<WebRtcPeerConnectionState>(idleWebRtcState);
  const [events, setEvents] = useState<PanelLogEntry[]>([]);
  const [hasWebRtcController, setHasWebRtcController] = useState(false);
  const connectionRef = useRef<SignalingConnection | null>(null);
  const peerConnectionRef = useRef<WebRtcPeerConnectionController | null>(null);
  const isMountedRef = useRef(true);
  const disconnectCauseRef = useRef<'user' | 'system'>('system');

  const trimmedSessionId = sessionId?.trim() ?? '';
  const trimmedParticipantId = participantId?.trim() ?? '';

  let roomUrl = '';
  let roomError = '';
  try {
    roomUrl = buildSignalingRoomUrl({
      sessionId: trimmedSessionId,
      participantId: trimmedParticipantId,
      role,
    });
  } catch (error) {
    roomError = getErrorMessage(error, 'Unable to build signaling room URL.');
  }

  useEffect(() => {
    isMountedRef.current = true;

    if (rtcIceServersConfig.error) {
      setWebRtcMessageKind('error');
      setWebRtcMessage(rtcIceServersConfig.error);
      appendLog('error', 'WebRTC ICE server configuration error.', rtcIceServersConfig.error);
    }

    return () => {
      isMountedRef.current = false;
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
      connectionRef.current?.close();
      connectionRef.current = null;
    };
  }, []);

  useEffect(() => {
    closeWebRtcPeerConnection();
    connectionRef.current?.close();
    connectionRef.current = null;
    disconnectCauseRef.current = 'system';
    setStatus('idle');
    setStatusMessage('');
    setWebRtcMessage('');
    setWebRtcMessageKind('info');
    setWebRtcState(idleWebRtcState);
    setHasWebRtcController(false);
    setEvents([]);
  }, [trimmedSessionId, trimmedParticipantId, role]);

  function appendLog(kind: PanelLogKind, summary: string, details?: string) {
    if (!isMountedRef.current) {
      return;
    }

    const entry: PanelLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      summary,
      details,
      at: formatLogTime(new Date()),
    };

    setEvents((current) => [...current, entry].slice(-maxLogEntries));
  }

  function setConnectionError(message: string) {
    if (!isMountedRef.current) {
      return;
    }

    setStatus('error');
    setStatusMessage(message);
    appendLog('error', message);
  }

  function setWebRtcBanner(message: string, kind: 'info' | 'error' = 'info') {
    if (!isMountedRef.current) {
      return;
    }

    setWebRtcMessage(message);
    setWebRtcMessageKind(kind);
  }

  function sendWebRtcSignal(payload: WebRtcSignalPayload) {
    const connection = connectionRef.current;
    if (connection === null) {
      throw new Error('Connect signaling first.');
    }

    connection.sendSignal(payload);
  }

  function ensureWebRtcController() {
    const existingController = peerConnectionRef.current;
    if (existingController !== null) {
      return existingController;
    }

    const controller = createWebRtcPeerConnection({
      role,
      iceServers: rtcIceServersConfig.iceServers,
      sendSignal: sendWebRtcSignal,
      onStateChange: (state) => {
        if (!isMountedRef.current) {
          return;
        }

        setWebRtcState(state);
      },
      onEvent: (event: WebRtcPeerConnectionEvent) => {
        if (!isMountedRef.current) {
          return;
        }

        appendLog(event.kind, event.summary, event.details);
      },
    });

    peerConnectionRef.current = controller;
    setHasWebRtcController(true);
    setWebRtcState(controller.state);

    return controller;
  }

  function closeWebRtcPeerConnection() {
    const controller = peerConnectionRef.current;
    if (controller === null) {
      return;
    }

    controller.close();
    peerConnectionRef.current = null;
    setHasWebRtcController(false);
  }

  async function handleWebRtcPayload(payload: WebRtcSignalPayload) {
    if (roomError) {
      setWebRtcBanner(roomError, 'error');
      appendLog('error', roomError);
      return;
    }

    try {
      const controller = ensureWebRtcController();
      await controller.handleSignal(payload);

      if (payload.kind === 'webrtc-offer') {
        setWebRtcBanner('Guest accepted the host offer and sent an answer.');
        return;
      }

      if (payload.kind === 'webrtc-answer') {
        setWebRtcBanner('Host accepted the guest answer and is waiting for ICE connectivity.');
        return;
      }

      setWebRtcBanner('Remote ICE candidate applied.');
    } catch (error) {
      setWebRtcBanner(getErrorMessage(error, 'Unable to process WebRTC signaling payload.'), 'error');
      appendLog('error', getErrorMessage(error, 'Unable to process WebRTC signaling payload.'));
    }
  }

  function handleIncomingMessage(message: SignalingIncomingMessage) {
    if (message.type === 'signal') {
      appendLog(
        'message',
        `Signal from ${message.from.participant_id} (${message.from.role}).`,
        `payload=${stringifyValue(message.payload)}`,
      );

      if (isWebRtcSignalPayload(message.payload)) {
        void handleWebRtcPayload(message.payload);
      }

      return;
    }

    if (message.type === 'error') {
      appendLog('error', message.error.message, `code=${message.error.code}`);
      return;
    }

    appendLog('error', message.message, `raw=${stringifyValue(message.raw)}`);
  }

  function handleConnect() {
    if (roomError) {
      setConnectionError(roomError);
      return;
    }

    if (connectionRef.current !== null && connectionRef.current.readyState !== WebSocket.CLOSED) {
      setConnectionError('A signaling connection is already active.');
      return;
    }

    try {
      setStatus('connecting');
      setStatusMessage(`Connecting to ${roomUrl}.`);

      const connection = connectToSignalingRoom(
        {
          sessionId: trimmedSessionId,
          participantId: trimmedParticipantId,
          role,
        },
        {
          onOpen: () => {
            if (!isMountedRef.current) {
              return;
            }

            setStatus('open');
            setStatusMessage(`Connected to ${roomUrl}.`);
            setWebRtcBanner(
              role === 'host'
                ? 'Ready to start the WebRTC peer connection.'
                : 'Waiting for the host WebRTC offer.',
            );
            appendLog('open', 'WebSocket connection opened.', roomUrl);
          },
          onMessage: (message) => {
            if (!isMountedRef.current) {
              return;
            }

            handleIncomingMessage(message);
          },
          onError: (error) => {
            if (!isMountedRef.current) {
              return;
            }

            setStatus('error');
            setStatusMessage(error.message);
            appendLog('error', error.message);
          },
          onClose: (event) => {
            if (!isMountedRef.current) {
              return;
            }

            const wasUserInitiated = disconnectCauseRef.current === 'user';
            connectionRef.current = null;
            setStatus('closed');
            disconnectCauseRef.current = 'system';
            closeWebRtcPeerConnection();

            const reasonText = event.reason.trim() === '' ? 'No close reason was provided.' : event.reason;
            const summary = wasUserInitiated
              ? 'Signaling connection closed by request.'
              : 'Signaling connection closed.';

            setStatusMessage(summary);
            appendLog(
              'close',
              summary,
              `code=${event.code}, wasClean=${event.wasClean ? 'true' : 'false'}, reason=${reasonText}`,
            );
          },
        },
      );

      connectionRef.current = connection;
    } catch (error) {
      setConnectionError(getErrorMessage(error, 'Unable to connect to signaling room.'));
    }
  }

  function handleDisconnect() {
    if (connectionRef.current === null || connectionRef.current.readyState === WebSocket.CLOSED) {
      setConnectionError('No active signaling connection to disconnect.');
      return;
    }

    disconnectCauseRef.current = 'user';
    setStatus('closing');
    setStatusMessage('Disconnecting signaling connection.');
    closeWebRtcPeerConnection();
    connectionRef.current.close();
  }

  function handleSendTestSignal() {
    if (roomError) {
      setConnectionError(roomError);
      return;
    }

    const connection = connectionRef.current;
    if (connection === null) {
      setConnectionError('Connect signaling first.');
      return;
    }

    try {
      connection.sendSignal({
        kind: 'manual-test',
        data: {
          hello: 'peer',
        },
      });

      setStatusMessage('Manual test signal sent.');
    } catch (error) {
      setConnectionError(getErrorMessage(error, 'Unable to send signaling message.'));
    }
  }

  async function handleStartWebRtc() {
    if (roomError) {
      setWebRtcBanner(roomError, 'error');
      appendLog('error', roomError);
      return;
    }

    if (role !== 'host') {
      setWebRtcBanner('Only the host starts the WebRTC peer connection.', 'error');
      appendLog('error', 'Only the host starts the WebRTC peer connection.');
      return;
    }

    if (status !== 'open') {
      setWebRtcBanner('Connect signaling first.', 'error');
      appendLog('error', 'Connect signaling first.');
      return;
    }

    if (hasWebRtcController) {
      setWebRtcBanner('WebRTC peer connection is already active.');
      appendLog('info', 'WebRTC peer connection is already active.');
      return;
    }

    try {
      const controller = ensureWebRtcController();
      setWebRtcBanner('Starting the host WebRTC peer connection.');
      await controller.startHost();
      setWebRtcBanner('Host offer sent. Waiting for the guest answer and ICE candidates.');
    } catch (error) {
      closeWebRtcPeerConnection();
      setWebRtcBanner(getErrorMessage(error, 'Unable to start WebRTC peer connection.'), 'error');
      appendLog('error', getErrorMessage(error, 'Unable to start WebRTC peer connection.'));
    }
  }

  function handleCloseWebRtc() {
    if (!hasWebRtcController) {
      setWebRtcBanner('No active WebRTC peer connection to close.', 'error');
      appendLog('error', 'No active WebRTC peer connection to close.');
      return;
    }

    closeWebRtcPeerConnection();
    setWebRtcBanner('WebRTC peer connection closed.');
  }

  function handleSendWebRtcTestMessage() {
    if (!hasWebRtcController) {
      setWebRtcBanner('Start or receive a WebRTC peer connection first.', 'error');
      appendLog('error', 'Start or receive a WebRTC peer connection first.');
      return;
    }

    if (webRtcState.dataChannelState !== 'open') {
      setWebRtcBanner('Open the data channel before sending a test message.', 'error');
      appendLog('error', 'Open the data channel before sending a test message.');
      return;
    }

    try {
      peerConnectionRef.current?.sendTestMessage(`Hello from the ${role} data channel.`);
      setWebRtcBanner('Sent a WebRTC test data-channel message.');
    } catch (error) {
      setWebRtcBanner(getErrorMessage(error, 'Unable to send the WebRTC test message.'), 'error');
      appendLog('error', getErrorMessage(error, 'Unable to send the WebRTC test message.'));
    }
  }

  const canConnect = roomError === '' && status !== 'connecting' && status !== 'open' && status !== 'closing';
  const canDisconnect = status === 'connecting' || status === 'open' || status === 'closing';
  const canSendTestSignal = status === 'open' && roomError === '';
  const canStartWebRtc = role === 'host' && status === 'open' && !hasWebRtcController;
  const canCloseWebRtc = hasWebRtcController;
  const canSendWebRtcMessage = hasWebRtcController && webRtcState.dataChannelState === 'open';

  return (
    <section className="signaling-panel" aria-labelledby={`${role}-signaling-heading`}>
      <div className="panel__header">
        <div>
          <p className="eyebrow">{role === 'host' ? 'Host signaling' : 'Guest signaling'}</p>
          <h3 id={`${role}-signaling-heading`}>{heading}</h3>
        </div>
        <span className={`status-pill signaling-status signaling-status--${status}`}>
          {statusLabels[status]}
        </span>
      </div>

      <div className="signaling-actions">
        <button className="submit-button signaling-button" type="button" onClick={handleConnect} disabled={!canConnect}>
          Connect signaling
        </button>
        <button
          className="submit-button signaling-button signaling-button--secondary"
          type="button"
          onClick={handleDisconnect}
          disabled={!canDisconnect}
        >
          Disconnect signaling
        </button>
        <button
          className="submit-button signaling-button signaling-button--secondary"
          type="button"
          onClick={handleSendTestSignal}
          disabled={!canSendTestSignal}
        >
          Send test signal
        </button>
      </div>

        <dl className="details-grid signaling-details">
          <div className="detail-card">
            <dt>Detected role</dt>
            <dd>{role}</dd>
          </div>
          <div className="detail-card">
            <dt>Session ID</dt>
            <dd className="mono">{trimmedSessionId || 'Missing session ID'}</dd>
          </div>
        <div className="detail-card">
          <dt>Participant ID</dt>
          <dd className="mono">{trimmedParticipantId || 'Missing participant ID'}</dd>
        </div>
        <div className="detail-card">
          <dt>Role</dt>
          <dd>{role}</dd>
        </div>
        <div className="detail-card">
          <dt>Signaling URL</dt>
          <dd className="mono">{roomUrl || roomError}</dd>
        </div>
      </dl>

      {statusMessage ? (
        <div
          className={status === 'error' ? 'message message--error' : 'message'}
          aria-live={status === 'error' ? 'assertive' : 'polite'}
          role={status === 'error' ? 'alert' : 'status'}
        >
          {statusMessage}
        </div>
      ) : null}

      <section className="peer-panel" aria-labelledby={`${role}-webrtc-heading`}>
        <div className="panel__header">
          <div>
            <p className="eyebrow">Peer connection</p>
            <h4 id={`${role}-webrtc-heading`}>WebRTC foundation</h4>
          </div>
          <span className="status-pill">
            {role === 'host' ? 'Host starts the offer' : 'Guest waits for the offer'}
          </span>
        </div>

        <p className="api-note signaling-note">
          Camera, microphone, media tracks, recording, upload, and export are not active yet.
          This foundation only covers RTCPeerConnection, ICE, and a test data channel.
        </p>

        {rtcIceServersConfig.error ? (
          <div className="message message--error" role="alert">
            {rtcIceServersConfig.error}
          </div>
        ) : null}

        <div className="signaling-actions">
          {role === 'host' ? (
            <button
              className="submit-button signaling-button"
              type="button"
              onClick={handleStartWebRtc}
              disabled={!canStartWebRtc}
            >
              Create peer connection / Start WebRTC test
            </button>
          ) : null}
          <button
            className="submit-button signaling-button signaling-button--secondary"
            type="button"
            onClick={handleCloseWebRtc}
            disabled={!canCloseWebRtc}
          >
            Close peer connection
          </button>
          <button
            className="submit-button signaling-button signaling-button--secondary"
            type="button"
            onClick={handleSendWebRtcTestMessage}
            disabled={!canSendWebRtcMessage}
          >
            Send data channel test message
          </button>
        </div>

        <dl className="details-grid signaling-details">
          <div className="detail-card">
            <dt>Peer connection state</dt>
            <dd>{webRtcState.connectionState}</dd>
          </div>
          <div className="detail-card">
            <dt>Peer connection exists</dt>
            <dd>{webRtcState.peerConnectionCreated ? 'yes' : 'no'}</dd>
          </div>
          <div className="detail-card">
            <dt>ICE connection state</dt>
            <dd>{webRtcState.iceConnectionState}</dd>
          </div>
          <div className="detail-card">
            <dt>Signaling state</dt>
            <dd>{webRtcState.signalingState}</dd>
          </div>
          <div className="detail-card">
            <dt>Data channel state</dt>
            <dd>{webRtcState.dataChannelState}</dd>
          </div>
          <div className="detail-card">
            <dt>Local description</dt>
            <dd>{webRtcState.localDescriptionState}</dd>
          </div>
          <div className="detail-card">
            <dt>Remote description</dt>
            <dd>{webRtcState.remoteDescriptionState}</dd>
          </div>
          <div className="detail-card">
            <dt>ICE server config</dt>
            <dd>
              {rtcIceServersConfig.error
                ? 'Fallback to [] because the config could not be parsed.'
                : rtcIceServersConfig.iceServers.length === 0
                  ? 'No custom ICE servers configured.'
                  : `${rtcIceServersConfig.iceServers.length} server(s) configured.`}
            </dd>
          </div>
          <div className="detail-card">
            <dt>Connection mode</dt>
            <dd>{role === 'host' ? 'Host creates the offer.' : 'Guest waits for the host offer.'}</dd>
          </div>
        </dl>

        <div
          className={`message ${webRtcMessageKind === 'error' ? 'message--error' : ''}`}
          aria-live={webRtcMessageKind === 'error' ? 'assertive' : 'polite'}
          role={webRtcMessageKind === 'error' ? 'alert' : 'status'}
        >
          {webRtcMessage || (role === 'guest' ? 'Waiting for host WebRTC offer.' : 'Ready to start the host WebRTC test.')}
        </div>

        <section className="signaling-log" aria-labelledby={`${role}-signaling-log-heading`}>
          <div className="panel__header signaling-log__header">
            <div>
              <p className="eyebrow">Event log</p>
              <h4 id={`${role}-signaling-log-heading`}>Signaling and WebRTC events</h4>
            </div>
          </div>

          {events.length > 0 ? (
            <ul className="signaling-log__list">
              {events.map((event) => (
                <li key={event.id} className={`signaling-log__item signaling-log__item--${event.kind}`}>
                  <div className="signaling-log__meta">
                    <span className="signaling-log__kind">{event.kind}</span>
                    <span className="signaling-log__time">{event.at}</span>
                  </div>
                  <p className="signaling-log__summary">{event.summary}</p>
                  {event.details ? <pre className="signaling-log__details">{event.details}</pre> : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="message signaling-log__empty">No signaling or WebRTC events yet.</div>
          )}
        </section>
      </section>
    </section>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallback;
}

function stringifyValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isWebRtcSignalPayload(payload: unknown): payload is WebRtcSignalPayload {
  if (!isRecord(payload) || typeof payload.kind !== 'string') {
    return false;
  }

  if (payload.kind === 'webrtc-offer' || payload.kind === 'webrtc-answer') {
    return isRecord(payload.description) && typeof payload.description.type === 'string';
  }

  if (payload.kind === 'webrtc-ice-candidate') {
    return isRecord(payload.candidate) && typeof payload.candidate.candidate === 'string';
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatLogTime(value: Date): string {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}
