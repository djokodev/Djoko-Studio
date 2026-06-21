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

function renderApp(path: string): string {
  const url = new URL(path, windowMock.location.origin);
  windowMock.location.pathname = url.pathname;
  windowMock.location.search = url.search;
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

    expect(markup).toContain('Dashboard');
    expect(markup).toContain('What would you like to create today?');
    expect(markup).toContain('Record');
    expect(markup).toContain('Upload');
    expect(markup).toContain('Edit a video');
    expect(markup).toContain('Coming soon');
    expect(markup).toContain('Recent work');
    expect(markup).toContain('Recent recordings');
    expect(markup).toContain('Recent exports');
    expect(markup).toContain('No exports yet.');
    expect(markup).toContain('Exported videos will appear here.');
    expect(markup).toContain('href="/app?workspace=record#app-record-flow"');
    expect(markup).toContain('href="/app?workspace=upload#app-upload-flow"');
    expect(markup).not.toContain('Preview app');
    expect(markup).not.toContain('Start a recording session');
    expect(markup).not.toContain('Local camera/microphone preview');
    expect(markup).not.toContain('Local recording prototype');
    expect(markup).not.toContain('Playback preview');
    expect(markup).not.toContain('Upload readiness');
    expect(markup).not.toContain('Upload queue item');
    expect(markup).not.toContain('Remote interviews. Local quality.');
  });

  it('renders the recording workspace when requested inside /app', () => {
    const markup = renderApp('/app?workspace=record');

    expect(markup).toContain('Recording workspace');
    expect(markup).toContain('Back to dashboard');
    expect(markup).toContain('Start a recording session');
    expect(markup).toContain('Local camera/microphone preview');
    expect(markup).toContain('Local recording prototype');
  });

  it('renders the upload workspace when requested inside /app', () => {
    const markup = renderApp('/app?workspace=upload');

    expect(markup).toContain('Upload workspace');
    expect(markup).toContain('Back to dashboard');
    expect(markup).toContain('Upload local copy');
    expect(markup).not.toContain('Local camera/microphone preview');
    expect(markup).not.toContain('Local recording prototype');
    expect(markup).not.toContain('Playback preview');
  });

  it('renders the guest invite flow for invite links', () => {
    const markup = renderApp('/guest/example-token');

    expect(markup).toContain('Join the session and check your device.');
    expect(markup).toContain('Looking up invite token');
  });
});
