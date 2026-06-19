import type { RecordingUploadQueueItem } from '../upload/useRecordingUploadQueue';

export interface RecordingExportCandidate {
  recordingId: string;
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
  uploadId: string;
  uploadStatus: string;
}

interface RecordingExportCandidateWithOrder extends RecordingExportCandidate {
  completedAt: number | null;
  updatedAt: number | null;
  createdAt: number | null;
  recordingLastPersistedAt: number | null;
  recordingFirstPersistedAt: number | null;
}

export function selectLatestExportCandidate(
  items: RecordingUploadQueueItem[],
): RecordingExportCandidate | null {
  const candidates = items
    .map((item) => buildExportCandidate(item))
    .filter((candidate): candidate is RecordingExportCandidateWithOrder => candidate !== null)
    .sort(compareExportCandidates);

  if (candidates.length === 0) {
    return null;
  }

  const match = candidates[0];

  return {
    recordingId: match.recordingId,
    sessionId: match.sessionId,
    participantId: match.participantId,
    role: match.role,
    uploadId: match.uploadId,
    uploadStatus: match.uploadStatus,
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

function buildExportCandidate(
  item: RecordingUploadQueueItem,
): RecordingExportCandidateWithOrder | null {
  const state = item.state;
  if (state === null || state.status !== 'uploaded') {
    return null;
  }

  const recording = item.recording;
  const sessionId = resolveNonEmptyText(state.sessionId, recording.manifest.sessionId);
  const participantId = resolveNonEmptyText(state.participantId, recording.manifest.participantId);
  const role = state.role ?? recording.manifest.role ?? null;
  const uploadId = resolveNonEmptyText(state.uploadId, null);

  if (sessionId === null || participantId === null || role === null || uploadId === null) {
    return null;
  }

  return {
    recordingId: recording.recordingId,
    sessionId,
    participantId,
    role,
    uploadId,
    uploadStatus: state.status,
    completedAt: normalizeTimestamp(state.completedAt),
    updatedAt: normalizeTimestamp(state.updatedAt),
    createdAt: normalizeTimestamp(state.createdAt),
    recordingLastPersistedAt: normalizeTimestamp(recording.lastPersistedAt),
    recordingFirstPersistedAt: normalizeTimestamp(recording.firstPersistedAt),
  };
}

function compareExportCandidates(
  left: RecordingExportCandidateWithOrder,
  right: RecordingExportCandidateWithOrder,
): number {
  return (
    compareNumbersDescending(left.completedAt, right.completedAt) ||
    compareNumbersDescending(left.updatedAt, right.updatedAt) ||
    compareNumbersDescending(left.createdAt, right.createdAt) ||
    compareNumbersDescending(left.recordingLastPersistedAt, right.recordingLastPersistedAt) ||
    compareNumbersDescending(left.recordingFirstPersistedAt, right.recordingFirstPersistedAt) ||
    compareStringsDescending(left.uploadId, right.uploadId) ||
    compareStringsDescending(left.recordingId, right.recordingId)
  );
}

function resolveNonEmptyText(primary: string | null, fallback: string | undefined | null): string | null {
  const normalizedPrimary = normalizeTextValue(primary);
  if (normalizedPrimary !== null) {
    return normalizedPrimary;
  }

  return normalizeTextValue(fallback ?? null);
}

function normalizeTextValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === '' ? null : normalizedValue;
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareNumbersDescending(left: number | null, right: number | null): number {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return right - left;
}

function compareStringsDescending(left: string, right: string): number {
  return right.localeCompare(left);
}
