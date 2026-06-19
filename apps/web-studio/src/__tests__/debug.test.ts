import { beforeEach, describe, expect, it, vi } from 'vitest';
import { debugLog, isDebugEnabled } from '../lib/debug';

type WindowMock = {
  location: {
    search: string;
  };
  localStorage: {
    clear: () => void;
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
};

const storage = new Map<string, string>();
const windowMock: WindowMock = {
  location: {
    search: '',
  },
  localStorage: {
    clear: () => {
      storage.clear();
    },
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  },
};

describe('debug helper', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    windowMock.location.search = '';
    windowMock.localStorage.clear();
    vi.stubGlobal('window', windowMock);
  });

  it('is disabled by default', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    expect(isDebugEnabled()).toBe(false);

    debugLog('app', 'hidden message');

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('enables debug mode from the query string', () => {
    windowMock.location.search = '?debug=1';

    expect(isDebugEnabled()).toBe(true);
  });

  it('enables debug mode from localStorage', () => {
    windowMock.localStorage.setItem('dna-studio-debug', '1');

    expect(isDebugEnabled()).toBe(true);
  });

  it('logs to console only when debug mode is enabled', () => {
    windowMock.location.search = '?debug=1';
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    debugLog('app', 'visible message');

    expect(debugSpy).toHaveBeenCalledWith('[app]', 'visible message');
  });
});
