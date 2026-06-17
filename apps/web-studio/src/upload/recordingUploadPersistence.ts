import type {
  ChunkUploadStatus,
  RecordingUploadState,
  RecordingUploadStatus,
  UploadChunkState,
  UploadRetryState,
} from './recordingUploadState';

const uploadQueueDatabaseName = 'dna-studio-upload-queue';
const uploadQueueDatabaseVersion = 1;
const uploadSessionsStoreName = 'upload_sessions';
const uploadChunksStoreName = 'upload_chunks';
const uploadChunksByRecordingIdIndexName = 'byRecordingId';

export interface UploadQueuePersistenceSummary {
  uploadSessionCount: number;
  uploadChunkCount: number;
  totalExpectedBytes: number;
  totalUploadedBytes: number;
  latestUpdatedAt: number | null;
}

interface PersistedRecordingUploadSessionRecord {
  recordingId: string;
  uploadId: string | null;
  status: RecordingUploadStatus;
  expectedChunkCount: number;
  expectedTotalBytes: number;
  uploadedChunkCount: number;
  uploadedBytes: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  errorMessage: string | null;
  retryAttemptCount: number;
  retryLastAttemptAt: number | null;
  retryNextRetryAt: number | null;
  retryLastErrorMessage: string | null;
}

interface PersistedUploadChunkRecord {
  id: string;
  recordingId: string;
  uploadId: string | null;
  chunkIndex: number;
  expectedBytes: number;
  uploadedBytes: number;
  status: ChunkUploadStatus;
  lastUpdatedAt: number;
  errorMessage: string | null;
}

interface StoredRecordingUploadSessionRecord extends PersistedRecordingUploadSessionRecord {}

interface StoredUploadChunkRecord extends PersistedUploadChunkRecord {}

let uploadQueueDatabasePromise: Promise<IDBDatabase> | null = null;

export function isUploadQueuePersistenceSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

export async function saveRecordingUploadState(state: RecordingUploadState): Promise<void> {
  if (!isUploadQueuePersistenceSupported()) {
    return;
  }

  const database = await getUploadQueueDatabase();
  const transaction = database.transaction(
    [uploadSessionsStoreName, uploadChunksStoreName],
    'readwrite',
  );
  const sessionsStore = transaction.objectStore(uploadSessionsStoreName);
  const chunksStore = transaction.objectStore(uploadChunksStoreName);
  const chunksByRecordingIdIndex = chunksStore.index(uploadChunksByRecordingIdIndexName);
  const normalizedState = normalizeRecordingUploadState(state);

  const existingChunkKeys = await requestToPromise<IDBValidKey[]>(
    chunksByRecordingIdIndex.getAllKeys(IDBKeyRange.only(normalizedState.recordingId)),
  );

  sessionsStore.put(createPersistedRecordingUploadSessionRecord(normalizedState));

  for (const chunkKey of existingChunkKeys) {
    chunksStore.delete(chunkKey);
  }

  for (const chunk of normalizedState.chunks) {
    chunksStore.put(createPersistedUploadChunkRecord(normalizedState, chunk));
  }

  await transactionDone(transaction);
}

export async function getPersistedRecordingUploadState(
  recordingId: string,
): Promise<RecordingUploadState | null> {
  if (!isUploadQueuePersistenceSupported()) {
    return null;
  }

  const database = await getUploadQueueDatabase();
  const transaction = database.transaction(
    [uploadSessionsStoreName, uploadChunksStoreName],
    'readonly',
  );
  const sessionsStore = transaction.objectStore(uploadSessionsStoreName);
  const chunksStore = transaction.objectStore(uploadChunksStoreName);
  const chunksByRecordingIdIndex = chunksStore.index(uploadChunksByRecordingIdIndexName);

  const [sessionRecord, chunkRecords] = await Promise.all([
    requestToPromise<StoredRecordingUploadSessionRecord | undefined>(sessionsStore.get(recordingId)),
    requestToPromise<StoredUploadChunkRecord[]>(
      chunksByRecordingIdIndex.getAll(IDBKeyRange.only(recordingId)),
    ),
  ]);

  await transactionDone(transaction);

  if (sessionRecord === undefined) {
    return null;
  }

  return rebuildRecordingUploadState(sessionRecord, chunkRecords);
}

