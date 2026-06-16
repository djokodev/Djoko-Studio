import type {
  LocalRecordingChunkManifestEntry,
  LocalRecordingManifest,
} from './recordingManifest';

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

let localRecordingDatabasePromise: Promise<IDBDatabase> | null = null;
let localRecordingSupportPromise: Promise<LocalRecordingPersistenceSupportResult> | null = null;

export async function getLocalRecordingPersistenceSupport(): Promise<LocalRecordingPersistenceSupportResult> {
  if (localRecordingSupportPromise !== null) {
    return localRecordingSupportPromise;
  }

  localRecordingSupportPromise = (async () => {
    if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
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
    if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }

    const request = window.indexedDB.open(
      localRecordingDatabaseName,
      localRecordingDatabaseVersion,
    );

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
