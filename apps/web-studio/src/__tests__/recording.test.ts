import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  createInitialRecordingSnapshot,
  transitionRecordingState,
  canTransitionRecordingState,
} from '../recording/recordingStateMachine';
import { shouldWarnBeforeUnload } from '../recording/useLocalMediaRecorder';
import {
  createLocalRecordingManifest,
  appendLocalRecordingChunkManifestEntry,
  finalizeLocalRecordingManifest,
  markLocalRecordingManifestFailed,
  getLocalRecordingMetadataBlockingReasons,
  getLocalRecordingParticipantMetadata,
} from '../recording/recordingManifest';
import {
  saveLocalRecordingManifest,
  saveLocalRecordingChunk,
  getPersistedLocalRecording,
  listPersistedLocalRecordings,
  listPersistedLocalRecordingChunks,
  buildPersistedLocalRecordingBlob,
  deletePersistedLocalRecording,
  deleteAllPersistedLocalRecordings,
} from '../recording/recordingPersistence';

describe('Recording State Machine', () => {
  it('should initialize to idle', () => {
    const initial = createInitialRecordingSnapshot();
    expect(initial.state).toBe('idle');
    expect(initial.errorMessage).toBeNull();
  });

  it('should allow valid transitions', () => {
    let snapshot = createInitialRecordingSnapshot();

    expect(canTransitionRecordingState(snapshot.state, 'prepare')).toBe(true);
    snapshot = transitionRecordingState(snapshot, 'prepare').snapshot;
    expect(snapshot.state).toBe('preparing');

    expect(canTransitionRecordingState(snapshot.state, 'start')).toBe(true);
    snapshot = transitionRecordingState(snapshot, 'start').snapshot;
    expect(snapshot.state).toBe('recording');

    expect(canTransitionRecordingState(snapshot.state, 'stop')).toBe(true);
    snapshot = transitionRecordingState(snapshot, 'stop').snapshot;
    expect(snapshot.state).toBe('stopping');

    expect(canTransitionRecordingState(snapshot.state, 'stopped')).toBe(true);
    snapshot = transitionRecordingState(snapshot, 'stopped').snapshot;
    expect(snapshot.state).toBe('stopped');

    expect(canTransitionRecordingState(snapshot.state, 'reset')).toBe(true);
    snapshot = transitionRecordingState(snapshot, 'reset').snapshot;
    expect(snapshot.state).toBe('idle');
  });

  it('should handle failure transition and normalize messages', () => {
    let snapshot = createInitialRecordingSnapshot();
    snapshot = transitionRecordingState(snapshot, 'prepare').snapshot;
    snapshot = transitionRecordingState(snapshot, 'fail', { errorMessage: 'Test error' }).snapshot;

    expect(snapshot.state).toBe('failed');
    expect(snapshot.errorMessage).toBe('Test error');

    // Resetting from failed
    expect(canTransitionRecordingState(snapshot.state, 'reset')).toBe(true);
    snapshot = transitionRecordingState(snapshot, 'reset').snapshot;
    expect(snapshot.state).toBe('idle');
    expect(snapshot.errorMessage).toBeNull();
  });

  it('should block invalid transitions', () => {
    const snapshot = createInitialRecordingSnapshot();
    expect(canTransitionRecordingState(snapshot.state, 'start')).toBe(false);

    const result = transitionRecordingState(snapshot, 'start');
    expect(result.allowed).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.snapshot.state).toBe('idle');
  });
});

