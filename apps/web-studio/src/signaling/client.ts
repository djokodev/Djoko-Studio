export type SignalingRole = 'host' | 'guest';

export type SignalingIncomingMessage =
  | {
      type: 'signal';
      from: {
        participant_id: string;
        role: SignalingRole;
      };
      payload: unknown;
    }
  | {
      type: 'error';
      error: {
        code: string;
        message: string;
      };
    }
  | {
      type: 'malformed';
      message: string;
      raw: unknown;
    };

export interface SignalingConnectionCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface SignalingConnectionError {
  message: string;
}

export interface SignalingConnectionHandlers {
  onOpen?: () => void;
  onMessage?: (message: SignalingIncomingMessage) => void;
  onError?: (error: SignalingConnectionError) => void;
  onClose?: (event: SignalingConnectionCloseEvent) => void;
}

export interface SignalingRoomInput {
  sessionId: string;
  participantId: string;
  role: SignalingRole;
}

export interface SignalingConnection {
  url: string;
  readonly readyState: number;
  sendSignal(payload: unknown): void;
  close(): void;
}

const defaultSignalingBaseUrl = 'ws://localhost:8081';

export function getSignalingBaseUrl(): string {
  return import.meta.env.VITE_SIGNALING_BASE_URL?.trim() || defaultSignalingBaseUrl;
}

export function buildSignalingRoomUrl({
  sessionId,
  participantId,
  role,
}: SignalingRoomInput): string {
  const trimmedSessionId = sessionId.trim();
  if (trimmedSessionId === '') {
    throw new Error('Missing session ID.');
  }

  const trimmedParticipantId = participantId.trim();
  if (trimmedParticipantId === '') {
    throw new Error('Missing participant ID.');
  }

  assertSignalingRole(role);

  const baseUrl = new URL(getSignalingBaseUrl());
  const normalizedBasePath = baseUrl.pathname.replace(/\/+$/, '');
  baseUrl.pathname = `${normalizedBasePath}/v1/signaling/rooms/${encodeURIComponent(trimmedSessionId)}`;
  baseUrl.searchParams.set('participant_id', trimmedParticipantId);
  baseUrl.searchParams.set('role', role);

  return baseUrl.toString();
}

export function connectToSignalingRoom(
  input: SignalingRoomInput,
  handlers: SignalingConnectionHandlers = {},
): SignalingConnection {
  const url = buildSignalingRoomUrl(input);
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    handlers.onOpen?.();
  });

  socket.addEventListener('message', (event) => {
    handlers.onMessage?.(parseIncomingMessage(event.data));
  });

  socket.addEventListener('error', () => {
    handlers.onError?.({
      message: 'WebSocket connection error.',
    });
  });

  socket.addEventListener('close', (event) => {
    handlers.onClose?.({
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });
  });

  return {
    url,
    get readyState() {
      return socket.readyState;
    },
    sendSignal(payload: unknown) {
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error('Signaling connection is not open.');
      }

      socket.send(JSON.stringify({ type: 'signal', payload }));
    },
    close() {
      if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
        return;
      }

      socket.close();
    },
  };
}

function parseIncomingMessage(data: unknown): SignalingIncomingMessage {
  if (typeof data !== 'string') {
    return {
      type: 'malformed',
      message: 'Malformed incoming message: expected a text frame.',
      raw: data,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return {
      type: 'malformed',
      message: 'Malformed incoming message: invalid JSON.',
      raw: data,
    };
  }

  if (!isRecord(parsed)) {
    return {
      type: 'malformed',
      message: 'Malformed incoming message: expected a JSON object.',
      raw: parsed,
    };
  }

  if (parsed.type === 'signal') {
    const from = parsed.from;
    if (!isRecord(from)) {
      return {
        type: 'malformed',
        message: 'Malformed incoming message: missing sender metadata.',
        raw: parsed,
      };
    }

    const participantId = from.participant_id;
    const role = from.role;
    if (typeof participantId !== 'string' || participantId.trim() === '') {
      return {
        type: 'malformed',
        message: 'Malformed incoming message: missing sender participant ID.',
        raw: parsed,
      };
    }

    if (!isSignalingRole(role)) {
      return {
        type: 'malformed',
        message: 'Malformed incoming message: unsupported sender role.',
        raw: parsed,
      };
    }

    return {
      type: 'signal',
      from: {
        participant_id: participantId,
        role,
      },
      payload: parsed.payload,
    };
  }

  if (parsed.type === 'error') {
    const error = parsed.error;
    const code = isRecord(error) ? error.code : undefined;
    const message = isRecord(error) ? error.message : undefined;

    if (typeof code !== 'string' || code.trim() === '' || typeof message !== 'string' || message.trim() === '') {
      return {
        type: 'malformed',
        message: 'Malformed incoming message: invalid error payload.',
        raw: parsed,
      };
    }

    return {
      type: 'error',
      error: {
        code,
        message,
      },
    };
  }

  return {
    type: 'malformed',
    message: `Malformed incoming message: unsupported type "${String(parsed.type)}".`,
    raw: parsed,
  };
}

function assertSignalingRole(role: string): asserts role is SignalingRole {
  if (!isSignalingRole(role)) {
    throw new Error(`Unsupported signaling role: ${role}`);
  }
}

function isSignalingRole(role: unknown): role is SignalingRole {
  return role === 'host' || role === 'guest';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
