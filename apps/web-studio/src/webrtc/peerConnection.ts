import type { SignalingRole } from '../signaling/client';

export type WebRtcSignalPayload =
  | {
      kind: 'webrtc-offer';
      description: RTCSessionDescriptionInit;
    }
  | {
      kind: 'webrtc-answer';
      description: RTCSessionDescriptionInit;
    }
  | {
      kind: 'webrtc-ice-candidate';
      candidate: RTCIceCandidateInit;
    };

export type WebRtcPeerConnectionState = {
  connectionState: RTCPeerConnectionState | 'not-created';
  iceConnectionState: RTCIceConnectionState | 'not-created';
  signalingState: RTCSignalingState | 'not-created';
  dataChannelState: RTCDataChannelState | 'none';
};

export type WebRtcPeerConnectionEvent = {
  id: string;
  kind: 'state' | 'signal' | 'data' | 'error' | 'info';
  summary: string;
  details?: string;
  at: string;
};

export type WebRtcIceServersConfig = {
  iceServers: RTCIceServer[];
  error: string | null;
};

export interface CreateWebRtcPeerConnectionOptions {
  role: SignalingRole;
  iceServers: RTCIceServer[];
  sendSignal: (payload: WebRtcSignalPayload) => void;
  onStateChange?: (state: WebRtcPeerConnectionState) => void;
  onEvent?: (event: WebRtcPeerConnectionEvent) => void;
  onDataChannelMessage?: (message: string) => void;
}

export interface WebRtcPeerConnectionController {
  readonly state: WebRtcPeerConnectionState;
  startHost(): Promise<void>;
  handleSignal(payload: WebRtcSignalPayload): Promise<void>;
  sendTestMessage(message: string): void;
  close(): void;
}

export const rtcIceServersConfig = readRtcIceServersConfig();