describe('Recording Manifest', () => {
  it('should block recording until session metadata is present', () => {
    expect(
      getLocalRecordingMetadataBlockingReasons({
        sessionId: null,
        participantId: null,
        role: null,
      }),
    ).toEqual([
      'Create or join a session before recording.',
      'Participant metadata required.',
      'Recording role required.',
    ]);

    const metadata = getLocalRecordingParticipantMetadata({
      sessionId: 'session-456',
      participantId: 'part-789',
      role: 'guest',
    });

    expect(
      getLocalRecordingMetadataBlockingReasons({
        sessionId: 'session-456',
        participantId: 'part-789',
        role: 'guest',
      }),
    ).toEqual([]);

    expect(metadata).toEqual({
      sessionId: 'session-456',
      participantId: 'part-789',
      role: 'guest',
    });
  });

  it('should embed sessionId, participantId, and role', () => {
    const manifest = createLocalRecordingManifest({
      recordingId: 'rec-123',
      selectedMimeType: 'video/webm',
      startedAt: 1000,
      sessionId: 'session-456',
      participantId: 'part-789',
      role: 'guest',
    });

    expect(manifest.recordingId).toBe('rec-123');
    expect(manifest.selectedMimeType).toBe('video/webm');
    expect(manifest.startedAt).toBe(1000);
    expect(manifest.sessionId).toBe('session-456');
    expect(manifest.participantId).toBe('part-789');
    expect(manifest.role).toBe('guest');
    expect(manifest.status).toBe('recording');
    expect(manifest.chunkCount).toBe(0);
  });

  it('should append chunks and track metadata', () => {
    let manifest = createLocalRecordingManifest({
      recordingId: 'rec-123',
      selectedMimeType: 'video/webm',
      startedAt: 1000,
      sessionId: 'session-123',
      participantId: 'participant-123',
      role: 'host',
    });

    const chunk1 = new Blob(['chunk1_data'], { type: 'video/webm' });
    manifest = appendLocalRecordingChunkManifestEntry(manifest, chunk1, 2000);

    expect(manifest.chunkCount).toBe(1);
    expect(manifest.totalBytes).toBe(chunk1.size);
    expect(manifest.latestChunkAt).toBe(2000);
    expect(manifest.approximateDurationMs).toBe(1000); // 2000 - 1000

    const chunk2 = new Blob(['chunk2_data_longer'], { type: 'video/webm' });
    manifest = appendLocalRecordingChunkManifestEntry(manifest, chunk2, 3500);

    expect(manifest.chunkCount).toBe(2);
    expect(manifest.totalBytes).toBe(chunk1.size + chunk2.size);
    expect(manifest.latestChunkAt).toBe(3500);
    expect(manifest.approximateDurationMs).toBe(2500); // 3500 - 1000
  });

  it('should support finalization and failure states', () => {
    let manifest = createLocalRecordingManifest({
      recordingId: 'rec-123',
      selectedMimeType: 'video/webm',
      startedAt: 1000,
      sessionId: 'session-123',
      participantId: 'participant-123',
      role: 'host',
    });

    manifest = finalizeLocalRecordingManifest(manifest, 5000);
    expect(manifest.status).toBe('stopped');
    expect(manifest.stoppedAt).toBe(5000);
    expect(manifest.approximateDurationMs).toBe(4000);

    let failManifest = createLocalRecordingManifest({
      recordingId: 'rec-456',
      selectedMimeType: 'video/webm',
      startedAt: 1000,
      sessionId: 'session-456',
      participantId: 'participant-456',
      role: 'guest',
    });

    failManifest = markLocalRecordingManifestFailed(failManifest, 3000);
    expect(failManifest.status).toBe('failed');
    expect(failManifest.stoppedAt).toBe(3000);
  });
});

describe('IndexedDB Recording Persistence', () => {
  beforeEach(async () => {
    // Clear the database before each test
    await deleteAllPersistedLocalRecordings();
  });

  it('should save and retrieve a manifest', async () => {
    const manifest = createLocalRecordingManifest({
      recordingId: 'rec-persist-1',
      selectedMimeType: 'video/webm',
      startedAt: 1000,
      sessionId: 'session-persist',
      participantId: 'part-persist',
      role: 'host',
    });

    await saveLocalRecordingManifest(manifest);

    const retrieved = await getPersistedLocalRecording('rec-persist-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.recordingId).toBe('rec-persist-1');
    expect(retrieved?.manifest.sessionId).toBe('session-persist');
    expect(retrieved?.manifest.participantId).toBe('part-persist');
    expect(retrieved?.manifest.role).toBe('host');

    const all = await listPersistedLocalRecordings();
    expect(all.length).toBe(1);
    expect(all[0].recordingId).toBe('rec-persist-1');
  });

  it('should save and list chunks', async () => {
    const recordingId = 'rec-persist-2';
    const manifest = createLocalRecordingManifest({
      recordingId,
      selectedMimeType: 'video/webm',
      startedAt: 1000,
      sessionId: 'session-persist-2',
      participantId: 'part-persist-2',
      role: 'host',
    });

    await saveLocalRecordingManifest(manifest);

    const blob = new Blob(['hello world'], { type: 'video/webm' });
    const chunkEntry = {
      chunkId: `${recordingId}-chunk-0000`,
      recordingId,
      chunkIndex: 0,
      mimeType: 'video/webm',
      sizeBytes: blob.size,
      capturedAt: 1500,
      elapsedMsFromStart: 500,
      uploadStatus: 'local_only' as const,
    };

    await saveLocalRecordingChunk(recordingId, chunkEntry, blob);

    const chunks = await listPersistedLocalRecordingChunks(recordingId);
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkId).toBe(chunkEntry.chunkId);
    expect(chunks[0].blob.size).toBe(blob.size);
  });

  it('should delete a recording and its chunks', async () => {
    const recordingId = 'rec-persist-3';
    const manifest = createLocalRecordingManifest({
      recordingId,
      selectedMimeType: 'video/webm',
      startedAt: 1000,
      sessionId: 'session-persist-3',
      participantId: 'part-persist-3',
      role: 'guest',
    });

    await saveLocalRecordingManifest(manifest);

    const blob = new Blob(['delete me'], { type: 'video/webm' });
    const chunkEntry = {
      chunkId: `${recordingId}-chunk-0000`,
      recordingId,
      chunkIndex: 0,
      mimeType: 'video/webm',
      sizeBytes: blob.size,
      capturedAt: 1500,
      elapsedMsFromStart: 500,
      uploadStatus: 'local_only' as const,
    };

    await saveLocalRecordingChunk(recordingId, chunkEntry, blob);

    // Verify they exist
    let recordings = await listPersistedLocalRecordings();
    let chunks = await listPersistedLocalRecordingChunks(recordingId);
    expect(recordings.length).toBe(1);
    expect(chunks.length).toBe(1);

    // Delete
    await deletePersistedLocalRecording(recordingId);

    recordings = await listPersistedLocalRecordings();
    chunks = await listPersistedLocalRecordingChunks(recordingId);
    expect(recordings.length).toBe(0);
    expect(chunks.length).toBe(0);
  });

  it('should rebuild a preview blob from persisted chunks', async () => {
    const recordingId = 'rec-persist-4';
    const manifest = createLocalRecordingManifest({
      recordingId,
      selectedMimeType: 'video/webm',
      startedAt: 1000,
      sessionId: 'session-persist-4',
      participantId: 'part-persist-4',
      role: 'host',
    });

    await saveLocalRecordingManifest(manifest);

    const chunk1 = new Blob(['first'], { type: 'video/webm' });
    const chunk2 = new Blob(['second-chunk'], { type: 'video/webm' });

    await saveLocalRecordingChunk(
      recordingId,
      {
        chunkId: `${recordingId}-chunk-0000`,
        recordingId,
        chunkIndex: 0,
        mimeType: 'video/webm',
        sizeBytes: chunk1.size,
        capturedAt: 1500,
        elapsedMsFromStart: 500,
        uploadStatus: 'local_only',
      },
      chunk1,
    );

    await saveLocalRecordingChunk(
      recordingId,
      {
        chunkId: `${recordingId}-chunk-0001`,
        recordingId,
        chunkIndex: 1,
        mimeType: 'video/webm',
        sizeBytes: chunk2.size,
        capturedAt: 2500,
        elapsedMsFromStart: 1500,
        uploadStatus: 'local_only',
      },
      chunk2,
    );

    const previewBlob = await buildPersistedLocalRecordingBlob(recordingId);
    expect(previewBlob).not.toBeNull();
    expect(previewBlob?.type).toBe('video/webm');
    expect(previewBlob?.size).toBe(chunk1.size + chunk2.size);
  });
});

