import type {
  LocalRecordingChunkManifestEntry,
  LocalRecordingManifest,
} from './recordingManifest';
import {
  createLocalRecordingIntegrityReport,
  createUnknownLocalRecordingIntegrityReport,
  type LocalRecordingIntegrityReport,
} from './recordingIntegrity';

const localRecordingDatabaseName = 'dna-studio-local-recordings';
const localRecordingDatabaseVersion = 1;
const recordingsStoreName = 'recordings';
const chunksStoreName = 'chunks';
const chunksByRecordingIdIndexName = 'byRecordingId';

export type LocalRecordingPersistenceSupportState =
  | 'supported'
  | 'unavailable'
  | 'failed';

export interface LocalRecordingPersistenceSupportResult {
  state: LocalRecordingPersistenceSupportState;
  errorMessage: string | null;
}

export interface LocalRecordingStorageSummary {
  supportStatus: LocalRecordingPersistenceSupportState;
  supportErrorMessage: string | null;
  persistedRecordingCount: number;
  totalPersistedBytes: number;
  totalPersistedChunks: number;
  latestRecordingId: string | null;
  latestRecordingStartedAt: number | null;
  latestPersistedAt: number | null;
}

export interface PersistedLocalRecordingRecord {
  recordingId: string;
  manifest: LocalRecordingManifest;
  firstPersistedAt: number;
  lastPersistedAt: number;
}

interface StoredLocalRecordingRecord {
  recordingId: string;
  manifest: LocalRecordingManifest;
  firstPersistedAt: number;
  lastPersistedAt: number;
}

interface StoredLocalRecordingChunkRecord {
  chunkId: string;
  recordingId: string;
  chunkEntry: LocalRecordingChunkManifestEntry;
  blob: Blob;
  persistedAt: number;
}

export interface PersistedLocalRecordingChunkRecord {
  chunkId: string;
  recordingId: string;
  chunkEntry: LocalRecordingChunkManifestEntry;
  blob: Blob;
  persistedAt: number;
}

export interface PersistedLocalRecordingBlobResult {
  recording: PersistedLocalRecordingRecord;
  chunks: PersistedLocalRecordingChunkRecord[];
  blob: Blob;
}

export async function verifyPersistedLocalRecording(
  recordingId: string,
): Promise<LocalRecordingIntegrityReport> {
  const normalizedRecordingId = recordingId.trim();
  const checkedAt = Date.now();

  if (normalizedRecordingId === '') {
    return createUnknownLocalRecordingIntegrityReport(
      normalizedRecordingId,
      ['A recording ID is required to verify local integrity.'],
      checkedAt,
    );
  }

  const support = await getLocalRecordingPersistenceSupport();

  if (support.state === 'unavailable') {
    return createUnknownLocalRecordingIntegrityReport(
      normalizedRecordingId,
      ['IndexedDB persistence is unavailable in this browser.'],
      checkedAt,
    );
  }

  if (support.state === 'failed') {
    return createUnknownLocalRecordingIntegrityReport(
      normalizedRecordingId,
      [
        support.errorMessage ??
          'IndexedDB persistence is available but the local copy could not be verified.',
      ],
      checkedAt,
    );
  }

  try {
    const [recording, chunks] = await Promise.all([
      getPersistedLocalRecording(normalizedRecordingId),
      listPersistedLocalRecordingChunks(normalizedRecordingId),
    ]);

    if (recording === null) {
      const storedBytes = getPersistedLocalRecordingChunkBytes(chunks);
      const warnings = [
        chunks.length > 0
          ? 'Persisted chunks were found, but the manifest is missing.'
          : 'Persisted local recording could not be found.',
      ];

      return createLocalRecordingIntegrityReport({
        recordingId: normalizedRecordingId,
        expectedChunkCount: 0,
        storedChunkCount: chunks.length,
        missingChunkCount: 0,
        expectedBytes: 0,
        storedBytes,
        checkedAt,
        verificationAvailable: false,
        warnings,
      });
    }

    return buildLocalRecordingIntegrityReport({
      recording,
      chunks,
      checkedAt,
    });
  } catch (error) {
    return createUnknownLocalRecordingIntegrityReport(
      normalizedRecordingId,
      [
        getPersistenceErrorMessage(
          error,
          'IndexedDB persistence is available but the local copy could not be verified.',
        ),
      ],
      checkedAt,
    );
  }
}

