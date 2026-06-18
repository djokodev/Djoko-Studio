export type RecordingUploadSessionStatus =
  | 'initializing'
  | 'ready'
  | 'uploading'
  | 'paused'
  | 'incomplete'
  | 'uploaded'
  | 'failed'
  | 'canceled';

export type RecordingUploadChunkStatus =
  | 'pending'
  | 'uploaded'
  | 'already_present'
  | 'failed'
  | 'rejected';

export interface RecordingUploadErrorDetails {
  code: string;
  message: string;
  retryable: boolean;
}

export interface RecordingUploadErrorEnvelope {
  error: RecordingUploadErrorDetails;
}

export interface CreateRecordingUploadSessionRequest {
  recordingId: string;
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
  totalBytes: number;
  expectedChunkCount: number;
  chunkSizeBytes: number;
  mimeType: string | null;
  manifestVersion: number;
  clientCreatedAt: string;
}

export interface CreateRecordingUploadSessionResponse {
  recordingId: string;
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
  uploadId: string;
  status: Extract<RecordingUploadSessionStatus, 'initializing' | 'ready'>;
  acceptedChunkSizeBytes: number;
  expectedChunkCount: number;
  uploadedChunkCount: number;
  totalBytes: number;
  uploadedBytes: number;
  missingChunkIndexes: number[];
  rejectedChunkIndexes: number[];
  updatedAt: string;
  expiresAt: string;
}

export interface GetRecordingUploadSessionStatusResponse {
  recordingId: string;
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
  uploadId: string;
  status: RecordingUploadSessionStatus;
  expectedChunkCount: number;
  uploadedChunkCount: number;
  totalBytes: number;
  uploadedBytes: number;
  missingChunkIndexes: number[];
  rejectedChunkIndexes: number[];
  updatedAt: string;
  completedAt: string | null;
}

export interface UploadRecordingChunkRequest {
  recordingId: string;
  uploadId: string;
  chunkIndex: number;
  chunkSizeBytes: number;
  totalBytes: number;
  mimeType: string;
  idempotencyKey: string;
  body: Blob;
  chunkChecksum?: string | null;
}

export interface UploadRecordingChunkResponse {
  recordingId: string;
  uploadId: string;
  chunkIndex: number;
  status: RecordingUploadChunkStatus;
  uploadedBytes: number;
  alreadyPresent: boolean;
  uploadedChunkCount: number;
  missingChunkIndexes: number[];
  rejectedChunkIndexes: number[];
  updatedAt: string;
}

export interface CompleteRecordingUploadSessionResponse {
  recordingId: string;
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
  uploadId: string;
  status: Extract<RecordingUploadSessionStatus, 'uploaded' | 'incomplete' | 'failed'>;
  complete: boolean;
  missingChunkIndexes: number[];
  rejectedChunkIndexes: number[];
  uploadedChunkCount: number;
  uploadedBytes: number;
  updatedAt: string;
}

export interface CancelRecordingUploadSessionResponse {
  recordingId: string;
  sessionId: string;
  participantId: string;
  role: 'host' | 'guest';
  uploadId: string;
  status: Extract<RecordingUploadSessionStatus, 'canceled'>;
  complete: boolean;
  updatedAt: string;
}

export interface RecordingUploadApiPaths {
  createUploadSessionPath: (recordingId: string) => string;
  getUploadSessionStatusPath: (recordingId: string, uploadId: string) => string;
  uploadChunkPath: (recordingId: string, uploadId: string, chunkIndex: number) => string;
  completeUploadSessionPath: (recordingId: string, uploadId: string) => string;
  cancelUploadSessionPath: (recordingId: string, uploadId: string) => string;
}

export interface RecordingUploadClient {
  paths: RecordingUploadApiPaths;
  createUploadSession: (
    request: CreateRecordingUploadSessionRequest,
  ) => Promise<CreateRecordingUploadSessionResponse>;
  getUploadSessionStatus: (
    recordingId: string,
    uploadId: string,
  ) => Promise<GetRecordingUploadSessionStatusResponse>;
  uploadChunk: (request: UploadRecordingChunkRequest) => Promise<UploadRecordingChunkResponse>;
  completeUploadSession: (
    recordingId: string,
    uploadId: string,
  ) => Promise<CompleteRecordingUploadSessionResponse>;
  cancelUploadSession: (
    recordingId: string,
    uploadId: string,
  ) => Promise<CancelRecordingUploadSessionResponse>;
}

const recordingUploadApiPrefix = '/api/recordings';
const defaultUploadBaseUrl = 'http://localhost:8082';

export class RecordingUploadClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'RecordingUploadClientError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function getUploadBaseUrl(): string {
  return import.meta.env.VITE_UPLOAD_BASE_URL?.trim() || defaultUploadBaseUrl;
}

