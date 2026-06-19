import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProcessingExportPanel,
  getStartExportButtonLabel,
  getExportFailureMessage,
  isStartExportDisabled,
  triggerExportDownload,
} from '../components/ProcessingExportPanel';
import {
  buildExportUrl,
  createRecordingExportApiClient,
  createRecordingExportApiPaths,
  isExportWorkerReady,
  type RecordingExportManifest,
} from '../export/recordingExportApiClient';
import {
  clearPersistedExportId,
  getPersistedExportId,
  savePersistedExportId,
} from '../export/recordingExportPersistence';
import {
  getExportStatusSummaryLabel,
  getExportTargetLabel,
  selectLatestExportCandidate,
} from '../export/recordingExportSelection';

const mockQueue = vi.hoisted(() => ({
  items: [] as Array<Record<string, unknown>>,
}));

function buildExportQueueItem(input: {
  recordingId: string;
  status: string;
  uploadId?: string | null;
  sessionId?: string | null;
  participantId?: string | null;
  role?: 'host' | 'guest' | null;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number | null;
  recordingFirstPersistedAt?: number;
  recordingLastPersistedAt?: number;
}) {
  const fallbackTimestamp =
    input.completedAt ?? input.updatedAt ?? input.createdAt ?? input.recordingLastPersistedAt ?? 0;

  return {
    recording: {
      recordingId: input.recordingId,
      manifest: {
        sessionId: input.sessionId,
        participantId: input.participantId,
        role: input.role,
      },
      firstPersistedAt: input.recordingFirstPersistedAt ?? fallbackTimestamp,
      lastPersistedAt: input.recordingLastPersistedAt ?? fallbackTimestamp,
    },
    state: {
      status: input.status,
      sessionId: input.sessionId,
      participantId: input.participantId,
      role: input.role,
      uploadId: input.uploadId ?? null,
      createdAt: input.createdAt ?? fallbackTimestamp,
      updatedAt: input.updatedAt ?? fallbackTimestamp,
      completedAt: input.completedAt ?? null,
    },
  };
}

vi.mock('../upload/useRecordingUploadQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../upload/useRecordingUploadQueue')>();

  return {
    ...actual,
    useRecordingUploadQueue: () => mockQueue,
  };
});