export async function verifyAllPersistedLocalRecordings(): Promise<LocalRecordingIntegrityReport[]> {
  const support = await getLocalRecordingPersistenceSupport();

  if (support.state !== 'supported') {
    return [];
  }

  const recordings = await listPersistedLocalRecordings();
  return Promise.all(recordings.map((record) => verifyPersistedLocalRecording(record.recordingId)));
}

let localRecordingDatabasePromise: Promise<IDBDatabase> | null = null;
let localRecordingSupportPromise: Promise<LocalRecordingPersistenceSupportResult> | null = null;

export async function getLocalRecordingPersistenceSupport(): Promise<LocalRecordingPersistenceSupportResult> {
  if (localRecordingSupportPromise !== null) {
    return localRecordingSupportPromise;
  }

  localRecordingSupportPromise = (async () => {
    const indexedDBFactory = getIndexedDBFactory();

    if (indexedDBFactory === null) {
      return {
        state: 'unavailable',
        errorMessage: null,
      };
    }

    try {
      await getLocalRecordingDatabase();
      return {
        state: 'supported',
        errorMessage: null,
      };
    } catch (error) {
      return {
        state: 'failed',
        errorMessage: getPersistenceErrorMessage(
          error,
          'IndexedDB persistence is available in the browser but could not be opened.',
        ),
      };
    }
  })();

  return localRecordingSupportPromise;
}

export async function getLocalRecordingStorageSummary(): Promise<LocalRecordingStorageSummary> {
  const support = await getLocalRecordingPersistenceSupport();

  if (support.state === 'unavailable') {
    return {
      supportStatus: 'unavailable',
      supportErrorMessage: null,
      persistedRecordingCount: 0,
      totalPersistedBytes: 0,
      totalPersistedChunks: 0,
      latestRecordingId: null,
      latestRecordingStartedAt: null,
      latestPersistedAt: null,
    };
  }

  if (support.state === 'failed') {
    return {
      supportStatus: 'failed',
      supportErrorMessage: support.errorMessage,
      persistedRecordingCount: 0,
      totalPersistedBytes: 0,
      totalPersistedChunks: 0,
      latestRecordingId: null,
      latestRecordingStartedAt: null,
      latestPersistedAt: null,
    };
  }

  try {
    const recordings = await listPersistedLocalRecordings();
    const latestRecording = recordings[0] ?? null;
    let totalPersistedBytes = 0;
    let totalPersistedChunks = 0;

    for (const record of recordings) {
      totalPersistedBytes += record.manifest.totalBytes;
      totalPersistedChunks += record.manifest.chunkCount;
    }

    return {
      supportStatus: 'supported',
      supportErrorMessage: null,
      persistedRecordingCount: recordings.length,
      totalPersistedBytes,
      totalPersistedChunks,
      latestRecordingId: latestRecording?.recordingId ?? null,
      latestRecordingStartedAt: latestRecording?.manifest.startedAt ?? null,
      latestPersistedAt: latestRecording?.lastPersistedAt ?? null,
    };
  } catch (error) {
    return {
      supportStatus: 'failed',
      supportErrorMessage: getPersistenceErrorMessage(
        error,
        'IndexedDB persistence is available but the local storage summary could not be read.',
      ),
      persistedRecordingCount: 0,
      totalPersistedBytes: 0,
      totalPersistedChunks: 0,
      latestRecordingId: null,
      latestRecordingStartedAt: null,
      latestPersistedAt: null,
    };
  }
}

export async function saveLocalRecordingManifest(manifest: LocalRecordingManifest): Promise<void> {
  const database = await getLocalRecordingDatabase();
  const transaction = database.transaction(recordingsStoreName, 'readwrite');
  const store = transaction.objectStore(recordingsStoreName);
  const now = Date.now();
  const existingRecord = await requestToPromise<StoredLocalRecordingRecord | undefined>(
    store.get(manifest.recordingId),
  );

  store.put({
    recordingId: manifest.recordingId,
    manifest,
    firstPersistedAt: existingRecord?.firstPersistedAt ?? now,
    lastPersistedAt: now,
  });

  await transactionDone(transaction);
}

export async function saveLocalRecordingChunk(
  recordingId: string,
  chunkEntry: LocalRecordingChunkManifestEntry,
  blob: Blob,
): Promise<void> {
  const database = await getLocalRecordingDatabase();
  const transaction = database.transaction(chunksStoreName, 'readwrite');
  const store = transaction.objectStore(chunksStoreName);

  store.put({
    chunkId: chunkEntry.chunkId,
    recordingId,
    chunkEntry,
    blob,
    persistedAt: Date.now(),
  } satisfies StoredLocalRecordingChunkRecord);

  await transactionDone(transaction);
}

