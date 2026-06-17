export type LocalRecordingIntegrityStatus = 'healthy' | 'warning' | 'unknown';

export interface LocalRecordingIntegrityReport {
  recordingId: string;
  status: LocalRecordingIntegrityStatus;
  expectedChunkCount: number;
  storedChunkCount: number;
  missingChunkCount: number;
  expectedBytes: number;
  storedBytes: number;
  checkedAt: number | null;
  warnings: string[];
}

export interface CreateLocalRecordingIntegrityReportInput {
  recordingId: string;
  expectedChunkCount: number;
  storedChunkCount: number;
  missingChunkCount: number;
  expectedBytes: number;
  storedBytes: number;
  checkedAt: number | null;
  verificationAvailable: boolean;
  warnings?: readonly string[];
}

export function createLocalRecordingIntegrityReport(
  input: CreateLocalRecordingIntegrityReportInput,
): LocalRecordingIntegrityReport {
  const expectedChunkCount = normalizeNonNegativeInteger(input.expectedChunkCount);
  const storedChunkCount = normalizeNonNegativeInteger(input.storedChunkCount);
  const missingChunkCount = normalizeNonNegativeInteger(input.missingChunkCount);
  const expectedBytes = normalizeNonNegativeInteger(input.expectedBytes);
  const storedBytes = normalizeNonNegativeInteger(input.storedBytes);
  const warnings = normalizeWarnings(input.warnings);
  const status = getLocalRecordingIntegrityStatus({
    verificationAvailable: input.verificationAvailable,
    warnings,
    expectedChunkCount,
    storedChunkCount,
    missingChunkCount,
    expectedBytes,
    storedBytes,
  });

  return {
    recordingId: input.recordingId,
    status,
    expectedChunkCount,
    storedChunkCount,
    missingChunkCount,
    expectedBytes,
    storedBytes,
    checkedAt: normalizeCheckedAt(input.checkedAt),
    warnings,
  };
}

export function createUnknownLocalRecordingIntegrityReport(
  recordingId: string,
  warnings: readonly string[] = [],
  checkedAt: number | null = Date.now(),
): LocalRecordingIntegrityReport {
  return createLocalRecordingIntegrityReport({
    recordingId,
    expectedChunkCount: 0,
    storedChunkCount: 0,
    missingChunkCount: 0,
    expectedBytes: 0,
    storedBytes: 0,
    checkedAt,
    verificationAvailable: false,
    warnings,
  });
}

export function getLocalRecordingIntegrityStatus(input: {
  verificationAvailable: boolean;
  warnings: readonly string[];
  expectedChunkCount: number;
  storedChunkCount: number;
  missingChunkCount: number;
  expectedBytes: number;
  storedBytes: number;
}): LocalRecordingIntegrityStatus {
  if (!input.verificationAvailable) {
    return 'unknown';
  }

  const hasMismatch =
    input.expectedChunkCount !== input.storedChunkCount ||
    input.expectedBytes !== input.storedBytes ||
    input.missingChunkCount > 0 ||
    input.warnings.length > 0;

  return hasMismatch ? 'warning' : 'healthy';
}

function normalizeWarnings(warnings: readonly string[] = []): string[] {
  const normalizedWarnings: string[] = [];
  const seenWarnings = new Set<string>();

  for (const warning of warnings) {
    const normalizedWarning = warning.trim();
    if (normalizedWarning === '' || seenWarnings.has(normalizedWarning)) {
      continue;
    }

    seenWarnings.add(normalizedWarning);
    normalizedWarnings.push(normalizedWarning);
  }

  return normalizedWarnings;
}

function normalizeCheckedAt(checkedAt: number | null): number | null {
  return typeof checkedAt === 'number' && Number.isFinite(checkedAt) ? checkedAt : null;
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.trunc(value);
}
