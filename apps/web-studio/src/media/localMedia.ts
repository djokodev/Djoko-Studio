export type LocalMediaPreviewStatus = 'idle' | 'requesting' | 'active' | 'error';

export type TrackReadyState = MediaStreamTrack['readyState'] | 'unavailable';

export type LocalMediaTrackEnabledState = 'enabled' | 'muted' | 'disabled' | 'unavailable';

export interface LocalMediaDiagnostics {
  previewStatus: LocalMediaPreviewStatus;
  hasStream: boolean;
  videoTrackCount: number;
  audioTrackCount: number;
  videoTrackEnabledState: LocalMediaTrackEnabledState;
  audioTrackEnabledState: LocalMediaTrackEnabledState;
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
    videoTrackEnabledState: 'unavailable',
    audioTrackEnabledState: 'unavailable',
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
  const videoTracks = stream?.getVideoTracks() ?? [];
  const audioTracks = stream?.getAudioTracks() ?? [];

  return {
    previewStatus,
    hasStream: stream !== null,
    videoTrackCount: videoTracks.length,
    audioTrackCount: audioTracks.length,
    videoTrackEnabledState: describeTrackEnabledState(videoTracks, 'disabled'),
    audioTrackEnabledState: describeTrackEnabledState(audioTracks, 'muted'),
    videoTrackReadyState: getTrackReadyState(videoTracks),
    audioTrackReadyState: getTrackReadyState(audioTracks),
    errorMessage,
  };
}

export function setLocalMediaTracksEnabled(
  stream: MediaStream | null,
  kind: 'audio' | 'video',
  enabled: boolean,
): void {
  if (stream === null) {
    return;
  }

  const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
  for (const track of tracks) {
    track.enabled = enabled;
  }
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

function describeTrackEnabledState(
  tracks: MediaStreamTrack[],
  disabledLabel: 'muted' | 'disabled',
): LocalMediaTrackEnabledState {
  const track = tracks[0];
  if (track === undefined || track.readyState !== 'live') {
    return 'unavailable';
  }

  return track.enabled ? 'enabled' : disabledLabel;
}
