import { useEffect, useRef, useState } from 'react';
import {
  buildSignalingRoomUrl,
  connectToSignalingRoom,
  type SignalingConnection,
  type SignalingIncomingMessage,
  type SignalingRole,
} from '../signaling/client';

type SignalingStatus = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'error';

type SignalingLogKind = 'open' | 'message' | 'error' | 'close';

type SignalingLogEntry = {
  id: string;
  kind: SignalingLogKind;
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

const maxLogEntries = 8;

export function SignalingPanel({ heading, sessionId, participantId, role }: SignalingPanelProps) {
  const [status, setStatus] = useState<SignalingStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [events, setEvents] = useState<SignalingLogEntry[]>([]);
  const connectionRef = useRef<SignalingConnection | null>(null);
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

    return () => {
      isMountedRef.current = false;
      connectionRef.current?.close();
      connectionRef.current = null;
    };
  }, []);

  useEffect(() => {
    connectionRef.current?.close();
    connectionRef.current = null;
    disconnectCauseRef.current = 'system';
    setStatus('idle');
    setStatusMessage('');
    setEvents([]);
  }, [trimmedSessionId, trimmedParticipantId, role]);

  function appendLog(kind: SignalingLogKind, summary: string, details?: string) {
    if (!isMountedRef.current) {
      return;
    }

    const entry: SignalingLogEntry = {
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

  function handleIncomingMessage(message: SignalingIncomingMessage) {
    if (message.type === 'signal') {
      appendLog(
        'message',
        `Signal from ${message.from.participant_id} (${message.from.role}).`,
        `payload=${stringifyValue(message.payload)}`,
      );
      return;
    }

    if (message.type === 'error') {
      appendLog('error', message.error.message, `code=${message.error.code}`);
      return;
    }

    appendLog('error', message.message, `raw=${stringifyValue(message.raw)}`);
  }

  const canConnect = roomError === '' && status !== 'connecting' && status !== 'open' && status !== 'closing';
  const canDisconnect = status === 'connecting' || status === 'open' || status === 'closing';
  const canSendTestSignal = status === 'open' && roomError === '';

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

      <p className="api-note signaling-note">
        Camera, microphone, and WebRTC media are not active yet.
      </p>

      {roomError ? (
        <div className="message message--error" role="alert">
          {roomError}
        </div>
      ) : null}

      {statusMessage ? (
        <div
          className={status === 'error' ? 'message message--error' : 'message'}
          aria-live={status === 'error' ? 'assertive' : 'polite'}
          role={status === 'error' ? 'alert' : 'status'}
        >
          {statusMessage}
        </div>
      ) : null}

      <section className="signaling-log" aria-labelledby={`${role}-signaling-log-heading`}>
        <div className="panel__header signaling-log__header">
          <div>
            <p className="eyebrow">Event log</p>
            <h4 id={`${role}-signaling-log-heading`}>Connection events</h4>
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
          <div className="message signaling-log__empty">No signaling events yet.</div>
        )}
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

function formatLogTime(value: Date): string {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}