export function createWebRtcPeerConnection(
  options: CreateWebRtcPeerConnectionOptions,
): WebRtcPeerConnectionController {
  let peerConnection: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;
  let pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  let closed = false;
  let currentState = createEmptyState();

  function emitEvent(kind: WebRtcPeerConnectionEvent['kind'], summary: string, details?: string) {
    options.onEvent?.({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      summary,
      details,
      at: formatEventTime(new Date()),
    });
  }

  function emitState(summary: string, details?: string) {
    currentState = snapshotState();
    options.onStateChange?.(currentState);
    emitEvent('state', summary, details);
  }

  function snapshotState(): WebRtcPeerConnectionState {
    if (peerConnection === null) {
      return createEmptyState();
    }

    return {
      connectionState: peerConnection.connectionState,
      iceConnectionState: peerConnection.iceConnectionState,
      signalingState: peerConnection.signalingState,
      dataChannelState: dataChannel?.readyState ?? 'none',
    };
  }

  function ensureOpen() {
    if (closed) {
      throw new Error('WebRTC peer connection has already been closed.');
    }
  }

  function ensureBrowserSupport() {
    if (typeof RTCPeerConnection === 'undefined') {
      throw new Error('WebRTC is not supported in this browser.');
    }
  }

  function createPeerConnection() {
    ensureOpen();
    ensureBrowserSupport();

    if (peerConnection !== null) {
      return peerConnection;
    }

    peerConnection = new RTCPeerConnection({
      iceServers: options.iceServers,
    });

    peerConnection.onconnectionstatechange = () => {
      emitState(`Peer connection state changed to ${peerConnection?.connectionState ?? 'closed'}.`);
    };

    peerConnection.oniceconnectionstatechange = () => {
      emitState(`ICE connection state changed to ${peerConnection?.iceConnectionState ?? 'closed'}.`);
    };

    peerConnection.onsignalingstatechange = () => {
      emitState(`Signaling state changed to ${peerConnection?.signalingState ?? 'closed'}.`);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate === null) {
        emitEvent('info', 'Local ICE gathering completed.');
        return;
      }

      const candidate = toIceCandidateInit(event.candidate);
      emitEvent(
        'signal',
        'Local ICE candidate generated.',
        stringifyValue(candidate),
      );

      try {
        options.sendSignal({
          kind: 'webrtc-ice-candidate',
          candidate,
        });
      } catch (error) {
        emitEvent('error', 'Unable to send local ICE candidate.', getErrorMessage(error));
      }
    };

    if (options.role === 'guest') {
      peerConnection.ondatachannel = (event) => {
        attachDataChannel(event.channel);
        emitEvent('data', 'Guest received the remote data channel.');
      };
    }

    emitState('WebRTC peer connection created.');
    return peerConnection;
  }

  function attachDataChannel(channel: RTCDataChannel) {
    dataChannel = channel;

    channel.onopen = () => {
      emitState(`Data channel opened on ${channel.label}.`);
    };

    channel.onclose = () => {
      emitState(`Data channel closed on ${channel.label}.`);
    };

    channel.onerror = () => {
      emitEvent('error', `Data channel error on ${channel.label}.`);
    };

    channel.onmessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : stringifyValue(event.data);
      options.onDataChannelMessage?.(text);
      emitEvent('data', `Data channel message received on ${channel.label}.`, text);
    };

    emitState(`Data channel attached: ${channel.label}.`);
  }

  async function handleRemoteDescription(description: RTCSessionDescriptionInit) {
    const pc = createPeerConnection();
    await pc.setRemoteDescription(description);
    emitState(`Remote ${description.type} applied.`);
    await flushPendingRemoteCandidates();
  }

  async function flushPendingRemoteCandidates() {
    if (peerConnection === null || peerConnection.remoteDescription === null) {
      return;
    }

    const pendingCandidates = pendingRemoteCandidates;
    pendingRemoteCandidates = [];

    for (const candidate of pendingCandidates) {
      await addRemoteIceCandidate(candidate);
    }
  }

  async function addRemoteIceCandidate(candidate: RTCIceCandidateInit) {
    if (peerConnection === null) {
      pendingRemoteCandidates.push(candidate);
      emitEvent(
        'info',
        'Queued remote ICE candidate until the peer connection exists.',
        stringifyValue(candidate),
      );
      return;
    }

    if (peerConnection.remoteDescription === null) {
      pendingRemoteCandidates.push(candidate);
      emitEvent(
        'info',
        'Queued remote ICE candidate until the remote description is set.',
        stringifyValue(candidate),
      );
      return;
    }

    try {
      await peerConnection.addIceCandidate(candidate);
      emitEvent('signal', 'Remote ICE candidate applied.', stringifyValue(candidate));
    } catch (error) {
      pendingRemoteCandidates.push(candidate);
      emitEvent(
        'error',
        'Unable to apply remote ICE candidate.',
        `${getErrorMessage(error)}\n${stringifyValue(candidate)}`,
      );
    }
  }

  function getActiveDataChannel() {
    if (dataChannel === null) {
      throw new Error('Data channel is not available yet.');
    }

    if (dataChannel.readyState !== 'open') {
      throw new Error(`Data channel is ${dataChannel.readyState}.`);
    }

    return dataChannel;
  }

  currentState = snapshotState();

  return {
    get state() {
      return currentState;
    },
    async startHost() {
      if (options.role !== 'host') {
        throw new Error('Only the host can start a peer connection manually.');
      }

      const pc = createPeerConnection();

      if (dataChannel === null) {
        attachDataChannel(pc.createDataChannel('djoko-peer-test'));
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      emitEvent('signal', 'Host created a WebRTC offer.', stringifyValue(offer));
      options.sendSignal({
        kind: 'webrtc-offer',
        description: toSessionDescriptionInit(pc.localDescription ?? offer),
      });
      await flushPendingRemoteCandidates();
      emitState('Host offer sent through signaling.');
    },
    async handleSignal(payload: WebRtcSignalPayload) {
      ensureOpen();

      if (payload.kind === 'webrtc-offer') {
        if (options.role !== 'guest') {
          throw new Error('The host should not receive a WebRTC offer.');
        }

        await handleRemoteDescription(payload.description);
        const pc = peerConnection;
        if (pc === null) {
          throw new Error('WebRTC peer connection is not available.');
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        emitEvent('signal', 'Guest created a WebRTC answer.', stringifyValue(answer));
        options.sendSignal({
          kind: 'webrtc-answer',
          description: toSessionDescriptionInit(pc.localDescription ?? answer),
        });
        await flushPendingRemoteCandidates();
        emitState('Guest answer sent through signaling.');
        return;
      }

      if (payload.kind === 'webrtc-answer') {
        if (options.role !== 'host') {
          throw new Error('The guest should not receive a WebRTC answer.');
        }

        await handleRemoteDescription(payload.description);
        emitState('Host accepted the WebRTC answer.');
        return;
      }

      await addRemoteIceCandidate(payload.candidate);
      await flushPendingRemoteCandidates();
    },
    sendTestMessage(message: string) {
      ensureOpen();
      const channel = getActiveDataChannel();
      channel.send(message);
      emitEvent('data', 'Sent test data-channel message.', message);
    },
    close() {
      if (closed) {
        return;
      }

      closed = true;
      pendingRemoteCandidates = [];

      if (dataChannel !== null) {
        dataChannel.close();
      }

      if (peerConnection !== null) {
        peerConnection.onconnectionstatechange = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.onsignalingstatechange = null;
        peerConnection.onicecandidate = null;
        peerConnection.ondatachannel = null;
        peerConnection.close();
      }

      dataChannel = null;
      peerConnection = null;
      currentState = createClosedState();
      options.onStateChange?.(currentState);
      emitEvent('state', 'WebRTC peer connection closed.');
    },
  };
}

export function readRtcIceServersConfig(): WebRtcIceServersConfig {
  const rawValue = import.meta.env.VITE_RTC_ICE_SERVERS_JSON?.trim();

  if (!rawValue) {
    return {
      iceServers: [],
      error: null,
    };
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error('Expected a JSON array.');
    }

    const iceServers = parsed.map((entry, index) => validateIceServer(entry, index));

    return {
      iceServers,
      error: null,
    };
  } catch (error) {
    return {
      iceServers: [],
      error: `Invalid VITE_RTC_ICE_SERVERS_JSON: ${getErrorMessage(error)}`,
    };
  }
}

