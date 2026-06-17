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
  totalBytes: number;
  expectedChunkCount: number;
  chunkSizeBytes: number;
  mimeType: string | null;
  manifestVersion: number;
  clientCreatedAt: string;
}

export interface CreateRecordingUploadSessionResponse {
  recordingId: string;
  uploadId: string;
  status: Extract<RecordingUploadSessionStatus, 'initializing' | 'ready'>;
  acceptedChunkSizeBytes: number;
  expiresAt: string;
}

export interface GetRecordingUploadSessionStatusResponse {
  recordingId: string;
  uploadId: string;
  status: RecordingUploadSessionStatus;
  expectedChunkCount: number;
  uploadedChunkCount: number;
  totalBytes: number;
  uploadedBytes: number;
  missingChunkIndexes: number[];
  rejectedChunkIndexes: number[];
  updatedAt: string;
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
}

export interface CompleteRecordingUploadSessionResponse {
  recordingId: string;
  uploadId: string;
  status: Extract<RecordingUploadSessionStatus, 'uploaded' | 'incomplete' | 'failed'>;
  complete: boolean;
  missingChunkIndexes: number[];
  rejectedChunkIndexes: number[];
  updatedAt: string;
}

export interface CancelRecordingUploadSessionResponse {
  recordingId: string;
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

export interface DisabledRecordingUploadClient {
  paths: RecordingUploadApiPaths;
  createUploadSession: (
    request: CreateRecordingUploadSessionRequest,
  ) => Promise<CreateRecordingUploadSessionResponse>;
  getUploadSessionStatus: (
    recordingId: string,
    uploadId: string,
  ) => Promise<GetRecordingUploadSessionStatusResponse>;
  uploadChunk: (
    request: UploadRecordingChunkRequest,
  ) => Promise<UploadRecordingChunkResponse>;
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

export class RecordingUploadClientDisabledError extends Error {
  constructor(methodName: string) {
    super(
      `Recording uploads are disabled in this build. ${methodName} cannot perform network I/O.`,
    );
    this.name = 'RecordingUploadClientDisabledError';
  }
}

export function createRecordingUploadApiPaths(baseUrl?: string): RecordingUploadApiPaths {
  return {
    createUploadSessionPath: (recordingId: string) =>
      joinRecordingUploadApiPath(
        baseUrl,
        `${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads`,
      ),
    getUploadSessionStatusPath: (recordingId: string, uploadId: string) =>
      joinRecordingUploadApiPath(
        baseUrl,
        `${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads/${encodePathSegment(uploadId)}`,
      ),
    uploadChunkPath: (recordingId: string, uploadId: string, chunkIndex: number) =>
      joinRecordingUploadApiPath(
        baseUrl,
        `${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads/${encodePathSegment(uploadId)}/chunks/${encodeChunkIndex(chunkIndex)}`,
      ),
    completeUploadSessionPath: (recordingId: string, uploadId: string) =>
      joinRecordingUploadApiPath(
        baseUrl,
        `${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads/${encodePathSegment(uploadId)}/complete`,
      ),
    cancelUploadSessionPath: (recordingId: string, uploadId: string) =>
      joinRecordingUploadApiPath(
        baseUrl,
        `${recordingUploadApiPrefix}/${encodePathSegment(recordingId)}/uploads/${encodePathSegment(uploadId)}/cancel`,
      ),
  };
}

export function createDisabledRecordingUploadClient(
  baseUrl?: string,
): DisabledRecordingUploadClient {
  const paths = createRecordingUploadApiPaths(baseUrl);

  return {
    paths,
    createUploadSession: async () => {
      throw new RecordingUploadClientDisabledError('createUploadSession');
    },
    getUploadSessionStatus: async () => {
      throw new RecordingUploadClientDisabledError('getUploadSessionStatus');
    },
    uploadChunk: async () => {
      throw new RecordingUploadClientDisabledError('uploadChunk');
    },
    completeUploadSession: async () => {
      throw new RecordingUploadClientDisabledError('completeUploadSession');
    },
    cancelUploadSession: async () => {
      throw new RecordingUploadClientDisabledError('cancelUploadSession');
    },
  };
}

function joinRecordingUploadApiPath(baseUrl: string | undefined, path: string): string {
  const trimmedBaseUrl = baseUrl?.trim();

  if (!trimmedBaseUrl) {
    return path;
  }

  return `${trimmedBaseUrl.replace(/\/+$/, '')}${path}`;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function encodeChunkIndex(value: number): string {
  return encodeURIComponent(String(Math.trunc(value)));
}
