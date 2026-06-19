import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadReadinessPanel } from '../components/UploadReadinessPanel';
import {
  buildUploadUrl,
  createRecordingUploadApiPaths,
  computeBlobSha256Hex,
  createRecordingUploadApiClient,
} from '../upload/recordingUploadApiClient';
import {
  applyRecordingUploadChunkResponse,
  applyRecordingUploadFailureResponse,
  buildLocalRecordingChunkSizeByIndex,
  canApplyLateUploadResponse,
  deriveServerConfirmedUploadChunkIndexes,
  resolveRecordingUploadStartState,
} from '../upload/recordingUploadCoordinator';
import { clearRunTokenIfCurrent } from '../upload/useRecordingUploadQueue';
import {
  createInitialRecordingUploadState,
  markChunkAlreadyPresent,
  markChunkUploading,
  markChunkUploaded,
  markRecordingUploadCanceled,
  markRecordingUploadComplete,
  getMissingUploadChunkIndexes,
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
  saveRecordingUploadStateIncremental,
  getChangedUploadChunkIndexes,
} from '../upload/recordingUploadPersistence';
import { createLocalRecordingManifest } from '../recording/recordingManifest';
import type {
  PersistedLocalRecordingChunkRecord,
  PersistedLocalRecordingRecord,
} from '../recording/recordingPersistence';

const windowLike = globalThis as unknown as Window & typeof globalThis;

if (typeof windowLike.window === 'undefined') {
  windowLike.window = windowLike;
}

const mockQueue = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
  loading: false,
  errorMessage: null as string | null,
  summaryRevision: 0,
  refreshUploadStates: vi.fn(),
  startUpload: vi.fn(),
  resumeUpload: vi.fn(),
  pauseUpload: vi.fn(),
  cancelUpload: vi.fn(),
}));

vi.mock('../upload/useRecordingUploadQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../upload/useRecordingUploadQueue')>();

  return {
    ...actual,
    useRecordingUploadQueue: () => mockQueue,
  };
});

