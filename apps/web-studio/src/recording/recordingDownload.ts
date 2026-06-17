const recordingDownloadPrefix = 'dna-studio';
const recordingDownloadBaseName = 'local-recording';

export interface BuildLocalRecordingFilenameOptions {
  recordingId?: string | null;
  startedAt?: number | null;
  mimeType?: string | null;
}

export function getRecordingFileExtension(mimeType?: string | null): 'webm' | 'mp4' | 'ogg' {
  const normalizedMimeType = normalizeMimeType(mimeType);

  if (normalizedMimeType === null) {
    return 'webm';
  }

  if (normalizedMimeType === 'video/mp4') {
    return 'mp4';
  }

  if (
    normalizedMimeType === 'audio/ogg' ||
    normalizedMimeType === 'video/ogg' ||
    normalizedMimeType === 'application/ogg'
  ) {
    return 'ogg';
  }

  if (
    normalizedMimeType === 'video/webm' ||
    normalizedMimeType === 'audio/webm' ||
    normalizedMimeType === 'application/webm'
  ) {
    return 'webm';
  }

  return 'webm';
}

export function buildLocalRecordingFilename({
  recordingId,
  startedAt,
  mimeType,
}: BuildLocalRecordingFilenameOptions): string {
  const segments = [recordingDownloadPrefix, recordingDownloadBaseName];

  const safeRecordingId = sanitizeFilenameSegment(recordingId);
  if (safeRecordingId !== null) {
    segments.push(safeRecordingId);
  }

  const safeTimestamp = formatTimestampSegment(startedAt);
  if (safeTimestamp !== null) {
    segments.push(safeTimestamp);
  }

  const fileExtension = getRecordingFileExtension(mimeType);
  const baseName = segments.join('-') || `${recordingDownloadPrefix}-${recordingDownloadBaseName}`;

  return `${baseName}.${fileExtension}`;
}

function normalizeMimeType(mimeType: string | null | undefined): string | null {
  const trimmedMimeType = mimeType?.trim().toLowerCase();

  if (trimmedMimeType === undefined || trimmedMimeType === '') {
    return null;
  }

  return trimmedMimeType.split(';', 1)[0] ?? null;
}

function sanitizeFilenameSegment(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim();

  if (trimmedValue === undefined || trimmedValue === '') {
    return null;
  }

  const sanitizedValue = trimmedValue
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return sanitizedValue === '' ? null : sanitizedValue;
}

function formatTimestampSegment(startedAt: number | null | undefined): string | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
    return null;
  }

  const timestamp = new Date(startedAt).toISOString();
  return sanitizeFilenameSegment(timestamp.replace(/[:.]/g, '-'));
}
