import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProcessingExportPanel,
  getExportFailureMessage,
  isStartExportDisabled,
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

  it('selects the latest uploaded export candidate', () => {
    mockQueue.items = [
      {
        recording: { recordingId: 'recording-1', manifest: {} },
        state: { status: 'ready' },
      },
      {
        recording: { recordingId: 'recording-2', manifest: {} },
        state: {
          status: 'uploaded',
          sessionId: 'session-2',
          participantId: 'participant-2',
          role: 'guest',
          uploadId: 'upload-2',
        },
      },
    ];

    const candidate = selectLatestExportCandidate(mockQueue.items as never);

    expect(candidate).toEqual({
      recordingId: 'recording-2',
      sessionId: 'session-2',
      participantId: 'participant-2',
      role: 'guest',
      uploadId: 'upload-2',
      uploadStatus: 'uploaded',
    });
    expect(getExportTargetLabel()).toBe('MP4 1080p');
    expect(getExportStatusSummaryLabel(null)).toBe('Not started');
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
      }),
    ).toBe(true);
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

    expect(markup).toContain('Processing &amp; Export dashboard');
    expect(markup).toContain('Export service is not configured. Set VITE_EXPORT_BASE_URL.');
    expect(markup).toContain('disabled');
  });
});