describe('export client', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockQueue.items = [];
  });

  it('selects_latest_uploaded_recording_for_export', () => {
    mockQueue.items = [
      buildExportQueueItem({
        recordingId: 'recording-a',
        status: 'uploaded',
        uploadId: 'upload-a',
        sessionId: 'session-a',
        participantId: 'participant-a',
        role: 'host',
        completedAt: 1_000,
        updatedAt: 1_000,
        createdAt: 1_000,
      }),
      buildExportQueueItem({
        recordingId: 'recording-b',
        status: 'uploaded',
        uploadId: 'upload-b',
        sessionId: 'session-b',
        participantId: 'participant-b',
        role: 'guest',
        completedAt: 2_000,
        updatedAt: 2_000,
        createdAt: 2_000,
      }),
    ];

    const candidate = selectLatestExportCandidate(mockQueue.items as never);

    expect(candidate).toEqual({
      recordingId: 'recording-b',
      sessionId: 'session-b',
      participantId: 'participant-b',
      role: 'guest',
      uploadId: 'upload-b',
      uploadStatus: 'uploaded',
    });
    expect(getExportTargetLabel()).toBe('MP4 1080p');
    expect(getExportStatusSummaryLabel(null)).toBe('Not started');
  });

  it('ignores_incomplete_or_non_uploaded_recordings', () => {
    mockQueue.items = [
      buildExportQueueItem({
        recordingId: 'recording-newer-not-uploaded',
        status: 'ready',
        uploadId: 'upload-newer-not-uploaded',
        sessionId: 'session-newer',
        participantId: 'participant-newer',
        role: 'host',
        completedAt: 3_000,
        updatedAt: 3_000,
        createdAt: 3_000,
      }),
      buildExportQueueItem({
        recordingId: 'recording-older-uploaded',
        status: 'uploaded',
        uploadId: 'upload-older-uploaded',
        sessionId: 'session-older',
        participantId: 'participant-older',
        role: 'guest',
        completedAt: 1_500,
        updatedAt: 1_500,
        createdAt: 1_500,
      }),
    ];

    expect(selectLatestExportCandidate(mockQueue.items as never)).toEqual({
      recordingId: 'recording-older-uploaded',
      sessionId: 'session-older',
      participantId: 'participant-older',
      role: 'guest',
      uploadId: 'upload-older-uploaded',
      uploadStatus: 'uploaded',
    });
  });

  it('selects_latest_uploaded_recording_even_when_input_order_is_oldest_first', () => {
    mockQueue.items = [
      buildExportQueueItem({
        recordingId: 'recording-a',
        status: 'uploaded',
        uploadId: 'upload-a',
        sessionId: 'session-a',
        participantId: 'participant-a',
        role: 'host',
        completedAt: 1_000,
        updatedAt: 1_000,
        createdAt: 1_000,
      }),
      buildExportQueueItem({
        recordingId: 'recording-b',
        status: 'uploaded',
        uploadId: 'upload-b',
        sessionId: 'session-b',
        participantId: 'participant-b',
        role: 'guest',
        completedAt: 2_000,
        updatedAt: 2_000,
        createdAt: 2_000,
      }),
    ];

    expect(selectLatestExportCandidate(mockQueue.items as never)?.recordingId).toBe('recording-b');
  });

  it('selects_latest_uploaded_recording_even_when_input_order_is_newest_first', () => {
    mockQueue.items = [
      buildExportQueueItem({
        recordingId: 'recording-b',
        status: 'uploaded',
        uploadId: 'upload-b',
        sessionId: 'session-b',
        participantId: 'participant-b',
        role: 'guest',
        completedAt: 2_000,
        updatedAt: 2_000,
        createdAt: 2_000,
      }),
      buildExportQueueItem({
        recordingId: 'recording-a',
        status: 'uploaded',
        uploadId: 'upload-a',
        sessionId: 'session-a',
        participantId: 'participant-a',
        role: 'host',
        completedAt: 1_000,
        updatedAt: 1_000,
        createdAt: 1_000,
      }),
    ];

    expect(selectLatestExportCandidate(mockQueue.items as never)?.uploadId).toBe('upload-b');
  });

  it('builds export api paths and serializes requests', async () => {
    const calls: Array<{ url: string; method: string | undefined; body?: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push({
          url,
          method: init?.method,
          body: typeof init?.body === 'string' ? init.body : null,
        });

        if (url.endsWith('/readyz')) {
          return new Response(
            JSON.stringify({
              status: 'ok',
              service: 'export-worker',
              storage: 'ready',
              ffmpeg: 'available',
              message: null,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (url.endsWith('/api/exports') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              manifestVersion: 1,
              exportId: 'exp-recording-1',
              recordingId: 'recording-1',
              uploadId: 'upload-1',
              sessionId: 'session-1',
              participantId: 'participant-1',
              role: 'host',
              status: 'processing',
              targetFormat: 'mp4',
              targetResolution: '1920x1080',
              sourceManifestKey: 'recordings/recording-1/uploads/upload-1/manifest.json',
              outputObjectKey:
                'sessions/session-1/participants/participant-1/recordings/recording-1/exports/exp-recording-1/output-1080p.mp4',
              outputBytes: null,
              createdAt: '2026-06-19T10:00:00Z',
              updatedAt: '2026-06-19T10:00:00Z',
              completedAt: null,
              error: null,
            }),
            { status: 202, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (url.endsWith('/download')) {
          return new Response(new Blob(['fake-mp4'], { type: 'video/mp4' }), {
            status: 200,
            headers: { 'Content-Type': 'video/mp4' },
          });
        }

        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = createRecordingExportApiClient('http://localhost:8083');
    expect(createRecordingExportApiPaths().exportPath('exp-recording-1')).toBe(
      '/api/exports/exp-recording-1',
    );
    expect(buildExportUrl('http://localhost:8083', '/api/exports')).toBe(
      'http://localhost:8083/api/exports',
    );

    const readyz = await client.getReadyz();
    expect(readyz.status).toBe('ok');

    const manifest = await client.createExport({
      recordingId: 'recording-1',
      uploadId: 'upload-1',
      sessionId: 'session-1',
      participantId: 'participant-1',
      role: 'host',
      target: {
        format: 'mp4',
        resolution: '1920x1080',
      },
    });
    expect(manifest.exportId).toBe('exp-recording-1');
    expect(manifest.status).toBe('processing');

    const downloadUrl = client.getDownloadUrl('exp-recording-1');
    expect(downloadUrl).toBe('http://localhost:8083/api/exports/exp-recording-1/download');

    const download = await client.downloadExport('exp-recording-1');
    expect(download.size).toBe(8);
    expect(download.type).toBe('video/mp4');

    expect(calls[0]?.url).toBe('http://localhost:8083/readyz');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[2]?.url).toBe('http://localhost:8083/api/exports/exp-recording-1/download');
  });

  it('persists last export id across refresh', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    } satisfies Storage);

    savePersistedExportId('recording-1', 'exp-recording-1');
    expect(getPersistedExportId('recording-1')).toBe('exp-recording-1');
    clearPersistedExportId('recording-1');
    expect(getPersistedExportId('recording-1')).toBeNull();
  });

  it('describes failed exports with their error message', () => {
    const manifest: RecordingExportManifest = {
      manifestVersion: 1,
      exportId: 'exp-recording-1',
      attemptId: 'attempt-1',
      recordingId: 'recording-1',
      uploadId: 'upload-1',
      sessionId: 'session-1',
      participantId: 'participant-1',
      role: 'host',
      status: 'failed',
      targetFormat: 'mp4',
      targetResolution: '1920x1080',
      sourceManifestKey: 'recordings/recording-1/uploads/upload-1/manifest.json',
      outputObjectKey:
        'sessions/session-1/participants/participant-1/recordings/recording-1/exports/exp-recording-1/output-1080p.mp4',
      outputBytes: null,
      createdAt: '2026-06-19T10:00:00Z',
      updatedAt: '2026-06-19T10:00:00Z',
      completedAt: null,
      error: {
        code: 'checksum_mismatch',
        message: 'Chunk checksum mismatch.',
      },
    };

    expect(getExportFailureMessage(manifest)).toBe('Chunk checksum mismatch.');
  });

  it('download_export_uses_direct_download_url_without_fetching_blob', () => {
    const client = createRecordingExportApiClient('http://localhost:8083');

    expect(client.getDownloadUrl('exp-recording-1')).toBe(
      'http://localhost:8083/api/exports/exp-recording-1/download',
    );
  });

  it('export_button_disabled_when_ffmpeg_unavailable', () => {
    expect(
      isStartExportDisabled({
        hasConfiguredService: true,
        hasCandidate: true,
        isSubmitting: false,
        readinessStatus: 'ready',
        readinessConfigured: true,
        workerReady: isExportWorkerReady({
          status: 'degraded',
          service: 'export-worker',
          storage: 'ready',
          ffmpeg: 'unavailable',
          message: 'ffmpeg missing',
        }),
        exportReady: false,
      }),
    ).toBe(true);
  });

  it('export_button_disabled_when_storage_unavailable', () => {
    expect(
      isStartExportDisabled({
        hasConfiguredService: true,
        hasCandidate: true,
        isSubmitting: false,
        readinessStatus: 'ready',
        readinessConfigured: true,
        workerReady: isExportWorkerReady({
          status: 'degraded',
          service: 'export-worker',
          storage: 'unavailable',
          ffmpeg: 'available',
          message: 'storage unavailable',
        }),
        exportReady: false,
      }),
    ).toBe(true);
  });

  it('export_button_enabled_only_when_worker_ok_and_upload_ready', () => {
    const workerReady = isExportWorkerReady({
      status: 'ok',
      service: 'export-worker',
      storage: 'ready',
      ffmpeg: 'available',
      message: null,
    });
    expect(workerReady).toBe(true);
    expect(
      isStartExportDisabled({
        hasConfiguredService: true,
        hasCandidate: true,
        isSubmitting: false,
        readinessStatus: 'ready',
        readinessConfigured: true,
        workerReady,
        exportReady: false,
      }),
    ).toBe(false);
    expect(
      isStartExportDisabled({
        hasConfiguredService: true,
        hasCandidate: false,
        isSubmitting: false,
        readinessStatus: 'ready',
        readinessConfigured: true,
        workerReady,
        exportReady: false,
      }),
    ).toBe(true);
  });

  it('start_export_button_disabled_when_export_ready', () => {
    expect(
      isStartExportDisabled({
        hasConfiguredService: true,
        hasCandidate: true,
        isSubmitting: false,
        readinessStatus: 'ready',
        readinessConfigured: true,
        workerReady: true,
        exportReady: true,
      }),
    ).toBe(true);
    expect(getStartExportButtonLabel(true, false)).toBe('Export already ready');
  });

  it('download_export_does_not_navigate_current_page', () => {
    const click = vi.fn();
    const assign = vi.fn();
    const anchor = {
      href: '',
      target: '',
      rel: '',
      click,
    };

    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
    });
    vi.stubGlobal('window', {
      location: {
        assign,
      },
    });

    triggerExportDownload('http://localhost:8083/api/exports/exp-recording-1/download');

    expect(anchor.href).toBe('http://localhost:8083/api/exports/exp-recording-1/download');
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noopener noreferrer');
    expect(click).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('export panel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockQueue.items = [];
  });

  it('renders the export dashboard and disables actions when not configured', () => {
    const recorder = {
      persistedRecordings: [],
    } as never;

    const markup = renderToStaticMarkup(
      createElement(ProcessingExportPanel, { recorder }),
    );

    expect(markup).toContain('Export your session');
    expect(markup).toContain('Export is not ready yet.');
    expect(markup).toContain('disabled');
  });

  it('renders the latest uploaded recording details', () => {
    mockQueue.items = [
      buildExportQueueItem({
        recordingId: 'recording-a',
        status: 'uploaded',
        uploadId: 'upload-a',
        sessionId: 'session-a',
        participantId: 'participant-a',
        role: 'host',
        completedAt: 1_000,
        updatedAt: 1_000,
        createdAt: 1_000,
      }),
      buildExportQueueItem({
        recordingId: 'recording-b',
        status: 'uploaded',
        uploadId: 'upload-b',
        sessionId: 'session-b',
        participantId: 'participant-b',
        role: 'guest',
        completedAt: 2_000,
        updatedAt: 2_000,
        createdAt: 2_000,
      }),
    ];

    const recorder = {
      persistedRecordings: [],
    } as never;

    const markup = renderToStaticMarkup(
      createElement(ProcessingExportPanel, { recorder }),
    );

    expect(markup).toContain('Export your session');
    expect(markup).not.toContain('recording-a');
    expect(markup).not.toContain('recording-b');
    expect(markup).not.toContain('upload-a');
    expect(markup).not.toContain('upload-b');
  });
});