export async function listPersistedRecordingUploadStates(): Promise<RecordingUploadState[]> {
  if (!isUploadQueuePersistenceSupported()) {
    return [];
  }

  const database = await getUploadQueueDatabase();
  const transaction = database.transaction(
    [uploadSessionsStoreName, uploadChunksStoreName],
    'readonly',
  );
  const sessionsStore = transaction.objectStore(uploadSessionsStoreName);
  const chunksStore = transaction.objectStore(uploadChunksStoreName);

  const [sessionRecords, chunkRecords] = await Promise.all([
    requestToPromise<StoredRecordingUploadSessionRecord[]>(sessionsStore.getAll()),
    requestToPromise<StoredUploadChunkRecord[]>(chunksStore.getAll()),
  ]);

  await transactionDone(transaction);

  const chunkRecordsByRecordingId = groupUploadChunkRecordsByRecordingId(chunkRecords);

  return sessionRecords
    .map((sessionRecord) =>
      rebuildRecordingUploadState(
        sessionRecord,
        chunkRecordsByRecordingId.get(sessionRecord.recordingId) ?? [],
      ),
    )
    .sort(compareRecordingUploadStates);
}

export async function deletePersistedRecordingUploadState(recordingId: string): Promise<void> {
  if (!isUploadQueuePersistenceSupported()) {
    return;
  }

  const database = await getUploadQueueDatabase();
  const transaction = database.transaction(
    [uploadSessionsStoreName, uploadChunksStoreName],
    'readwrite',
  );
  const sessionsStore = transaction.objectStore(uploadSessionsStoreName);
  const chunksStore = transaction.objectStore(uploadChunksStoreName);
  const chunksByRecordingIdIndex = chunksStore.index(uploadChunksByRecordingIdIndexName);

  const chunkKeys = await requestToPromise<IDBValidKey[]>(
    chunksByRecordingIdIndex.getAllKeys(IDBKeyRange.only(recordingId)),
  );

  sessionsStore.delete(recordingId);

  for (const chunkKey of chunkKeys) {
    chunksStore.delete(chunkKey);
  }

  await transactionDone(transaction);
}

export async function deleteAllPersistedRecordingUploadStates(): Promise<void> {
  if (!isUploadQueuePersistenceSupported()) {
    return;
  }

  const database = await getUploadQueueDatabase();
  const transaction = database.transaction(
    [uploadSessionsStoreName, uploadChunksStoreName],
    'readwrite',
  );

  transaction.objectStore(uploadSessionsStoreName).clear();
  transaction.objectStore(uploadChunksStoreName).clear();

  await transactionDone(transaction);
}

