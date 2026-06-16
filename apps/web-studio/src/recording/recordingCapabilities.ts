export const recordingMimeTypeCandidates = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const;

export interface RecordingCapabilityReport {
  mediaRecorderAvailable: boolean;
  isTypeSupportedAvailable: boolean;
  supportedMimeTypes: string[];
  preferredMimeType: string | null;
  localStreamAvailable: boolean;
  audioTrackCount: number;
  videoTrackCount: number;
  canAttemptAudioVideoRecording: boolean;
  warnings: string[];
}

export function getRecordingCapabilityReport(
  stream: MediaStream | null | undefined = null,
): RecordingCapabilityReport {
  const mediaRecorderAvailable =
    typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';
  const isTypeSupportedAvailable =
    mediaRecorderAvailable && typeof window.MediaRecorder.isTypeSupported === 'function';

  const supportedMimeTypes = isTypeSupportedAvailable
    ? recordingMimeTypeCandidates.filter((candidate) => {
        try {
          return window.MediaRecorder.isTypeSupported(candidate);
        } catch {
          return false;
        }
      })
    : [];

  const preferredMimeType = supportedMimeTypes[0] ?? null;
  const audioTrackCount = stream?.getAudioTracks().length ?? 0;
  const videoTrackCount = stream?.getVideoTracks().length ?? 0;
  const localStreamAvailable = stream !== null && stream !== undefined;
  const hasAudioVideoTracks = audioTrackCount > 0 && videoTrackCount > 0;

  const canAttemptAudioVideoRecording =
    mediaRecorderAvailable &&
    isTypeSupportedAvailable &&
    preferredMimeType !== null &&
    localStreamAvailable &&
    hasAudioVideoTracks;

  const warnings: string[] = [];

  if (!mediaRecorderAvailable) {
    warnings.push('MediaRecorder is unavailable in this browser.');
  } else if (!isTypeSupportedAvailable) {
    warnings.push('MediaRecorder.isTypeSupported is unavailable, so MIME support cannot be checked.');
  }

  if (mediaRecorderAvailable && isTypeSupportedAvailable && supportedMimeTypes.length === 0) {
    warnings.push('None of the candidate MIME types were reported as supported.');
  }

  if (!localStreamAvailable) {
    warnings.push('Start local preview to inspect a live capture stream.');
  } else if (!hasAudioVideoTracks) {
    warnings.push('The active local preview does not yet expose both audio and video tracks.');
  }

  return {
    mediaRecorderAvailable,
    isTypeSupportedAvailable,
    supportedMimeTypes,
    preferredMimeType,
    localStreamAvailable,
    audioTrackCount,
    videoTrackCount,
    canAttemptAudioVideoRecording,
    warnings,
  };
}