export async function getPersistedLocalRecording(
  recordingId: string,
): Promise<PersistedLocalRecordingRecord | null> {
  const database = await getLocalRecordingDatabase();
  const transaction = database.transaction(recordingsStoreName, 'readonly');
  const store = transaction.objectStore(recordingsStoreName);
  const record = await requestToPromise<StoredLocalRecordingRecord | undefined>(
    store.get(recordingId),
  );

  await transactionDone(transaction);

  return record ?? null;
}

export async function listPersistedLocalRecordings(): Promise<PersistedLocalRecordingRecord[]> {
  const database = await getLocalRecordingDatabase();
  const transaction = database.transaction(recordingsStoreName, 'readonly');
  const store = transaction.objectStore(recordingsStoreName);
  const records = await requestToPromise<StoredLocalRecordingRecord[]>(store.getAll());

  await transactionDone(transaction);

  return [...records].sort((left, right) => {
    const rightStartedAt = right.manifest.startedAt ?? 0;
    const leftStartedAt = left.manifest.startedAt ?? 0;

    return (
      rightStartedAt - leftStartedAt ||
      right.lastPersistedAt - left.lastPersistedAt ||
      right.firstPersistedAt - left.firstPersistedAt ||
      right.recordingId.localeCompare(left.recordingId)
    );
  });
}

export async function listPersistedLocalRecordingChunks(
  recordingId: string,
): Promise<PersistedLocalRecordingChunkRecord[]> {
  const database = await getLocalRecordingDatabase();
  const transaction = database.transaction(chunksStoreName, 'readonly');
  const store = transaction.objectStore(chunksStoreName);
  const index = store.index(chunksByRecordingIdIndexName);
  const chunks = await requestToPromise<StoredLocalRecordingChunkRecord[]>(
    index.getAll(IDBKeyRange.only(recordingId)),
  );

  await transactionDone(transaction);

  return [...chunks].sort((left, right) => {
    return (
      left.chunkEntry.chunkIndex - right.chunkEntry.chunkIndex ||
      left.chunkEntry.capturedAt - right.chunkEntry.capturedAt ||
      left.persistedAt - right.persistedAt ||
      left.chunkId.localeCompare(right.chunkId)
    );
  });
}

export async function buildPersistedLocalRecordingBlob(
  recordingId: string,
): Promise<Blob | null> {
  const recording = await getPersistedLocalRecording(recordingId);
  if (recording === null) {
    return null;
  }

  const chunks = await listPersistedLocalRecordingChunks(recordingId);
  if (chunks.length === 0) {
    return null;
  }

  const selectedMimeType =
    normalizeMimeType(recording.manifest.selectedMimeType) ??
    normalizeMimeType(chunks[0]?.chunkEntry.mimeType) ??
    normalizeMimeType(chunks[0]?.blob.type);

  return selectedMimeType === null
    ? new Blob(
        chunks.map((chunk) => chunk.blob),
      )
    : new Blob(
        chunks.map((chunk) => chunk.blob),
        { type: selectedMimeType },
      );
}

export async function deletePersistedLocalRecording(recordingId: string): Promise<void> {
  const database = await getLocalRecordingDatabase();
  const transaction = database.transaction([recordingsStoreName, chunksStoreName], 'readwrite');
  const recordingsStore = transaction.objectStore(recordingsStoreName);
  const chunksStore = transaction.objectStore(chunksStoreName);
  const chunkIndex = chunksStore.index(chunksByRecordingIdIndexName);

  const chunkKeys = await requestToPromise<IDBValidKey[]>(
    chunkIndex.getAllKeys(IDBKeyRange.only(recordingId)),
  );

  recordingsStore.delete(recordingId);

  for (const chunkKey of chunkKeys) {
    chunksStore.delete(chunkKey);
  }

  await transactionDone(transaction);
}

export async function deleteAllPersistedLocalRecordings(): Promise<void> {
  const support = await getLocalRecordingPersistenceSupport();

  if (support.state !== 'supported') {
    return;
  }

  const database = await getLocalRecordingDatabase();
  const transaction = database.transaction([recordingsStoreName, chunksStoreName], 'readwrite');

  transaction.objectStore(recordingsStoreName).clear();
  transaction.objectStore(chunksStoreName).clear();

  await transactionDone(transaction);
}