export function createRecordingUploadApiPaths(): RecordingUploadApiPaths {
  return {
    createUploadSessionPath: (recordingId: string) =>
      buildUploadPath(`${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads`),
    getUploadSessionStatusPath: (recordingId: string, uploadId: string) =>
      buildUploadPath(
        `${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads/${encodePathSegment(uploadId)}`,
      ),
    uploadChunkPath: (recordingId: string, uploadId: string, chunkIndex: number) =>
      buildUploadPath(
        `${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads/${encodePathSegment(uploadId)}/chunks/${encodeChunkIndex(chunkIndex)}`,
      ),
    completeUploadSessionPath: (recordingId: string, uploadId: string) =>
      buildUploadPath(
        `${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads/${encodePathSegment(uploadId)}/complete`,
      ),
    cancelUploadSessionPath: (recordingId: string, uploadId: string) =>
      buildUploadPath(
        `${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads/${encodePathSegment(uploadId)}/cancel`,
      ),
  };
}

export function createRecordingUploadApiClient(baseUrl?: string): RecordingUploadClient {
  const resolvedBaseUrl = baseUrl ?? getUploadBaseUrl();
  const paths = createRecordingUploadApiPaths();

  return {
    paths,
    createUploadSession: async (request) => {
      return requestJson<CreateRecordingUploadSessionResponse>(
        resolvedBaseUrl,
        paths.createUploadSessionPath(request.recordingId),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        },
      );
    },
    getUploadSessionStatus: async (recordingId, uploadId) => {
      return requestJson<GetRecordingUploadSessionStatusResponse>(
        resolvedBaseUrl,
        paths.getUploadSessionStatusPath(recordingId, uploadId),
        {
          method: 'GET',
        },
      );
    },
    uploadChunk: async (request) => {
      const headers = new Headers({
        'Content-Type': request.mimeType,
        'X-DNA-Chunk-Index': String(Math.trunc(request.chunkIndex)),
        'X-DNA-Chunk-Size': String(Math.trunc(request.chunkSizeBytes)),
        'X-DNA-Total-Bytes': String(Math.trunc(request.totalBytes)),
        'X-DNA-Idempotency-Key': request.idempotencyKey,
      });

      const chunkChecksum = request.chunkChecksum ?? (await computeBlobSha256Hex(request.body));
      if (chunkChecksum.trim() !== '') {
        headers.set('X-DNA-Chunk-Checksum', chunkChecksum);
      }

      return requestJson<UploadRecordingChunkResponse>(
        resolvedBaseUrl,
        paths.uploadChunkPath(request.recordingId, request.uploadId, request.chunkIndex),
        {
          method: 'PUT',
          headers,
          body: request.body,
        },
      );
    },
    completeUploadSession: async (recordingId, uploadId) => {
      return requestJson<CompleteRecordingUploadSessionResponse>(
        resolvedBaseUrl,
        paths.completeUploadSessionPath(recordingId, uploadId),
        {
          method: 'POST',
        },
      );
    },
    cancelUploadSession: async (recordingId, uploadId) => {
      return requestJson<CancelRecordingUploadSessionResponse>(
        resolvedBaseUrl,
        paths.cancelUploadSessionPath(recordingId, uploadId),
        {
          method: 'POST',
        },
      );
    },
  };
}

export async function computeBlobSha256Hex(blob: Blob): Promise<string> {
  const digest = await computeSha256(await blob.arrayBuffer());
  return toHex(digest);
}

async function requestJson<T>(baseUrl: string, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(buildUploadUrl(baseUrl, path), init);
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    const errorDetails = parseErrorEnvelope(payload, response);
    throw new RecordingUploadClientError(
      errorDetails.code,
      errorDetails.message,
      errorDetails.retryable,
    );
  }

  if (!isRecord(payload)) {
    throw new RecordingUploadClientError(
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
): RecordingUploadErrorDetails {
  if (isRecord(payload)) {
    const maybeError = payload.error;

    if (isRecord(maybeError)) {
      const code = typeof maybeError.code === 'string' ? maybeError.code : 'upload_failed';
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
    code: 'upload_failed',
    message,
    retryable: response.status >= 500,
  };
}

async function computeSha256(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle !== undefined) {
    return globalThis.crypto.subtle.digest('SHA-256', bytes);
  }

  throw new Error('Web Crypto API is unavailable.');
}

function toHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildUploadUrl(baseUrl: string | undefined, path: string): string {
  const trimmedBaseUrl = baseUrl?.trim();
  const trimmedPath = path.trim();

  if (!trimmedBaseUrl) {
    return trimmedPath;
  }

  return new URL(trimmedPath, ensureTrailingSlash(trimmedBaseUrl)).toString();
}

function buildUploadPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function encodeChunkIndex(value: number): string {
  return encodeURIComponent(String(Math.trunc(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
