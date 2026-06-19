import type { RecordingUploadQueueItem } from '../upload/useRecordingUploadQueue';

export interface RecordingExportCandidate {
  recordingId: string;
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
  uploadId: string;
  uploadStatus: string;
}

export function selectLatestExportCandidate(
  items: RecordingUploadQueueItem[],
): RecordingExportCandidate | null {
  const reversed = [...items].reverse();
  const match = reversed.find((item) => {
    const state = item.state;
    return (
      state !== null &&
      state.status === 'uploaded' &&
      typeof state.sessionId === 'string' &&
      state.sessionId.trim() !== '' &&
      typeof state.participantId === 'string' &&
      state.participantId.trim() !== '' &&
      state.role !== null &&
      state.uploadId !== null
    );
  });

  if (match === undefined || match.state === null) {
    return null;
  }

  return {
    recordingId: match.recording.recordingId,
    sessionId: match.state.sessionId ?? match.recording.manifest.sessionId ?? '',
    participantId: match.state.participantId ?? match.recording.manifest.participantId ?? '',
    role: match.state.role ?? match.recording.manifest.role ?? 'host',
    uploadId: match.state.uploadId ?? '',
    uploadStatus: match.state.status,
  };
}

export function getExportTargetLabel(): string {
  return 'MP4 1080p';
}

export function getExportStatusSummaryLabel(status: string | null | undefined): string {
  if (status === null || status === undefined || status.trim() === '') {
    return 'Not started';
  }

  return status;
}

