import type { PersistedLocalRecordingRecord } from '../recording/recordingPersistence';
import { getPersistedExportId } from './recordingExportPersistence';

export interface RecentPersistedExportSummary {
  exportId: string;
  recordingId: string;
  role: 'host' | 'guest' | null;
  lastSavedAt: number | null;
}

export function listRecentPersistedExportSummaries(
  recordings: readonly PersistedLocalRecordingRecord[],
  limit = 3,
): RecentPersistedExportSummary[] {
  if (limit <= 0) {
    return [];
  }

  return recordings
    .map((recording) => {
      const exportId = getPersistedExportId(recording.recordingId);
      if (exportId === null) {
        return null;
      }

      return {
        exportId,
        recordingId: recording.recordingId,
        role: recording.manifest.role ?? null,
        lastSavedAt: resolveLastSavedAt(recording),
      } satisfies RecentPersistedExportSummary;
    })
    .filter((summary): summary is RecentPersistedExportSummary => summary !== null)
    .sort(compareRecentPersistedExports)
    .slice(0, limit);
}

function resolveLastSavedAt(recording: PersistedLocalRecordingRecord): number | null {
  if (Number.isFinite(recording.lastPersistedAt)) {
    return recording.lastPersistedAt;
  }

  if (recording.manifest.stoppedAt !== null && Number.isFinite(recording.manifest.stoppedAt)) {
    return recording.manifest.stoppedAt;
  }

  if (recording.manifest.startedAt !== null && Number.isFinite(recording.manifest.startedAt)) {
    return recording.manifest.startedAt;
  }

  return null;
}

function compareRecentPersistedExports(
  left: RecentPersistedExportSummary,
  right: RecentPersistedExportSummary,
): number {
  return (
    compareNumbersDescending(left.lastSavedAt, right.lastSavedAt) ||
    right.exportId.localeCompare(left.exportId) ||
    right.recordingId.localeCompare(left.recordingId)
  );
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
