import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadReadinessPanel } from '../components/UploadReadinessPanel';
import {
  createRecordingUploadApiPaths,
  computeBlobSha256Hex,
} from '../upload/recordingUploadApiClient';
import {
  createInitialRecordingUploadState,
  markChunkAlreadyPresent,
  markChunkUploading,
  markRecordingUploadCanceled,
  markRecordingUploadComplete,
  mergeRecordingUploadServerStatus,
  setRecordingUploadPaused,
  setRecordingUploadSessionReady,
  setRecordingUploadInitializing,
  summarizeRecordingUploadProgress,
} from '../upload/recordingUploadState';
import {
  deleteAllPersistedRecordingUploadStates,
  getPersistedRecordingUploadState,
  saveRecordingUploadState,
} from '../upload/recordingUploadPersistence';
import { createLocalRecordingManifest } from '../recording/recordingManifest';
import type { PersistedLocalRecordingRecord } from '../recording/recordingPersistence';

const windowLike = globalThis as unknown as Window & typeof globalThis;

if (typeof windowLike.window === 'undefined') {
  windowLike.window = windowLike;
}

const mockQueue = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  loading: false,
  errorMessage: null as string | null,
  refreshUploadStates: vi.fn(),
  startUpload: vi.fn(),
  resumeUpload: vi.fn(),
  pauseUpload: vi.fn(),
  cancelUpload: vi.fn(),
}));

vi.mock('../upload/useRecordingUploadQueue', () => ({
  useRecordingUploadQueue: () => mockQueue,
}));

