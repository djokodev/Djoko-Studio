export type RecordingExportStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type RecordingExportRole = 'host' | 'guest';

export interface RecordingExportTarget {
  format: string;
  resolution: string;
}

export interface CreateRecordingExportRequest {
  recordingId: string;
  uploadId: string;
  sessionId: string;
  participantId: string;
  role: RecordingExportRole;
  target: RecordingExportTarget;
}

export interface RecordingExportFailure {
  code: string;
  message: string;
}

export interface RecordingExportManifest {
  manifestVersion: number;
  exportId: string;
  recordingId: string;
  uploadId: string;
  sessionId: string;
  participantId: string;
  role: RecordingExportRole;
  status: RecordingExportStatus;
  targetFormat: string;
  targetResolution: string;
  sourceManifestKey: string;
  outputObjectKey: string;
  outputBytes: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: RecordingExportFailure | null;
}

export interface RecordingExportReadyzResponse {
  status: 'ok' | 'degraded';
  service: string;
  storage: string;
  ffmpeg: string;
  message: string | null;
}

export interface RecordingExportErrorDetails {
  code: string;
  message: string;
  retryable: boolean;
}

export interface RecordingExportErrorEnvelope {
  error: RecordingExportErrorDetails;
}

export interface RecordingExportApiPaths {
  readyzPath: string;
  createExportPath: string;
  exportPath: (exportId: string) => string;
  downloadPath: (exportId: string) => string;
}

export interface RecordingExportClient {
  paths: RecordingExportApiPaths;
  getReadyz: () => Promise<RecordingExportReadyzResponse>;
  createExport: (request: CreateRecordingExportRequest) => Promise<RecordingExportManifest>;
  getExport: (exportId: string) => Promise<RecordingExportManifest>;
  getDownloadUrl: (exportId: string) => string;
  downloadExport: (exportId: string) => Promise<Blob>;
}

const exportApiPrefix = '/api/exports';

export class RecordingExportClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'RecordingExportClientError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function getExportBaseUrl(): string {
  return import.meta.env.VITE_EXPORT_BASE_URL?.trim() ?? '';
}

export function createRecordingExportApiPaths(): RecordingExportApiPaths {
  return {
    readyzPath: '/readyz',
    createExportPath: `${exportApiPrefix}`,
    exportPath: (exportId: string) => `${exportApiPrefix}/${encodePathSegment(exportId)}`,
    downloadPath: (exportId: string) =>
      `${exportApiPrefix}/${encodePathSegment(exportId)}/download`,
  };
}

export function createRecordingExportApiClient(baseUrl?: string): RecordingExportClient {
  const resolvedBaseUrl = baseUrl ?? getExportBaseUrl();
  const paths = createRecordingExportApiPaths();

  return {
    paths,
    getReadyz: async () => {
      return requestJson<RecordingExportReadyzResponse>(
        resolvedBaseUrl,
        paths.readyzPath,
        {
          method: 'GET',
        },
      );
    },
    createExport: async (request) => {
      return requestJson<RecordingExportManifest>(
        resolvedBaseUrl,
        paths.createExportPath,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recordingId: request.recordingId,
            uploadId: request.uploadId,
            sessionId: request.sessionId,
            participantId: request.participantId,
            role: request.role,
            target: request.target,
          }),
        },
      );
    },
    getExport: async (exportId) => {
      return requestJson<RecordingExportManifest>(
        resolvedBaseUrl,
        paths.exportPath(exportId),
        {
          method: 'GET',
        },
      );
    },
    getDownloadUrl: (exportId) => {
      return buildExportUrl(resolvedBaseUrl, paths.downloadPath(exportId));
    },
    downloadExport: async (exportId) => {
      const response = await fetch(buildExportUrl(resolvedBaseUrl, paths.downloadPath(exportId)), {
        method: 'GET',
      });

      if (!response.ok) {
        const payload = await readJsonPayload(response);
        const errorDetails = parseErrorEnvelope(payload, response);
        throw new RecordingExportClientError(
          errorDetails.code,
          errorDetails.message,
          errorDetails.retryable,
        );
      }

      return response.blob();
    },
  };
}

export function isExportWorkerReady(response: RecordingExportReadyzResponse | null): boolean {
  if (response === null) {
    return false;
  }

  return (
    response.status === 'ok' &&
    response.storage === 'ready' &&
    response.ffmpeg === 'available'
  );
}

async function requestJson<T>(baseUrl: string, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(buildExportUrl(baseUrl, path), init);
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    const errorDetails = parseErrorEnvelope(payload, response);
    throw new RecordingExportClientError(
      errorDetails.code,
      errorDetails.message,
      errorDetails.retryable,
    );
  }

  if (!isRecord(payload)) {
    throw new RecordingExportClientError(
      'unexpected_response',
      'Unexpected response format.',
      false,
    );
  }

  return payload as T;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function parseErrorEnvelope(
  payload: unknown,
  response: Response,
): RecordingExportErrorDetails {
  if (isRecord(payload)) {
    const maybeError = payload.error;

    if (isRecord(maybeError)) {
      const code = typeof maybeError.code === 'string' ? maybeError.code : 'export_failed';
      const message =
        typeof maybeError.message === 'string' && maybeError.message.trim() !== ''
          ? maybeError.message
          : `Request failed with status ${response.status}`;
      const retryable = typeof maybeError.retryable === 'boolean' ? maybeError.retryable : false;

      return { code, message, retryable };
    }
  }

  const message =
    response.statusText.trim() !== ''
      ? `Request failed with status ${response.status} ${response.statusText}`
      : `Request failed with status ${response.status}`;

  return {
    code: 'export_failed',
    message,
    retryable: response.status >= 500,
  };
}

export function buildExportUrl(baseUrl: string | undefined, path: string): string {
  const trimmedBaseUrl = baseUrl?.trim();
  const trimmedPath = path.trim();

  if (!trimmedBaseUrl) {
    return trimmedPath;
  }

  return new URL(trimmedPath, ensureTrailingSlash(trimmedBaseUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