describe('Recording unload warning', () => {
  it('should warn when a recording is active, stopping, or has local data to keep', () => {
    expect(
      shouldWarnBeforeUnload({
        recordingState: 'recording',
        persistenceStatus: 'available',
        previewAvailable: false,
        persistedRecordingCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldWarnBeforeUnload({
        recordingState: 'stopping',
        persistenceStatus: 'available',
        previewAvailable: false,
        persistedRecordingCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldWarnBeforeUnload({
        recordingState: 'idle',
        persistenceStatus: 'available',
        previewAvailable: true,
        persistedRecordingCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldWarnBeforeUnload({
        recordingState: 'idle',
        persistenceStatus: 'available',
        previewAvailable: false,
        persistedRecordingCount: 1,
      }),
    ).toBe(true);

    expect(
      shouldWarnBeforeUnload({
        recordingState: 'idle',
        persistenceStatus: 'available',
        previewAvailable: false,
        persistedRecordingCount: 0,
      }),
    ).toBe(false);
  });

  it('should warn while persistence is still finalizing after stop', () => {
    expect(
      shouldWarnBeforeUnload({
        recordingState: 'stopped',
        persistenceStatus: 'persisting',
        previewAvailable: false,
        persistedRecordingCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldWarnBeforeUnload({
        recordingState: 'idle',
        persistenceStatus: 'persisting',
        previewAvailable: false,
        persistedRecordingCount: 0,
      }),
    ).toBe(true);
  });

  it('should stop warning after persistence is finished and the local copy is cleared', () => {
    expect(
      shouldWarnBeforeUnload({
        recordingState: 'idle',
        persistenceStatus: 'available',
        previewAvailable: false,
        persistedRecordingCount: 1,
      }),
    ).toBe(true);

    expect(
      shouldWarnBeforeUnload({
        recordingState: 'idle',
        persistenceStatus: 'available',
        previewAvailable: false,
        persistedRecordingCount: 0,
      }),
    ).toBe(false);
  });

  it('should react when preview availability changes after a stopped recording', () => {
    const warningInputs = {
      current: {
        recordingState: 'idle' as const,
        persistenceStatus: 'available' as 'available' | 'persisting',
        previewAvailable: false,
        persistedRecordingCount: 0,
      },
    };

    const readWarning = () => shouldWarnBeforeUnload(warningInputs.current);

    expect(readWarning()).toBe(false);

    warningInputs.current = {
      ...warningInputs.current,
      previewAvailable: true,
    };

    expect(readWarning()).toBe(true);

    warningInputs.current = {
      recordingState: 'idle',
      persistenceStatus: 'available',
      previewAvailable: false,
      persistedRecordingCount: 0,
    };

    expect(readWarning()).toBe(false);

    warningInputs.current = {
      recordingState: 'idle',
      persistenceStatus: 'persisting',
      previewAvailable: false,
      persistedRecordingCount: 0,
    };

    expect(readWarning()).toBe(true);

    warningInputs.current = {
      recordingState: 'idle',
      persistenceStatus: 'available',
      previewAvailable: false,
      persistedRecordingCount: 0,
    };

    expect(readWarning()).toBe(false);
  });
});
