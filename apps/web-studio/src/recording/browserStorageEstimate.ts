export type BrowserStorageEstimateState = 'available' | 'unavailable' | 'failed';

export interface BrowserStorageEstimate {
  state: BrowserStorageEstimateState;
  usageBytes: number | null;
  quotaBytes: number | null;
  errorMessage: string | null;
}

export async function getBrowserStorageEstimate(): Promise<BrowserStorageEstimate> {
  if (
    typeof globalThis.navigator === 'undefined' ||
    globalThis.navigator.storage === undefined ||
    typeof globalThis.navigator.storage.estimate !== 'function'
  ) {
    return {
      state: 'unavailable',
      usageBytes: null,
      quotaBytes: null,
      errorMessage: null,
    };
  }

  try {
    const estimate = await globalThis.navigator.storage.estimate();

    return {
      state: 'available',
      usageBytes: normalizeEstimateValue(estimate.usage),
      quotaBytes: normalizeEstimateValue(estimate.quota),
      errorMessage: null,
    };
  } catch (error) {
    return {
      state: 'failed',
      usageBytes: null,
      quotaBytes: null,
      errorMessage: getBrowserStorageEstimateErrorMessage(
        error,
        'Browser storage usage could not be estimated.',
      ),
    };
  }
}

function normalizeEstimateValue(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getBrowserStorageEstimateErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { message?: unknown };

    if (typeof maybeError.message === 'string' && maybeError.message.trim() !== '') {
      return maybeError.message;
    }
  }

  return fallbackMessage;
}