describe('upload state', () => {
  beforeEach(async () => {
    await deleteAllPersistedRecordingUploadStates();
    mockQueue.items = [];
    mockQueue.loading = false;
    mockQueue.errorMessage = null;
    mockQueue.refreshUploadStates.mockReset();
    mockQueue.startUpload.mockReset();
    mockQueue.resumeUpload.mockReset();
    mockQueue.pauseUpload.mockReset();
    mockQueue.cancelUpload.mockReset();
  });

  it('tracks chunk state and progress', () => {
    let state = createInitialRecordingUploadState({
      recordingId: 'recording-1',
      sessionId: 'session-1',
      participantId: 'participant-1',
      role: 'host',
      expectedChunkCount: 2,
      expectedTotalBytes: 6,
      now: 1000,
    });

    state = setRecordingUploadInitializing(state, 1001);
    state = setRecordingUploadSessionReady(state, {
      uploadId: 'upl_1',
      sessionId: 'session-1',
      participantId: 'participant-1',
      role: 'host',
      now: 1002,
    });
    state = markChunkUploading(state, 0, 1003);
    state = markChunkAlreadyPresent(state, 0, 3, 1004);
    state = mergeRecordingUploadServerStatus(state, {
      status: 'uploading',
      uploadId: 'upl_1',
      sessionId: 'session-1',
      participantId: 'participant-1',
      role: 'host',
      uploadedChunkIndexes: [0],
      rejectedChunkIndexes: [],
      uploadedBytes: 3,
      completedAt: null,
      now: 1005,
    });

    const progress = summarizeRecordingUploadProgress(state);
    expect(state.status).toBe('uploading');
    expect(progress.uploadedChunkCount).toBe(1);
    expect(progress.pendingChunkCount).toBe(1);
    expect(progress.failedChunkCount).toBe(0);
    expect(progress.uploadedBytes).toBe(3);
  });

  it('persists and rehydrates upload queue state', async () => {
    const state = createInitialRecordingUploadState({
      recordingId: 'recording-2',
      sessionId: 'session-2',
      participantId: 'participant-2',
      role: 'guest',
      expectedChunkCount: 1,
      expectedTotalBytes: 3,
      now: 1000,
    });

    await saveRecordingUploadState(
      setRecordingUploadSessionReady(state, {
        uploadId: 'upl_2',
        sessionId: 'session-2',
        participantId: 'participant-2',
        role: 'guest',
        now: 1001,
      }),
    );

    const restored = await getPersistedRecordingUploadState('recording-2');
    expect(restored).not.toBeNull();
    expect(restored?.uploadId).toBe('upl_2');
    expect(restored?.sessionId).toBe('session-2');
    expect(restored?.participantId).toBe('participant-2');
    expect(restored?.role).toBe('guest');
  });

  it('builds recording upload api paths', () => {
    const paths = createRecordingUploadApiPaths('http://localhost:8082');

    expect(paths.createUploadSessionPath('recording-1')).toBe(
      'http://localhost:8082/api/recordings/recording-1/uploads',
    );
    expect(paths.getUploadSessionStatusPath('recording-1', 'upl_1')).toBe(
      'http://localhost:8082/api/recordings/recording-1/uploads/upl_1',
    );
    expect(paths.uploadChunkPath('recording-1', 'upl_1', 3)).toBe(
      'http://localhost:8082/api/recordings/recording-1/uploads/upl_1/chunks/3',
    );
  });

  it('computes blob checksums', async () => {
    const checksum = await computeBlobSha256Hex(new Blob(['abc'], { type: 'text/plain' }));
    expect(checksum).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('renders upload action only when a persisted local recording exists', () => {
    const recorder = createMockRecorder([]);
    mockQueue.items = [];

    const emptyMarkup = renderToStaticMarkup(
      createElement(UploadReadinessPanel, { recorder: recorder as never }),
    );
    expect(emptyMarkup).not.toContain('Upload queue item');
    expect(emptyMarkup).not.toContain('Pause');

    const recording = createMockRecordingRecord('recording-3');
    const queuedRecorder = createMockRecorder([recording]);
    mockQueue.items = [
      {
        recording,
        state: {
          recordingId: 'recording-3',
          sessionId: 'session-3',
          participantId: 'participant-3',
          role: 'host',
          uploadId: 'upl_3',
          status: 'ready',
          expectedChunkCount: 2,
          expectedTotalBytes: 6,
          uploadedChunkCount: 0,
          uploadedBytes: 0,
          failedChunkCount: 0,
          chunks: [],
          retry: {
            attemptCount: 0,
            lastAttemptAt: null,
            nextRetryAt: null,
            lastErrorMessage: null,
          },
          createdAt: 1000,
          updatedAt: 1000,
          completedAt: null,
          lastSyncedAt: 1000,
          errorMessage: null,
        },
        progressLabel: '0/2 chunks, 0 B / 6 B',
        uploadLabel: 'Upload local copy',
        statusLabel: 'ready',
        canUpload: true,
        canPause: false,
        canResume: false,
        canCancel: true,
        canRetry: false,
      },
    ];

    const queuedMarkup = renderToStaticMarkup(
      createElement(UploadReadinessPanel, { recorder: queuedRecorder as never }),
    );

    expect(queuedMarkup).toContain('Upload local copy');
    expect(queuedMarkup).toContain('0/2 chunks, 0 B / 6 B');
  });

  it('maps upload lifecycle flags without breaking local-first status', () => {
    let state = createInitialRecordingUploadState({
      recordingId: 'recording-4',
      sessionId: 'session-4',
      participantId: 'participant-4',
      role: 'host',
      expectedChunkCount: 1,
      expectedTotalBytes: 3,
      now: 1000,
    });

    state = setRecordingUploadPaused(state, 1001);
    state = markRecordingUploadCanceled(state, 1002);
    state = markRecordingUploadComplete(state, 1003);

    expect(state.status).toBe('canceled');
  });
});

function createMockRecorder(persistedRecordings: PersistedLocalRecordingRecord[]) {
  return {
    summary: {
      currentRecordingPersisted: persistedRecordings.length > 0,
    },
    persistedRecordings,
    persistenceErrorMessage: null,
  };
}

function createMockRecordingRecord(recordingId: string): PersistedLocalRecordingRecord {
  const manifest = createLocalRecordingManifest({
    recordingId,
    selectedMimeType: 'video/webm',
    startedAt: 1000,
    sessionId: 'session-3',
    participantId: 'participant-3',
    role: 'host',
  });

  return {
    recordingId,
    manifest,
    firstPersistedAt: 1000,
    lastPersistedAt: 2000,
  };
}