export async function getPersistedUploadQueueSummary(): Promise<UploadQueuePersistenceSummary> {
  if (!isUploadQueuePersistenceSupported()) {
    return {
      uploadSessionCount: 0,
      uploadChunkCount: 0,
      totalExpectedBytes: 0,
      totalUploadedBytes: 0,
      latestUpdatedAt: null,
    };
  }

  const database = await getUploadQueueDatabase();
  const transaction = database.transaction(
    [uploadSessionsStoreName, uploadChunksStoreName],
    'readonly',
  );
  const sessionsStore = transaction.objectStore(uploadSessionsStoreName);
  const chunksStore = transaction.objectStore(uploadChunksStoreName);

  const [sessionRecords, chunkRecords] = await Promise.all([
    requestToPromise<StoredRecordingUploadSessionRecord[]>(sessionsStore.getAll()),
    requestToPromise<StoredUploadChunkRecord[]>(chunksStore.getAll()),
  ]);

  await transactionDone(transaction);

  let totalExpectedBytes = 0;
  let totalUploadedBytes = 0;
  let latestUpdatedAt: number | null = null;

  for (const sessionRecord of sessionRecords) {
    totalExpectedBytes += normalizeNonNegativeInteger(sessionRecord.expectedTotalBytes);
    latestUpdatedAt = getLatestTimestamp(latestUpdatedAt, sessionRecord.updatedAt);
    latestUpdatedAt = getLatestTimestamp(latestUpdatedAt, sessionRecord.createdAt);
  }

  for (const chunkRecord of chunkRecords) {
    totalUploadedBytes += isCompletedUploadChunkStatus(chunkRecord.status)
      ? normalizeNonNegativeInteger(chunkRecord.uploadedBytes)
      : 0;
    latestUpdatedAt = getLatestTimestamp(latestUpdatedAt, chunkRecord.lastUpdatedAt);
  }

  return {
    uploadSessionCount: sessionRecords.length,
    uploadChunkCount: chunkRecords.length,
    totalExpectedBytes,
    totalUploadedBytes,
    latestUpdatedAt,
  };
}

async function getUploadQueueDatabase(): Promise<IDBDatabase> {
  if (uploadQueueDatabasePromise !== null) {
    return uploadQueueDatabasePromise;
  }

  uploadQueueDatabasePromise = openUploadQueueDatabase().catch((error) => {
    uploadQueueDatabasePromise = null;
    throw error;
  });

  return uploadQueueDatabasePromise;
}

function openUploadQueueDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isUploadQueuePersistenceSupported()) {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }

    const request = window.indexedDB.open(uploadQueueDatabaseName, uploadQueueDatabaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(uploadSessionsStoreName)) {
        database.createObjectStore(uploadSessionsStoreName, { keyPath: 'recordingId' });
      }

      if (!database.objectStoreNames.contains(uploadChunksStoreName)) {
        const chunkStore = database.createObjectStore(uploadChunksStoreName, { keyPath: 'id' });
        chunkStore.createIndex(uploadChunksByRecordingIdIndexName, 'recordingId', {
          unique: false,
        });
      }
    };

    request.onblocked = () => {
      reject(new Error('IndexedDB upgrade was blocked by another connection.'));
    };

    request.onerror = () => {
      reject(
        request.error ??
          new Error('IndexedDB persistence is available but the upload queue database could not be opened.'),
      );
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function rebuildRecordingUploadState(
  sessionRecord: StoredRecordingUploadSessionRecord,
  chunkRecords: readonly StoredUploadChunkRecord[],
): RecordingUploadState {
  const chunks = [...chunkRecords]
    .sort(compareUploadChunkRecords)
    .map((chunkRecord) => createUploadChunkState(chunkRecord));
  const uploadedChunkSummary = summarizePersistedUploadChunks(chunks);

  return {
    recordingId: sessionRecord.recordingId,
    uploadId: sessionRecord.uploadId,
    status: sessionRecord.status,
    expectedChunkCount: normalizeNonNegativeInteger(sessionRecord.expectedChunkCount),
    expectedTotalBytes: normalizeNonNegativeInteger(sessionRecord.expectedTotalBytes),
    uploadedChunkCount: uploadedChunkSummary.uploadedChunkCount,
    uploadedBytes: uploadedChunkSummary.uploadedBytes,
    chunks,
    retry: createUploadRetryState(sessionRecord),
    createdAt: normalizeTimestamp(sessionRecord.createdAt) ?? 0,
    updatedAt: normalizeTimestamp(sessionRecord.updatedAt) ?? 0,
    completedAt: normalizeNullableTimestamp(sessionRecord.completedAt),
    errorMessage: sessionRecord.errorMessage,
  };
}

function createPersistedRecordingUploadSessionRecord(
  state: RecordingUploadState,
): PersistedRecordingUploadSessionRecord {
  const chunkSummary = summarizePersistedUploadChunks(state.chunks);

  return {
    recordingId: state.recordingId,
    uploadId: state.uploadId,
    status: state.status,
    expectedChunkCount: normalizeNonNegativeInteger(state.expectedChunkCount),
    expectedTotalBytes: normalizeNonNegativeInteger(state.expectedTotalBytes),
    uploadedChunkCount: chunkSummary.uploadedChunkCount,
    uploadedBytes: chunkSummary.uploadedBytes,
    createdAt: normalizeTimestamp(state.createdAt) ?? 0,
    updatedAt: normalizeTimestamp(state.updatedAt) ?? 0,
    completedAt: normalizeNullableTimestamp(state.completedAt),
    errorMessage: state.errorMessage,
    retryAttemptCount: normalizeNonNegativeInteger(state.retry.attemptCount),
    retryLastAttemptAt: normalizeNullableTimestamp(state.retry.lastAttemptAt),
    retryNextRetryAt: normalizeNullableTimestamp(state.retry.nextRetryAt),
    retryLastErrorMessage: state.retry.lastErrorMessage,
  };
}

function createPersistedUploadChunkRecord(
  state: RecordingUploadState,
  chunk: UploadChunkState,
): PersistedUploadChunkRecord {
  const chunkIndex = normalizeNonNegativeInteger(chunk.chunkIndex);

  return {
    id: `${state.recordingId}:${chunkIndex}`,
    recordingId: state.recordingId,
    uploadId: state.uploadId,
    chunkIndex,
    expectedBytes: normalizeNonNegativeInteger(chunk.expectedBytes),
    uploadedBytes: normalizeNonNegativeInteger(chunk.uploadedBytes),
    status: chunk.status,
    lastUpdatedAt: normalizeTimestamp(chunk.lastUpdatedAt) ?? normalizeTimestamp(state.updatedAt) ?? 0,
    errorMessage: chunk.errorMessage,
  };
}

function createUploadChunkState(chunkRecord: StoredUploadChunkRecord): UploadChunkState {
  return {
    chunkIndex: normalizeNonNegativeInteger(chunkRecord.chunkIndex),
    expectedBytes: normalizeNonNegativeInteger(chunkRecord.expectedBytes),
    uploadedBytes: normalizeNonNegativeInteger(chunkRecord.uploadedBytes),
    status: chunkRecord.status,
    lastUpdatedAt: normalizeTimestamp(chunkRecord.lastUpdatedAt) ?? 0,
    errorMessage: chunkRecord.errorMessage,
  };
}

function createUploadRetryState(
  sessionRecord: StoredRecordingUploadSessionRecord,
): UploadRetryState {
  return {
    attemptCount: normalizeNonNegativeInteger(sessionRecord.retryAttemptCount),
    lastAttemptAt: normalizeNullableTimestamp(sessionRecord.retryLastAttemptAt),
    nextRetryAt: normalizeNullableTimestamp(sessionRecord.retryNextRetryAt),
    lastErrorMessage: sessionRecord.retryLastErrorMessage,
  };
}

function summarizePersistedUploadChunks(chunks: readonly UploadChunkState[]): {
  uploadedChunkCount: number;
  uploadedBytes: number;
} {
  let uploadedChunkCount = 0;
  let uploadedBytes = 0;

  for (const chunk of chunks) {
    if (!isCompletedUploadChunkStatus(chunk.status)) {
      continue;
    }

    uploadedChunkCount += 1;
    uploadedBytes += normalizeNonNegativeInteger(chunk.uploadedBytes);
  }

  return {
    uploadedChunkCount,
    uploadedBytes,
  };
}

function groupUploadChunkRecordsByRecordingId(
  chunkRecords: readonly StoredUploadChunkRecord[],
): Map<string, StoredUploadChunkRecord[]> {
  const chunkRecordsByRecordingId = new Map<string, StoredUploadChunkRecord[]>();

  for (const chunkRecord of chunkRecords) {
    const groupedChunkRecords = chunkRecordsByRecordingId.get(chunkRecord.recordingId) ?? [];
    groupedChunkRecords.push(chunkRecord);
    chunkRecordsByRecordingId.set(chunkRecord.recordingId, groupedChunkRecords);
  }

  return chunkRecordsByRecordingId;
}

function compareRecordingUploadStates(
  left: RecordingUploadState,
  right: RecordingUploadState,
): number {
  return (
    compareNumbersDescending(left.updatedAt, right.updatedAt) ||
    compareNumbersDescending(left.createdAt, right.createdAt) ||
    left.recordingId.localeCompare(right.recordingId)
  );
}

function compareUploadChunkRecords(
  left: StoredUploadChunkRecord,
  right: StoredUploadChunkRecord,
): number {
  return (
    left.chunkIndex - right.chunkIndex ||
    compareNumbersAscending(left.lastUpdatedAt, right.lastUpdatedAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareNumbersAscending(left: number | null, right: number | null): number {
  const normalizedLeft = normalizeTimestamp(left);
  const normalizedRight = normalizeTimestamp(right);

  if (normalizedLeft === null && normalizedRight === null) {
    return 0;
  }

  if (normalizedLeft === null) {
    return -1;
  }

  if (normalizedRight === null) {
    return 1;
  }

  return normalizedLeft - normalizedRight;
}

function compareNumbersDescending(left: number | null, right: number | null): number {
  return compareNumbersAscending(right, left);
}

function getLatestTimestamp(currentLatest: number | null, candidate: number | null): number | null {
  const normalizedCandidate = normalizeTimestamp(candidate);

  if (normalizedCandidate === null) {
    return currentLatest;
  }

  if (currentLatest === null) {
    return normalizedCandidate;
  }

  return Math.max(currentLatest, normalizedCandidate);
}

function isCompletedUploadChunkStatus(status: ChunkUploadStatus): boolean {
  return status === 'uploaded' || status === 'already_present';
}

function normalizeRecordingUploadState(state: RecordingUploadState): RecordingUploadState {
  return {
    ...state,
    expectedChunkCount: normalizeNonNegativeInteger(state.expectedChunkCount),
    expectedTotalBytes: normalizeNonNegativeInteger(state.expectedTotalBytes),
    uploadedChunkCount: normalizeNonNegativeInteger(state.uploadedChunkCount),
    uploadedBytes: normalizeNonNegativeInteger(state.uploadedBytes),
    chunks: [...state.chunks],
    retry: normalizeUploadRetryState(state.retry),
    createdAt: normalizeTimestamp(state.createdAt) ?? 0,
    updatedAt: normalizeTimestamp(state.updatedAt) ?? 0,
    completedAt: normalizeNullableTimestamp(state.completedAt),
  };
}

function normalizeUploadRetryState(retry: UploadRetryState): UploadRetryState {
  return {
    attemptCount: normalizeNonNegativeInteger(retry.attemptCount),
    lastAttemptAt: normalizeNullableTimestamp(retry.lastAttemptAt),
    nextRetryAt: normalizeNullableTimestamp(retry.nextRetryAt),
    lastErrorMessage: retry.lastErrorMessage,
  };
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

function normalizeNullableTimestamp(value: number | null | undefined): number | null {
  return normalizeTimestamp(value);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ??
          new Error('IndexedDB request failed while persisting the upload queue.'),
      );
    };
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onabort = () => {
      reject(
        transaction.error ??
          new Error('IndexedDB transaction aborted while persisting the upload queue.'),
      );
    };

    transaction.onerror = () => {
      reject(
        transaction.error ??
          new Error('IndexedDB transaction failed while persisting the upload queue.'),
      );
    };
  });
}
