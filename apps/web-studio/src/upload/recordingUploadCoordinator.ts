import type {
  PersistedLocalRecordingChunkRecord,
  PersistedLocalRecordingRecord,
} from '../recording/recordingPersistence';
import {
  markChunkAlreadyPresent,
  markChunkUploaded,
  createInitialRecordingUploadState,
  markRecordingUploadFailed,
  setRecordingUploadRetrying,
  type RecordingUploadState,
  type RecordingUploadStatus,
} from './recordingUploadState';

export interface ResolveRecordingUploadStartStateInput {
  recording: PersistedLocalRecordingRecord;
  existingState: RecordingUploadState | null;
  resumeExisting: boolean;
  now: number;
}

export interface ResolveRecordingUploadStartStateResult {
  state: RecordingUploadState;
  shouldResetPersistedState: boolean;
}

export interface DeriveServerConfirmedUploadChunkIndexesInput {
  expectedChunkCount: number;
  missingChunkIndexes: number[];
  rejectedChunkIndexes: number[];
}

export interface BuildLocalRecordingChunkSizeByIndexInput {
  chunks: readonly PersistedLocalRecordingChunkRecord[];
}

export interface ApplyRecordingUploadChunkResponseInput {
  state: RecordingUploadState;
  chunkIndex: number;
  uploadedBytes: number;
  alreadyPresent: boolean;
  now: number;
}

export interface ApplyRecordingUploadFailureResponseInput {
  state: RecordingUploadState;
  errorMessage: string;
  retryable: boolean;
  now: number;
}

export function resolveRecordingUploadStartState(
  input: ResolveRecordingUploadStartStateInput,
): ResolveRecordingUploadStartStateResult {
  const shouldStartFresh =
    !input.resumeExisting || input.existingState === null || input.existingState.status === 'canceled';

  if (shouldStartFresh) {
    return {
      state: createInitialRecordingUploadState({
        recordingId: input.recording.recordingId,
        sessionId: input.recording.manifest.sessionId ?? null,
        participantId: input.recording.manifest.participantId ?? null,
        role: input.recording.manifest.role ?? null,
        expectedChunkCount: input.recording.manifest.chunkCount,
        expectedTotalBytes: input.recording.manifest.totalBytes,
        now: input.now,
      }),
      shouldResetPersistedState: input.existingState !== null,
    };
  }

  return {
    state: input.existingState!,
    shouldResetPersistedState: false,
  };
}

export function deriveServerConfirmedUploadChunkIndexes(
  input: DeriveServerConfirmedUploadChunkIndexesInput,
): number[] {
  const missingChunkIndexes = new Set(normalizeChunkIndexes(input.missingChunkIndexes));
  const rejectedChunkIndexes = new Set(normalizeChunkIndexes(input.rejectedChunkIndexes));
  const confirmedChunkIndexes: number[] = [];

  for (let chunkIndex = 0; chunkIndex < Math.max(0, Math.trunc(input.expectedChunkCount)); chunkIndex += 1) {
    if (missingChunkIndexes.has(chunkIndex) || rejectedChunkIndexes.has(chunkIndex)) {
      continue;
    }

    confirmedChunkIndexes.push(chunkIndex);
  }

  return confirmedChunkIndexes;
}

export function buildLocalRecordingChunkSizeByIndex(
  input: BuildLocalRecordingChunkSizeByIndexInput,
): Record<number, number> {
  const chunkSizeByIndex: Record<number, number> = {};

  for (const chunk of input.chunks) {
    chunkSizeByIndex[chunk.chunkEntry.chunkIndex] = chunk.blob.size;
  }

  return chunkSizeByIndex;
}

export function canApplyLateUploadResponse(status: RecordingUploadStatus): boolean {
  return status !== 'paused' && status !== 'canceled' && status !== 'uploaded';
}

export function applyRecordingUploadChunkResponse(
  input: ApplyRecordingUploadChunkResponseInput,
): RecordingUploadState {
  if (!canApplyLateUploadResponse(input.state.status)) {
    return input.state;
  }

  return input.alreadyPresent
    ? markChunkAlreadyPresent(input.state, input.chunkIndex, input.uploadedBytes, input.now)
    : markChunkUploaded(input.state, input.chunkIndex, input.uploadedBytes, input.now);
}

export function applyRecordingUploadFailureResponse(
  input: ApplyRecordingUploadFailureResponseInput,
): RecordingUploadState {
  if (!canApplyLateUploadResponse(input.state.status)) {
    return input.state;
  }

  return input.retryable
    ? setRecordingUploadRetrying(input.state, input.now)
    : markRecordingUploadFailed(input.state, input.errorMessage, input.now);
}

function normalizeChunkIndexes(chunkIndexes: readonly number[]): number[] {
  return chunkIndexes
    .map((chunkIndex) => Math.trunc(chunkIndex))
    .filter((chunkIndex) => Number.isInteger(chunkIndex) && chunkIndex >= 0);
}
