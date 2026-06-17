export type RecordingUploadStatus =
  | 'not_started'
  | 'initializing'
  | 'ready'
  | 'uploading'
  | 'paused'
  | 'retrying'
  | 'incomplete'
  | 'uploaded'
  | 'failed'
  | 'canceled';

export type ChunkUploadStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'already_present'
  | 'failed'
  | 'rejected';

export interface UploadRetryState {
  attemptCount: number;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  lastErrorMessage: string | null;
}

export interface UploadChunkState {
  chunkIndex: number;
  expectedBytes: number;
  uploadedBytes: number;
  status: ChunkUploadStatus;
  lastUpdatedAt: number;
  errorMessage: string | null;
}

export interface RecordingUploadState {
  recordingId: string;
  uploadId: string | null;
  status: RecordingUploadStatus;
  expectedChunkCount: number;
  expectedTotalBytes: number;
  uploadedChunkCount: number;
  uploadedBytes: number;
  chunks: UploadChunkState[];
  retry: UploadRetryState;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  errorMessage: string | null;
}

export interface UploadProgressSummary {
  expectedChunkCount: number;
  uploadedChunkCount: number;
  failedChunkCount: number;
  pendingChunkCount: number;
  expectedTotalBytes: number;
  uploadedBytes: number;
  percentComplete: number;
}

export interface CreateInitialRecordingUploadStateInput {
  recordingId: string;
  expectedChunkCount: number;
  expectedTotalBytes: number;
  now?: number;
}

export interface SetRecordingUploadSessionReadyInput {
  uploadId: string;
  now: number;
}

const terminalUploadStatuses: readonly RecordingUploadStatus[] = ['uploaded', 'canceled'];

export function createInitialRecordingUploadState(
  input: CreateInitialRecordingUploadStateInput,
): RecordingUploadState {
  const createdAt = normalizeTimestamp(input.now) ?? 0;
  const expectedChunkCount = normalizeNonNegativeInteger(input.expectedChunkCount);
  const expectedTotalBytes = normalizeNonNegativeInteger(input.expectedTotalBytes);

  return {
    recordingId: normalizeTextValue(input.recordingId) ?? input.recordingId,
    uploadId: null,
    status: 'not_started',
    expectedChunkCount,
    expectedTotalBytes,
    uploadedChunkCount: 0,
    uploadedBytes: 0,
    chunks: createPendingUploadChunks(expectedChunkCount, createdAt),
    retry: createInitialUploadRetryState(),
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    errorMessage: null,
  };
}

export function summarizeRecordingUploadProgress(
  state: RecordingUploadState,
): UploadProgressSummary {
  const aggregates = summarizeUploadChunks(state.chunks);
  const percentComplete = calculatePercentComplete(
    aggregates.uploadedBytes,
    state.expectedTotalBytes,
  );

  return {
    expectedChunkCount: state.expectedChunkCount,
    uploadedChunkCount: aggregates.uploadedChunkCount,
    failedChunkCount: aggregates.failedChunkCount,
    pendingChunkCount: aggregates.pendingChunkCount,
    expectedTotalBytes: state.expectedTotalBytes,
    uploadedBytes: aggregates.uploadedBytes,
    percentComplete,
  };
}

export function setRecordingUploadSessionReady(
  state: RecordingUploadState,
  input: SetRecordingUploadSessionReadyInput,
): RecordingUploadState {
  if (isTerminalUploadState(state.status)) {
    return state;
  }

  const updatedAt = normalizeTimestamp(input.now) ?? state.updatedAt;

  return rebuildRecordingUploadState(state, {
    uploadId: normalizeTextValue(input.uploadId) ?? input.uploadId,
    status: 'ready',
    updatedAt,
    completedAt: null,
    errorMessage: null,
  });
}