async function getLocalRecordingDatabase(): Promise<IDBDatabase> {
  if (localRecordingDatabasePromise !== null) {
    return localRecordingDatabasePromise;
  }

  localRecordingDatabasePromise = openLocalRecordingDatabase().catch((error) => {
    localRecordingDatabasePromise = null;
    throw error;
  });

  return localRecordingDatabasePromise;
}

function openLocalRecordingDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const indexedDBFactory = getIndexedDBFactory();

    if (indexedDBFactory === null) {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }

    const request = indexedDBFactory.open(localRecordingDatabaseName, localRecordingDatabaseVersion);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(recordingsStoreName)) {
        database.createObjectStore(recordingsStoreName, { keyPath: 'recordingId' });
      }

      if (!database.objectStoreNames.contains(chunksStoreName)) {
        const chunkStore = database.createObjectStore(chunksStoreName, { keyPath: 'chunkId' });
        chunkStore.createIndex(chunksByRecordingIdIndexName, 'recordingId', { unique: false });
      }
    };

    request.onblocked = () => {
      reject(new Error('IndexedDB upgrade was blocked by another connection.'));
    };

    request.onerror = () => {
      reject(
        request.error ??
          new Error('IndexedDB persistence is available but the database could not be opened.'),
      );
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(
        request.error ?? new Error('IndexedDB request failed while persisting local recordings.'),
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
          new Error('IndexedDB transaction aborted while persisting local recordings.'),
      );
    };

    transaction.onerror = () => {
      reject(
        transaction.error ?? new Error('IndexedDB transaction failed while persisting local recordings.'),
      );
    };
  });
}

function getIndexedDBFactory(): IDBFactory | null {
  if (typeof globalThis.indexedDB === 'undefined') {
    return null;
  }

  return globalThis.indexedDB;
}

function getPersistenceErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { error?: unknown; message?: unknown };

    if (maybeError.error instanceof Error && maybeError.error.message.trim() !== '') {
      return maybeError.error.message;
    }

    if (typeof maybeError.message === 'string' && maybeError.message.trim() !== '') {
      return maybeError.message;
    }
  }

  return fallbackMessage;
}

function normalizeMimeType(mimeType: string | null | undefined): string | null {
  const trimmedMimeType = mimeType?.trim();

  return trimmedMimeType ? trimmedMimeType : null;
}

