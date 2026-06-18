import type { RecordingState } from './recordingStateMachine';

export const localRecordingSourceKind = 'local_preview_audio_video' as const;

export type LocalRecordingSourceKind = typeof localRecordingSourceKind;
export type LocalRecordingManifestStatus = RecordingState;
export type LocalRecordingUploadStatusPlaceholder = 'local_only';
export type LocalRecordingPersistenceSupportStatus =
  | 'not_checked'
  | 'supported'
  | 'unavailable'
  | 'failed';
export type LocalRecordingPersistenceStatus =
  | 'not_checked'
  | 'unsupported'
  | 'available'
  | 'persisting'
  | 'persisted'
  | 'failed';
export type LocalRecordingUploadStatus = 'not_implemented';

export interface LocalRecordingChunkManifestEntry {
  chunkId: string;
  recordingId: string;
  chunkIndex: number;
  mimeType: string | null;
  sizeBytes: number;
  capturedAt: number;
  elapsedMsFromStart: number;
  uploadStatus: LocalRecordingUploadStatusPlaceholder;
}

export interface LocalRecordingManifest {
  recordingId: string;
  sourceKind: LocalRecordingSourceKind;
  selectedMimeType: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  status: LocalRecordingManifestStatus;
  chunkCount: number;
  totalBytes: number;
  latestChunkAt: number | null;
  approximateDurationMs: number | null;
  chunks: LocalRecordingChunkManifestEntry[];
  sessionId?: string;
  participantId?: string;
  role?: 'host' | 'guest';
}

export interface LocalRecordingSummary {
  recordingId: string | null;
  status: LocalRecordingManifestStatus;
  sourceKind: LocalRecordingSourceKind | null;
  selectedMimeType: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  chunkCount: number;
  totalBytes: number;
  latestChunkAt: number | null;
  latestChunkIndex: number | null;
  latestChunkSizeBytes: number | null;
  approximateDurationMs: number | null;
  previewAvailable: boolean;
  previewBlobSizeBytes: number;
  persistenceSupportStatus: LocalRecordingPersistenceSupportStatus;
  persistenceStatus: LocalRecordingPersistenceStatus;
  persistenceErrorMessage: string | null;
  persistedRecordingCount: number;
  currentRecordingPersisted: boolean;
  uploadStatus: LocalRecordingUploadStatus;
}

export interface LocalRecordingPersistenceSummary {
  supportStatus: LocalRecordingPersistenceSupportStatus;
  status: LocalRecordingPersistenceStatus;
  errorMessage: string | null;
  persistedRecordingCount: number;
  currentRecordingPersisted: boolean;
}

export interface LocalRecordingPreviewSnapshot {
  previewAvailable: boolean;
  previewBlobSizeBytes: number;
}

export interface CreateLocalRecordingManifestInput {
  recordingId: string;
  selectedMimeType: string | null;
  startedAt: number;
  sourceKind?: LocalRecordingSourceKind;
  sessionId?: string;
  participantId?: string;
  role?: 'host' | 'guest';
}

export function createLocalRecordingId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 12);

  return `local-recording-${timestamp}-${randomPart}`;
}

export function createLocalRecordingManifest({
  recordingId,
  selectedMimeType,
  startedAt,
  sourceKind = localRecordingSourceKind,
  sessionId,
  participantId,
  role,
}: CreateLocalRecordingManifestInput): LocalRecordingManifest {
  return {
    recordingId,
    sourceKind,
    selectedMimeType,
    startedAt,
    stoppedAt: null,
    status: 'recording',
    chunkCount: 0,
    totalBytes: 0,
    latestChunkAt: null,
    approximateDurationMs: 0,
    chunks: [],
    sessionId,
    participantId,
    role,
  };
}

