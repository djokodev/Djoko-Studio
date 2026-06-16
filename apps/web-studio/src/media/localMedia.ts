export type LocalMediaPreviewStatus = 'idle' | 'requesting' | 'active' | 'error';

export type TrackReadyState = MediaStreamTrack['readyState'] | 'unavailable';

export interface LocalMediaDiagnostics {
  previewStatus: LocalMediaPreviewStatus;
  hasStream: boolean;
  videoTrackCount: number;
  audioTrackCount: number;
  videoTrackReadyState: TrackReadyState;
  audioTrackReadyState: TrackReadyState;
  errorMessage: string;
}

const defaultLocalMediaConstraints: MediaStreamConstraints = {
  audio: true,
  video: true,
};

export function createIdleLocalMediaDiagnostics(): LocalMediaDiagnostics {
  return {
    previewStatus: 'idle',
    hasStream: false,
    videoTrackCount: 0,
    audioTrackCount: 0,
    videoTrackReadyState: 'unavailable',
    audioTrackReadyState: 'unavailable',
    errorMessage: '',
  };
}

export function describeLocalMediaStream(
  stream: MediaStream | null,
  previewStatus: LocalMediaPreviewStatus,
  errorMessage = '',
): LocalMediaDiagnostics {
  return {
    previewStatus,
    hasStream: stream !== null,
    videoTrackCount: stream?.getVideoTracks().length ?? 0,
    audioTrackCount: stream?.getAudioTracks().length ?? 0,
    videoTrackReadyState: getTrackReadyState(stream?.getVideoTracks() ?? []),
    audioTrackReadyState: getTrackReadyState(stream?.getAudioTracks() ?? []),
    errorMessage,
  };
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (stream === null) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export async function requestLocalMediaStream(
  constraints: MediaStreamConstraints = defaultLocalMediaConstraints,
): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
    throw new Error('Camera and microphone access is not available in this browser.');
  }

  return navigator.mediaDevices.getUserMedia(constraints);
}

export function getLocalMediaStatusLabel(status: LocalMediaPreviewStatus): string {
  switch (status) {
    case 'idle':
      return 'Ready';
    case 'requesting':
      return 'Requesting';
    case 'active':
      return 'Active';
    case 'error':
      return 'Error';
  }
}

export function getLocalMediaErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallback;
}

function getTrackReadyState(tracks: MediaStreamTrack[]): TrackReadyState {
  const track = tracks[0];
  return track?.readyState ?? 'unavailable';
}