function buildLocalRecordingIntegrityReport({
  recording,
  chunks,
  checkedAt,
}: {
  recording: PersistedLocalRecordingRecord;
  chunks: PersistedLocalRecordingChunkRecord[];
  checkedAt: number;
}): LocalRecordingIntegrityReport {
  const warnings: string[] = [];
  const manifest = recording.manifest;
  const expectedChunkCount = normalizeNonNegativeInteger(manifest.chunkCount);
  const storedChunkCount = chunks.length;
  const expectedBytes = normalizeNonNegativeInteger(manifest.totalBytes);
  const storedBytes = getPersistedLocalRecordingChunkBytes(chunks);
  const expectedChunkIndexes = new Set<number>();
  const storedChunkIndexes = new Set<number>();
  let manifestChunkBytes = 0;
  let storedChunkMetadataSizeMismatchCount = 0;
  let invalidManifestChunkIndexCount = 0;
  let invalidStoredChunkIndexCount = 0;

  if (manifest.chunks.length !== expectedChunkCount) {
    warnings.push('The manifest chunk list does not match the manifest chunk count.');
  }

  for (const chunkEntry of manifest.chunks) {
    const chunkIndex = normalizeChunkIndex(chunkEntry.chunkIndex);
    if (chunkIndex === null) {
      invalidManifestChunkIndexCount += 1;
    } else {
      expectedChunkIndexes.add(chunkIndex);
    }

    manifestChunkBytes += normalizeNonNegativeInteger(chunkEntry.sizeBytes);
  }

  for (const chunkRecord of chunks) {
    const chunkIndex = normalizeChunkIndex(chunkRecord.chunkEntry.chunkIndex);
    if (chunkIndex === null) {
      invalidStoredChunkIndexCount += 1;
    } else {
      storedChunkIndexes.add(chunkIndex);
    }

    if (normalizeNonNegativeInteger(chunkRecord.chunkEntry.sizeBytes) !== chunkRecord.blob.size) {
      storedChunkMetadataSizeMismatchCount += 1;
    }
  }

  if (expectedChunkIndexes.size > 0) {
    let missingChunkCount = 0;
    for (const expectedChunkIndex of expectedChunkIndexes) {
      if (!storedChunkIndexes.has(expectedChunkIndex)) {
        missingChunkCount += 1;
      }
    }

    if (missingChunkCount > 0) {
      warnings.push(
        formatMissingChunkWarning(missingChunkCount),
      );
    }

    const unexpectedStoredChunkCount = countUnexpectedStoredChunkIndexes(
      expectedChunkIndexes,
      storedChunkIndexes,
    );
    if (unexpectedStoredChunkCount > 0) {
      warnings.push(
        formatUnexpectedStoredChunkWarning(unexpectedStoredChunkCount),
      );
    }

    if (missingChunkCount === 0 && unexpectedStoredChunkCount === 0 && storedChunkCount !== expectedChunkCount) {
      warnings.push('The stored chunk count does not match the manifest chunk count.');
    }
  } else if (storedChunkCount !== expectedChunkCount) {
    warnings.push('The stored chunk count does not match the manifest chunk count.');
  }

  if (expectedBytes !== storedBytes) {
    warnings.push('The stored chunk bytes do not match the manifest total.');
  }

  if (manifestChunkBytes !== expectedBytes) {
    warnings.push('The manifest chunk metadata does not add up to the manifest total.');
  }

  if (invalidManifestChunkIndexCount > 0) {
    warnings.push(
      `${invalidManifestChunkIndexCount} manifest chunk entr${
        invalidManifestChunkIndexCount === 1 ? 'y could' : 'ies could'
      } not be verified by index.`,
    );
  }

  if (invalidStoredChunkIndexCount > 0) {
    warnings.push(
      `${invalidStoredChunkIndexCount} stored chunk entr${
        invalidStoredChunkIndexCount === 1 ? 'y could' : 'ies could'
      } not be verified by index.`,
    );
  }

  if (storedChunkMetadataSizeMismatchCount > 0) {
    warnings.push(
      `${storedChunkMetadataSizeMismatchCount} stored chunk${
        storedChunkMetadataSizeMismatchCount === 1 ? ' has' : 's have'
      } a byte size mismatch.`,
    );
  }

  return createLocalRecordingIntegrityReport({
    recordingId: recording.recordingId,
    expectedChunkCount,
    storedChunkCount,
    missingChunkCount: countMissingStoredChunkIndexes(expectedChunkIndexes, storedChunkIndexes),
    expectedBytes,
    storedBytes,
    checkedAt,
    verificationAvailable: true,
    warnings,
  });
}

function countMissingStoredChunkIndexes(
  expectedChunkIndexes: ReadonlySet<number>,
  storedChunkIndexes: ReadonlySet<number>,
): number {
  let missingChunkCount = 0;

  for (const expectedChunkIndex of expectedChunkIndexes) {
    if (!storedChunkIndexes.has(expectedChunkIndex)) {
      missingChunkCount += 1;
    }
  }

  return missingChunkCount;
}

function countUnexpectedStoredChunkIndexes(
  expectedChunkIndexes: ReadonlySet<number>,
  storedChunkIndexes: ReadonlySet<number>,
): number {
  let unexpectedStoredChunkCount = 0;

  for (const storedChunkIndex of storedChunkIndexes) {
    if (!expectedChunkIndexes.has(storedChunkIndex)) {
      unexpectedStoredChunkCount += 1;
    }
  }

  return unexpectedStoredChunkCount;
}

function formatMissingChunkWarning(missingChunkCount: number): string {
  return `${missingChunkCount} expected chunk${missingChunkCount === 1 ? ' is' : 's are'} missing from local storage.`;
}

function formatUnexpectedStoredChunkWarning(unexpectedStoredChunkCount: number): string {
  return `${unexpectedStoredChunkCount} stored chunk${
    unexpectedStoredChunkCount === 1 ? ' is' : 's are'
  } not listed in the manifest.`;
}

function normalizeChunkIndex(chunkIndex: number): number | null {
  if (!Number.isFinite(chunkIndex) || chunkIndex < 0) {
    return null;
  }

  return Math.trunc(chunkIndex);
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.trunc(value);
}

function getPersistedLocalRecordingChunkBytes(
  chunks: PersistedLocalRecordingChunkRecord[],
): number {
  let totalBytes = 0;

  for (const chunk of chunks) {
    totalBytes += chunk.blob.size;
  }

  return totalBytes;
}