export function appendLocalRecordingChunkManifestEntry(
  manifest: LocalRecordingManifest,
  chunk: Blob,
  capturedAt: number,
): LocalRecordingManifest {
  const chunkIndex = manifest.chunkCount;
  // Chunk indexes stay zero-based so they line up with array positions and remain stable.
  const elapsedMsFromStart = getElapsedMsFromStart(manifest.startedAt, capturedAt);
  const chunkEntry: LocalRecordingChunkManifestEntry = {
    chunkId: `${manifest.recordingId}-chunk-${String(chunkIndex).padStart(4, '0')}`,
    recordingId: manifest.recordingId,
    chunkIndex,
    mimeType: normalizeMimeType(chunk.type) ?? manifest.selectedMimeType,
    sizeBytes: chunk.size,
    capturedAt,
    elapsedMsFromStart,
    uploadStatus: 'local_only',
  };

  return {
    ...manifest,
    chunkCount: manifest.chunkCount + 1,
    totalBytes: manifest.totalBytes + chunk.size,
    latestChunkAt: capturedAt,
    approximateDurationMs: Math.max(manifest.approximateDurationMs ?? 0, elapsedMsFromStart),
    chunks: [...manifest.chunks, chunkEntry],
  };
}

export function transitionLocalRecordingManifestStatus(
  manifest: LocalRecordingManifest,
  status: LocalRecordingManifestStatus,
  referenceTime: number,
): LocalRecordingManifest {
  return {
    ...manifest,
    status,
    stoppedAt: status === 'idle' ? null : manifest.stoppedAt,
    approximateDurationMs: Math.max(
      manifest.approximateDurationMs ?? 0,
      getElapsedMsFromStart(manifest.startedAt, referenceTime),
    ),
  };
}

export function finalizeLocalRecordingManifest(
  manifest: LocalRecordingManifest,
  stoppedAt: number,
): LocalRecordingManifest {
  return {
    ...manifest,
    status: 'stopped',
    stoppedAt,
    approximateDurationMs: Math.max(
      manifest.approximateDurationMs ?? 0,
      getElapsedMsFromStart(manifest.startedAt, stoppedAt),
    ),
  };
}

export function markLocalRecordingManifestFailed(
  manifest: LocalRecordingManifest,
  failedAt: number,
): LocalRecordingManifest {
  return {
    ...manifest,
    status: 'failed',
    stoppedAt: manifest.stoppedAt ?? failedAt,
    approximateDurationMs: Math.max(
      manifest.approximateDurationMs ?? 0,
      getElapsedMsFromStart(manifest.startedAt, failedAt),
    ),
  };
}

export function buildLocalRecordingSummary(
  manifest: LocalRecordingManifest | null,
  preview: LocalRecordingPreviewSnapshot,
  fallbackStatus: LocalRecordingManifestStatus,
  persistence: LocalRecordingPersistenceSummary = {
    supportStatus: 'not_checked',
    status: 'not_checked',
    errorMessage: null,
    persistedRecordingCount: 0,
    currentRecordingPersisted: false,
  },
): LocalRecordingSummary {
  const latestChunk = manifest?.chunks.at(-1) ?? null;

  return {
    recordingId: manifest?.recordingId ?? null,
    status: manifest?.status ?? fallbackStatus,
    sourceKind: manifest?.sourceKind ?? null,
    selectedMimeType: manifest?.selectedMimeType ?? null,
    startedAt: manifest?.startedAt ?? null,
    stoppedAt: manifest?.stoppedAt ?? null,
    chunkCount: manifest?.chunkCount ?? 0,
    totalBytes: manifest?.totalBytes ?? 0,
    latestChunkAt: manifest?.latestChunkAt ?? null,
    latestChunkIndex: latestChunk?.chunkIndex ?? null,
    latestChunkSizeBytes: latestChunk?.sizeBytes ?? null,
    approximateDurationMs: manifest?.approximateDurationMs ?? null,
    previewAvailable: preview.previewAvailable,
    previewBlobSizeBytes: preview.previewBlobSizeBytes,
    persistenceSupportStatus: persistence.supportStatus,
    persistenceStatus: persistence.status,
    persistenceErrorMessage: persistence.errorMessage,
    persistedRecordingCount: persistence.persistedRecordingCount,
    currentRecordingPersisted: persistence.currentRecordingPersisted,
    uploadStatus: 'not_implemented',
  };
}

function normalizeMimeType(mimeType: string | null | undefined): string | null {
  const trimmedMimeType = mimeType?.trim();

  return trimmedMimeType ? trimmedMimeType : null;
}

function getElapsedMsFromStart(startedAt: number | null, currentTime: number): number {
  if (startedAt === null) {
    return 0;
  }

  return Math.max(0, currentTime - startedAt);
}
