import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

type WindowMock = {
  location: {
    pathname: string;
    origin: string;
    search: string;
  };
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
    clear: () => void;
  };
};

const storage = new Map<string, string>();
const windowMock: WindowMock = {
  location: {
    pathname: '/',
    origin: 'http://localhost:5173',
    search: '',
  },
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  },
};

function renderApp(pathname: string): string {
  windowMock.location.pathname = pathname;
  return renderToStaticMarkup(<App />);
}

describe('app routing', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    windowMock.location.pathname = '/';
    windowMock.location.search = '';
    windowMock.localStorage.clear();
    vi.stubGlobal('window', windowMock);
  });

  it('renders the public landing page at /', () => {
    const markup = renderApp('/');

    expect(markup).toContain('DNA STUDIO is a premium interview recorder for unstable connection.');
    expect(markup).toContain('Start for Free');
    expect(markup).toContain('Login');
    expect(markup).toContain('href="/app"');
    expect(markup).toContain('href="#product"');
    expect(markup).toContain('id="workflow"');
    expect(markup).toContain('id="product"');
  });

  it('renders the studio app experience at /app', () => {
    const markup = renderApp('/app');

    expect(markup).toContain('Create a session and invite your guest.');
    expect(markup).not.toContain('Remote interviews. Local quality.');
  });

  it('renders the guest invite flow for invite links', () => {
    const markup = renderApp('/guest/example-token');

    expect(markup).toContain('Join the session and check your device.');
    expect(markup).toContain('Looking up invite token');
  });
});
