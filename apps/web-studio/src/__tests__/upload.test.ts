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
import { deriveServerConfirmedUploadChunkIndexes, resolveRecordingUploadStartState } from '../upload/recordingUploadCoordinator';
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
  summaryRevision: 0,
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