function validateIceServer(value: unknown, index: number): RTCIceServer {
  if (!isRecord(value)) {
    throw new Error(`Entry ${index + 1} must be an object.`);
  }

  const urls = value.urls;
  if (typeof urls !== 'string' && !Array.isArray(urls)) {
    throw new Error(`Entry ${index + 1} must define "urls" as a string or string array.`);
  }

  if (typeof urls === 'string') {
    return { urls };
  }

  const normalizedUrls = urls.map((url, urlIndex) => {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(`Entry ${index + 1} has an invalid URL at position ${urlIndex + 1}.`);
    }

    return url;
  });

  return {
    urls: normalizedUrls,
  };
}

function createEmptyState(): WebRtcPeerConnectionState {
  return {
    connectionState: 'not-created',
    iceConnectionState: 'not-created',
    signalingState: 'not-created',
    dataChannelState: 'none',
  };
}

function createClosedState(): WebRtcPeerConnectionState {
  return {
    connectionState: 'closed',
    iceConnectionState: 'closed',
    signalingState: 'closed',
    dataChannelState: 'closed',
  };
}

function toIceCandidateInit(candidate: RTCIceCandidate): RTCIceCandidateInit {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? undefined,
    sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
  };
}

function toSessionDescriptionInit(
  description: RTCSessionDescription | RTCSessionDescriptionInit,
): RTCSessionDescriptionInit {
  return {
    type: description.type,
    sdp: description.sdp ?? undefined,
  };
}

function formatEventTime(value: Date): string {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'An unexpected error occurred.';
}

function stringifyValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
