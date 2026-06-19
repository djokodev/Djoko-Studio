const debugStorageKey = 'dna-studio-debug';
const debugQueryParamName = 'debug';

export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const queryValue = searchParams.get(debugQueryParamName);
    if (queryValue === '1' || queryValue === 'true') {
      return true;
    }
  } catch {
    // Ignore malformed location state and fall through to storage.
  }

  try {
    return window.localStorage.getItem(debugStorageKey) === '1';
  } catch {
    return false;
  }
}

export function debugLog(scope: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) {
    return;
  }

  console.debug(`[${scope}]`, ...args);
}
