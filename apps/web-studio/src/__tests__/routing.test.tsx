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

    expect(markup).toContain('Record remote interviews that survive bad connections.');
    expect(markup).toContain('Keep the guest experience simple while protecting the recording when the connection gets rough.');
    expect(markup).toContain('Start for Free');
    expect(markup).toContain('Login');
    expect(markup).toContain('href="/app"');
    expect(markup).toContain('href="#features"');
    expect(markup).toContain('href="#product"');
    expect(markup).toContain('href="#workflow"');
    expect(markup).toContain('id="features"');
    expect(markup).toContain('id="workflow"');
    expect(markup).toContain('id="product"');
    expect(markup).not.toContain('Remote interviews. Local quality.');
  });

  it('renders the studio app experience at /app', () => {
    const markup = renderApp('/app');

    expect(markup).toContain('What would you like to create today?');
    expect(markup).toContain('Record a remote interview');
    expect(markup).toContain('Upload a recording');
    expect(markup).toContain('Edit a video');
    expect(markup).toContain('Coming soon');
    expect(markup).toContain('Recent recordings');
    expect(markup).toContain('Recent exports');
    expect(markup).toContain('No exports yet.');
    expect(markup).toContain('Exported videos will appear here.');
    expect(markup).toContain('Start recording');
    expect(markup).not.toContain('Remote interviews. Local quality.');
  });

  it('renders the guest invite flow for invite links', () => {
    const markup = renderApp('/guest/example-token');

    expect(markup).toContain('Join the session and check your device.');
    expect(markup).toContain('Looking up invite token');
  });
});