describe('upload state', () => {
  beforeEach(async () => {
    await deleteAllPersistedRecordingUploadStates();
    vi.unstubAllGlobals();
    mockQueue.items = [];
    mockQueue.loading = false;
    mockQueue.errorMessage = null;
    mockQueue.summaryRevision = 0;
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
    const paths = createRecordingUploadApiPaths();

    expect(paths.createUploadSessionPath('recording-1')).toBe(
      '/api/recordings/recording-1/uploads',
    );
    expect(paths.getUploadSessionStatusPath('recording-1', 'upl_1')).toBe(
      '/api/recordings/recording-1/uploads/upl_1',
    );
    expect(paths.uploadChunkPath('recording-1', 'upl_1', 3)).toBe(
      '/api/recordings/recording-1/uploads/upl_1/chunks/3',
    );
  });

  it('builds upload urls with a single base prefix', () => {
    expect(
      buildUploadUrl(
        'http://localhost:8082',
        '/api/recordings/recording-1/uploads/upl_1',
      ),
    ).toBe('http://localhost:8082/api/recordings/recording-1/uploads/upl_1');
    expect(
      buildUploadUrl(
        'http://localhost:8082',
        'http://localhost:8082/api/recordings/recording-1/uploads/upl_1',
      ),
    ).toBe('http://localhost:8082/api/recordings/recording-1/uploads/upl_1');
    expect(
      buildUploadUrl(
        'http://localhost:8082',
        '/api/recordings/recording-1/uploads/upl_1',
      ),
    ).not.toContain('http://localhost:8082http://localhost:8082');
  });

  it('calls upload endpoints with the configured base url and per-chunk sizes', async () => {
    const calls: Array<{ url: string; method: string | undefined; init: RequestInit | undefined }> =
      [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push({ url, method: init?.method, init });

        const pathname = new URL(url).pathname;
        if (pathname.endsWith('/uploads') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              recordingId: 'recording-1',
              sessionId: 'session-1',
              participantId: 'participant-1',
              role: 'host',
              uploadId: 'upl_1',
              status: 'ready',
              acceptedChunkSizeBytes: 2,
              expectedChunkCount: 2,
              uploadedChunkCount: 0,
              totalBytes: 5,
              uploadedBytes: 0,
              missingChunkIndexes: [0, 1],
              rejectedChunkIndexes: [],
              updatedAt: '2026-06-18T00:00:00.000Z',
              expiresAt: '2026-06-19T00:00:00.000Z',
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (pathname.endsWith('/complete')) {
          return new Response(
            JSON.stringify({
              recordingId: 'recording-1',
              sessionId: 'session-1',
              participantId: 'participant-1',
              role: 'host',
              uploadId: 'upl_1',
              status: 'uploaded',
              complete: true,
              missingChunkIndexes: [],
              rejectedChunkIndexes: [],
              uploadedChunkCount: 2,
              uploadedBytes: 5,
              updatedAt: '2026-06-18T00:00:00.000Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (pathname.endsWith('/cancel')) {
          return new Response(
            JSON.stringify({
              recordingId: 'recording-1',
              sessionId: 'session-1',
              participantId: 'participant-1',
              role: 'host',
              uploadId: 'upl_1',
              status: 'canceled',
              complete: false,
              updatedAt: '2026-06-18T00:00:00.000Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (pathname.endsWith('/chunks/0') || pathname.endsWith('/chunks/1')) {
          return new Response(
            JSON.stringify({
              recordingId: 'recording-1',
              uploadId: 'upl_1',
              chunkIndex: pathname.endsWith('/chunks/0') ? 0 : 1,
              status: 'uploaded',
              uploadedBytes: pathname.endsWith('/chunks/0') ? 2 : 3,
              alreadyPresent: false,
              uploadedChunkCount: pathname.endsWith('/chunks/0') ? 1 : 2,
              missingChunkIndexes: pathname.endsWith('/chunks/0') ? [1] : [],
              rejectedChunkIndexes: [],
              updatedAt: '2026-06-18T00:00:00.000Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response(
          JSON.stringify({
            recordingId: 'recording-1',
            sessionId: 'session-1',
            participantId: 'participant-1',
            role: 'host',
            uploadId: 'upl_1',
            status: 'uploading',
            expectedChunkCount: 2,
            uploadedChunkCount: 1,
            totalBytes: 5,
            uploadedBytes: 2,
            missingChunkIndexes: [1],
            rejectedChunkIndexes: [],
            updatedAt: '2026-06-18T00:00:00.000Z',
            completedAt: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    const client = createRecordingUploadApiClient('http://localhost:8082');
    const created = await client.createUploadSession({
      recordingId: 'recording-1',
      sessionId: 'session-1',
      participantId: 'participant-1',
      role: 'host',
      totalBytes: 5,
      expectedChunkCount: 2,
      chunkSizeBytes: 2,
      mimeType: 'video/webm',
      manifestVersion: 1,
      clientCreatedAt: '2026-06-18T00:00:00.000Z',
    });

    expect(created.uploadId).toBe('upl_1');

    const status = await client.getUploadSessionStatus('recording-1', 'upl_1');
    expect(status.status).toBe('uploading');

    const firstChunk = await client.uploadChunk({
      recordingId: 'recording-1',
      uploadId: 'upl_1',
      chunkIndex: 0,
      chunkSizeBytes: 2,
      totalBytes: 5,
      mimeType: 'video/webm',
      idempotencyKey: 'recording-1:u1:0',
      body: new Blob(['ab'], { type: 'video/webm' }),
      chunkChecksum: 'fb8e20fc2e4c3f8efcda1f84f5a8d8c5db7db7e4e41b6f0a0f6d0d7f8dff0c2b',
    });
    const secondChunk = await client.uploadChunk({
      recordingId: 'recording-1',
      uploadId: 'upl_1',
      chunkIndex: 1,
      chunkSizeBytes: 3,
      totalBytes: 5,
      mimeType: 'video/webm',
      idempotencyKey: 'recording-1:u1:1',
      body: new Blob(['cde'], { type: 'video/webm' }),
      chunkChecksum: '003ef1ba9ea9f2f4e5b6b0d4c1f56d4f0b1d6a0f0f88e1b9c8f3d8c6c8e3e2d2',
    });

    expect(firstChunk.uploadedBytes).toBe(2);
    expect(secondChunk.uploadedBytes).toBe(3);

    const completed = await client.completeUploadSession('recording-1', 'upl_1');
    expect(completed.complete).toBe(true);

    const canceled = await client.cancelUploadSession('recording-1', 'upl_1');
    expect(canceled.status).toBe('canceled');

    expect(calls.map((call) => call.url)).toEqual([
      'http://localhost:8082/api/recordings/recording-1/uploads',
      'http://localhost:8082/api/recordings/recording-1/uploads/upl_1',
      'http://localhost:8082/api/recordings/recording-1/uploads/upl_1/chunks/0',
      'http://localhost:8082/api/recordings/recording-1/uploads/upl_1/chunks/1',
      'http://localhost:8082/api/recordings/recording-1/uploads/upl_1/complete',
      'http://localhost:8082/api/recordings/recording-1/uploads/upl_1/cancel',
    ]);

    expect(calls.every((call) => !call.url.includes('http://localhost:8082http://localhost:8082'))).toBe(true);

    const firstChunkHeaders = new Headers(calls[2]?.init?.headers);
    const secondChunkHeaders = new Headers(calls[3]?.init?.headers);
    expect(firstChunkHeaders.get('X-DNA-Chunk-Size')).toBe('2');
    expect(secondChunkHeaders.get('X-DNA-Chunk-Size')).toBe('3');
    expect(firstChunkHeaders.get('Content-Type')).toBe('video/webm');
    expect(secondChunkHeaders.get('Content-Type')).toBe('video/webm');
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

  it('hides retrying upload errors from the default view', () => {
    const recording = createMockRecordingRecord('recording-3b');
    const queuedRecorder = createMockRecorder([recording]);
    mockQueue.items = [
      {
        recording,
        state: {
          recordingId: 'recording-3b',
          sessionId: 'session-3',
          participantId: 'participant-3',
          role: 'host',
          uploadId: 'upl_3',
          status: 'retrying',
          expectedChunkCount: 2,
          expectedTotalBytes: 6,
          uploadedChunkCount: 0,
          uploadedBytes: 0,
          failedChunkCount: 1,
          chunks: [],
          retry: {
            attemptCount: 1,
            lastAttemptAt: 1001,
            nextRetryAt: null,
            lastErrorMessage: 'Network error.',
          },
          createdAt: 1000,
          updatedAt: 1002,
          completedAt: null,
          lastSyncedAt: 1002,
          errorMessage: 'Network error.',
        },
        progressLabel: '0/2 chunks, 0 B / 6 B',
        uploadLabel: 'Upload local copy',
        statusLabel: 'retrying',
        canUpload: true,
        canPause: false,
        canResume: true,
        canCancel: true,
        canRetry: true,
      },
    ];

    const queuedMarkup = renderToStaticMarkup(
      createElement(UploadReadinessPanel, { recorder: queuedRecorder as never }),
    );

    expect(queuedMarkup).toContain('retrying');
    expect(queuedMarkup).not.toContain('Network error.');
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

  it('starts a fresh upload session after cancel instead of reusing a terminal state', () => {
    const recording = createMockRecordingRecord('recording-5');
    const canceledState = markRecordingUploadCanceled(
      createInitialRecordingUploadState({
        recordingId: 'recording-5',
        sessionId: 'session-5',
        participantId: 'participant-5',
        role: 'guest',
        expectedChunkCount: 2,
        expectedTotalBytes: 6,
        now: 1000,
      }),
      1001,
    );

    const result = resolveRecordingUploadStartState({
      recording,
      existingState: canceledState,
      resumeExisting: true,
      now: 2000,
    });

    expect(result.shouldResetPersistedState).toBe(true);
    expect(result.state.status).toBe('not_started');
    expect(result.state.uploadId).toBeNull();
    expect(result.state.createdAt).toBe(2000);
    expect(result.state.recordingId).toBe('recording-5');
  });

  it('derives server-confirmed chunk indexes from missing and rejected indexes', () => {
    expect(
      deriveServerConfirmedUploadChunkIndexes({
        expectedChunkCount: 4,
        missingChunkIndexes: [1],
        rejectedChunkIndexes: [3],
      }),
    ).toEqual([0, 2]);
  });

  it('hydrates server-confirmed chunk bytes from local chunk sizes during resume', () => {
    const localChunkSizeByIndex = {
      0: 2,
      1: 3,
    };

    let state = createInitialRecordingUploadState({
      recordingId: 'recording-6',
      sessionId: 'session-6',
      participantId: 'participant-6',
      role: 'host',
      expectedChunkCount: 2,
      expectedTotalBytes: 5,
      now: 1000,
    });

    state = mergeRecordingUploadServerStatus(state, {
      status: 'uploading',
      uploadId: 'upl_6',
      sessionId: 'session-6',
      participantId: 'participant-6',
      role: 'host',
      uploadedChunkIndexes: [0],
      rejectedChunkIndexes: [],
      uploadedChunkSizeByIndex: localChunkSizeByIndex,
      uploadedBytes: 2,
      completedAt: null,
      now: 1001,
    });

    expect(state.chunks[0]?.status).toBe('uploaded');
    expect(state.chunks[0]?.uploadedBytes).toBe(2);
    expect(state.chunks[1]?.status).toBe('pending');
    expect(state.uploadedBytes).toBe(2);

    state = markChunkUploading(state, 1, 1002);
    state = markChunkUploaded(state, 1, 3, 1003);
    state = markRecordingUploadComplete(state, 1004);

    expect(state.uploadedBytes).toBe(5);
    expect(state.status).toBe('uploaded');
  });

  it('hydrates all server-confirmed chunks with local bytes and leaves no missing uploads', () => {
    const localChunks = createMockLocalRecordingChunks('recording-7', [2, 3]);
    const localChunkSizeByIndex = buildLocalRecordingChunkSizeByIndex({
      chunks: localChunks,
    });

    let state = createInitialRecordingUploadState({
      recordingId: 'recording-7',
      sessionId: 'session-7',
      participantId: 'participant-7',
      role: 'guest',
      expectedChunkCount: 2,
      expectedTotalBytes: 5,
      now: 1000,
    });

    state = mergeRecordingUploadServerStatus(state, {
      status: 'uploaded',
      uploadId: 'upl_7',
      sessionId: 'session-7',
      participantId: 'participant-7',
      role: 'guest',
      uploadedChunkIndexes: [0, 1],
      rejectedChunkIndexes: [],
      uploadedChunkSizeByIndex: localChunkSizeByIndex,
      uploadedBytes: 5,
      completedAt: 1001,
      now: 1001,
    });

    expect(state.chunks[0]?.uploadedBytes).toBe(2);
    expect(state.chunks[1]?.uploadedBytes).toBe(3);
    expect(getMissingUploadChunkIndexes(state)).toEqual([]);
    expect(state.uploadedBytes).toBe(5);
  });

  it('detects only the modified upload chunks between persisted states', () => {
    const previousState = createInitialRecordingUploadState({
      recordingId: 'recording-10',
      sessionId: 'session-10',
      participantId: 'participant-10',
      role: 'host',
      expectedChunkCount: 3,
      expectedTotalBytes: 9,
      now: 1000,
    });

    const nextState = markChunkUploading(previousState, 1, 1001);

    expect(getChangedUploadChunkIndexes(previousState, nextState)).toEqual([1]);
  });

  it('persists upload chunk updates incrementally without dropping untouched chunks', async () => {
    const previousState = createInitialRecordingUploadState({
      recordingId: 'recording-11',
      sessionId: 'session-11',
      participantId: 'participant-11',
      role: 'guest',
      expectedChunkCount: 2,
      expectedTotalBytes: 5,
      now: 1000,
    });

    const initialState = setRecordingUploadSessionReady(previousState, {
      uploadId: 'upl_11',
      sessionId: 'session-11',
      participantId: 'participant-11',
      role: 'guest',
      now: 1001,
    });

    await saveRecordingUploadState(initialState);

    const nextState = markChunkUploading(initialState, 0, 1002);
    await saveRecordingUploadStateIncremental(initialState, nextState);

    const restored = await getPersistedRecordingUploadState('recording-11');
    expect(restored).not.toBeNull();
    expect(restored?.chunks[0]?.status).toBe('uploading');
    expect(restored?.chunks[1]?.status).toBe('pending');
  });

  it('does not apply a late chunk response after cancel', () => {
    let state = createInitialRecordingUploadState({
      recordingId: 'recording-8',
      sessionId: 'session-8',
      participantId: 'participant-8',
      role: 'host',
      expectedChunkCount: 1,
      expectedTotalBytes: 2,
      now: 1000,
    });

    state = markChunkUploading(state, 0, 1001);
    state = markRecordingUploadCanceled(state, 1002);

    const resolved = applyRecordingUploadChunkResponse({
      state,
      chunkIndex: 0,
      uploadedBytes: 2,
      alreadyPresent: false,
      now: 1003,
    });

    expect(canApplyLateUploadResponse(resolved.status)).toBe(false);
    expect(resolved.status).toBe('canceled');
    expect(resolved.chunks[0]?.status).toBe('uploading');
  });

  it('does not apply a late chunk response after pause', () => {
    let state = createInitialRecordingUploadState({
      recordingId: 'recording-9',
      sessionId: 'session-9',
      participantId: 'participant-9',
      role: 'guest',
      expectedChunkCount: 1,
      expectedTotalBytes: 2,
      now: 1000,
    });

    state = markChunkUploading(state, 0, 1001);
    state = setRecordingUploadPaused(state, 1002);

    const resolved = applyRecordingUploadChunkResponse({
      state,
      chunkIndex: 0,
      uploadedBytes: 2,
      alreadyPresent: false,
      now: 1003,
    });

    expect(canApplyLateUploadResponse(resolved.status)).toBe(false);
    expect(resolved.status).toBe('paused');
    expect(resolved.chunks[0]?.status).toBe('uploading');
  });

  it('does not overwrite a paused upload when a late failure arrives', () => {
    let state = createInitialRecordingUploadState({
      recordingId: 'recording-12',
      sessionId: 'session-12',
      participantId: 'participant-12',
      role: 'host',
      expectedChunkCount: 1,
      expectedTotalBytes: 2,
      now: 1000,
    });

    state = markChunkUploading(state, 0, 1001);
    state = setRecordingUploadPaused(state, 1002);

    const resolved = applyRecordingUploadFailureResponse({
      state,
      errorMessage: 'Network error.',
      retryable: true,
      now: 1003,
    });

    expect(resolved.status).toBe('paused');
  });

  it('keeps the retrying upload error message visible after a retryable failure', () => {
    let state = createInitialRecordingUploadState({
      recordingId: 'recording-12b',
      sessionId: 'session-12b',
      participantId: 'participant-12b',
      role: 'host',
      expectedChunkCount: 1,
      expectedTotalBytes: 2,
      now: 1000,
    });

    state = markChunkUploading(state, 0, 1001);

    const resolved = applyRecordingUploadFailureResponse({
      state,
      errorMessage: 'Network error.',
      retryable: true,
      now: 1002,
    });

    expect(resolved.status).toBe('retrying');
    expect(resolved.errorMessage).toBe('Network error.');
  });

  it('does not overwrite a canceled upload when a late failure arrives', () => {
    let state = createInitialRecordingUploadState({
      recordingId: 'recording-13',
      sessionId: 'session-13',
      participantId: 'participant-13',
      role: 'guest',
      expectedChunkCount: 1,
      expectedTotalBytes: 2,
      now: 1000,
    });

    state = markChunkUploading(state, 0, 1001);
    state = markRecordingUploadCanceled(state, 1002);

    const resolved = applyRecordingUploadFailureResponse({
      state,
      errorMessage: 'Network error.',
      retryable: false,
      now: 1003,
    });

    expect(resolved.status).toBe('canceled');
  });

  it('keeps a newer run token when an old run finishes after relaunch', () => {
    const runTokens: Record<string, number> = {
      'recording-14': 3,
    };

    const cleared = clearRunTokenIfCurrent(runTokens, 'recording-14', 1);

    expect(cleared).toBe(false);
    expect(runTokens['recording-14']).toBe(3);
  });

  it('clears only the finishing run token when no newer run has started', () => {
    const runTokens: Record<string, number> = {
      'recording-15': 3,
    };

    const cleared = clearRunTokenIfCurrent(runTokens, 'recording-15', 3);

    expect(cleared).toBe(true);
    expect(runTokens['recording-15']).toBeUndefined();
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

function createMockLocalRecordingChunks(
  recordingId: string,
  sizes: number[],
): PersistedLocalRecordingChunkRecord[] {
  return sizes.map((size, index) => {
    const text = 'x'.repeat(Math.max(0, size));

    return {
      chunkId: `${recordingId}-chunk-${index}`,
      recordingId,
      chunkEntry: {
        chunkId: `${recordingId}-chunk-${index}`,
        recordingId,
        chunkIndex: index,
        mimeType: 'video/webm',
        sizeBytes: size,
        capturedAt: 1000 + index,
        elapsedMsFromStart: index * 1000,
        uploadStatus: 'local_only',
      },
      blob: new Blob([text], { type: 'video/webm' }),
      persistedAt: 2000 + index,
    };
  });
}