export function markChunkUploading(
  state: RecordingUploadState,
  chunkIndex: number,
  now: number,
): RecordingUploadState {
  return updateRecordingUploadChunkState(state, chunkIndex, now, (chunk) => ({
    ...chunk,
    status: 'uploading',
    lastUpdatedAt: normalizeTimestamp(now) ?? state.updatedAt,
    errorMessage: null,
  }));
}

export function markChunkUploaded(
  state: RecordingUploadState,
  chunkIndex: number,
  uploadedBytes: number,
  now: number,
): RecordingUploadState {
  return updateRecordingUploadChunkState(state, chunkIndex, now, (chunk) => {
    const normalizedUploadedBytes = normalizeNonNegativeInteger(uploadedBytes);

    return {
      ...chunk,
      status: 'uploaded',
      expectedBytes: Math.max(chunk.expectedBytes, normalizedUploadedBytes),
      uploadedBytes: normalizedUploadedBytes,
      lastUpdatedAt: normalizeTimestamp(now) ?? state.updatedAt,
      errorMessage: null,
    };
  });
}

export function markChunkAlreadyPresent(
  state: RecordingUploadState,
  chunkIndex: number,
  uploadedBytes: number,
  now: number,
): RecordingUploadState {
  return updateRecordingUploadChunkState(state, chunkIndex, now, (chunk) => {
    const normalizedUploadedBytes = normalizeNonNegativeInteger(uploadedBytes);

    return {
      ...chunk,
      status: 'already_present',
      expectedBytes: Math.max(chunk.expectedBytes, normalizedUploadedBytes),
      uploadedBytes: normalizedUploadedBytes,
      lastUpdatedAt: normalizeTimestamp(now) ?? state.updatedAt,
      errorMessage: null,
    };
  });
}

export function markChunkFailed(
  state: RecordingUploadState,
  chunkIndex: number,
  errorMessage: string,
  now: number,
): RecordingUploadState {
  if (isTerminalUploadState(state.status)) {
    return state;
  }

  const normalizedErrorMessage = normalizeTextValue(errorMessage) ?? 'Upload chunk failed.';
  const updatedAt = normalizeTimestamp(now) ?? state.updatedAt;

  const nextState = updateRecordingUploadChunkState(state, chunkIndex, now, (chunk) => ({
    ...chunk,
    status: 'failed',
    lastUpdatedAt: updatedAt,
    errorMessage: normalizedErrorMessage,
  }));

  const hasInFlightChunks = nextState.chunks.some((chunk) =>
    chunk.status === 'pending' || chunk.status === 'uploading',
  );

  return rebuildRecordingUploadState(nextState, {
    status: hasInFlightChunks ? 'incomplete' : 'failed',
    updatedAt,
    completedAt: null,
    errorMessage: normalizedErrorMessage,
    retry: {
      attemptCount: nextState.retry.attemptCount + 1,
      lastAttemptAt: updatedAt,
      nextRetryAt: null,
      lastErrorMessage: normalizedErrorMessage,
    },
  });
}

export function markRecordingUploadComplete(
  state: RecordingUploadState,
  now: number,
): RecordingUploadState {
  if (isTerminalUploadState(state.status)) {
    return state;
  }

  const updatedAt = normalizeTimestamp(now) ?? state.updatedAt;
  const isComplete = state.chunks.every((chunk) => isUploadedChunkStatus(chunk.status));

  return rebuildRecordingUploadState(state, {
    status: isComplete ? 'uploaded' : 'incomplete',
    updatedAt,
    completedAt: isComplete ? updatedAt : null,
    errorMessage: isComplete ? null : state.errorMessage,
  });
}

export function markRecordingUploadCanceled(
  state: RecordingUploadState,
  now: number,
): RecordingUploadState {
  if (isTerminalUploadState(state.status)) {
    return state;
  }

  const updatedAt = normalizeTimestamp(now) ?? state.updatedAt;

  return rebuildRecordingUploadState(state, {
    status: 'canceled',
    updatedAt,
    completedAt: null,
    errorMessage: null,
  });
}

export function getMissingUploadChunkIndexes(state: RecordingUploadState): number[] {
  return state.chunks
    .filter((chunk) => !isUploadedChunkStatus(chunk.status))
    .map((chunk) => chunk.chunkIndex);
}

function createInitialUploadRetryState(): UploadRetryState {
  return {
    attemptCount: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    lastErrorMessage: null,
  };
}

function createPendingUploadChunks(
  expectedChunkCount: number,
  createdAt: number,
): UploadChunkState[] {
  const chunks: UploadChunkState[] = [];

  for (let chunkIndex = 0; chunkIndex < expectedChunkCount; chunkIndex += 1) {
    chunks.push({
      chunkIndex,
      expectedBytes: 0,
      uploadedBytes: 0,
      status: 'pending',
      lastUpdatedAt: createdAt,
      errorMessage: null,
    });
  }

  return chunks;
}

function updateRecordingUploadChunkState(
  state: RecordingUploadState,
  chunkIndex: number,
  now: number,
  update: (chunk: UploadChunkState) => UploadChunkState,
): RecordingUploadState {
  if (isTerminalUploadState(state.status)) {
    return state;
  }

  const chunkPosition = state.chunks.findIndex((chunk) => chunk.chunkIndex === chunkIndex);
  if (chunkPosition === -1) {
    return state;
  }

  const updatedChunks = [...state.chunks];
  updatedChunks[chunkPosition] = update(updatedChunks[chunkPosition]);

  return rebuildRecordingUploadState(state, {
    chunks: updatedChunks,
    status: 'uploading',
    updatedAt: normalizeTimestamp(now) ?? state.updatedAt,
    errorMessage: null,
    completedAt: null,
  });
}

function rebuildRecordingUploadState(
  state: RecordingUploadState,
  overrides: Partial<RecordingUploadState> = {},
): RecordingUploadState {
  const chunks = overrides.chunks ?? state.chunks;
  const aggregates = summarizeUploadChunks(chunks);

  return {
    ...state,
    ...overrides,
    chunks,
    uploadedChunkCount: aggregates.uploadedChunkCount,
    uploadedBytes: aggregates.uploadedBytes,
  };
}

function summarizeUploadChunks(chunks: readonly UploadChunkState[]): {
  uploadedChunkCount: number;
  failedChunkCount: number;
  pendingChunkCount: number;
  uploadedBytes: number;
} {
  let uploadedChunkCount = 0;
  let failedChunkCount = 0;
  let pendingChunkCount = 0;
  let uploadedBytes = 0;

  for (const chunk of chunks) {
    if (isUploadedChunkStatus(chunk.status)) {
      uploadedChunkCount += 1;
      uploadedBytes += normalizeNonNegativeInteger(chunk.uploadedBytes);
      continue;
    }

    if (isFailedChunkStatus(chunk.status)) {
      failedChunkCount += 1;
      continue;
    }

    pendingChunkCount += 1;
  }

  return {
    uploadedChunkCount,
    failedChunkCount,
    pendingChunkCount,
    uploadedBytes,
  };
}

function calculatePercentComplete(uploadedBytes: number, expectedTotalBytes: number): number {
  if (expectedTotalBytes <= 0) {
    return 0;
  }

  const rawPercent = (normalizeNonNegativeInteger(uploadedBytes) / expectedTotalBytes) * 100;

  if (!Number.isFinite(rawPercent) || rawPercent <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, rawPercent));
}

function isUploadedChunkStatus(status: ChunkUploadStatus): boolean {
  return status === 'uploaded' || status === 'already_present';
}

function isFailedChunkStatus(status: ChunkUploadStatus): boolean {
  return status === 'failed' || status === 'rejected';
}

function isTerminalUploadState(status: RecordingUploadStatus): boolean {
  return terminalUploadStatuses.includes(status);
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.trunc(value);
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

function normalizeTextValue(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim();
  return trimmedValue === undefined || trimmedValue === '' ? null : trimmedValue;
}
