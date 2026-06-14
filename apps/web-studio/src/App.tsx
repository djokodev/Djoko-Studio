import type { CSSProperties } from 'react';

const navItems = [
  { label: 'Product', href: '#product' },
  { label: 'Workflow', href: '#workflow' },
  { label: 'Reliability', href: '#reliability' },
  { label: 'Roadmap', href: '#roadmap' },
];

const featureChips = [
  'Remote interviews',
  'Local-first recording',
  'Separate raw tracks',
  'Resumable upload',
  '1080p exports',
  'Recovery-first workflow',
];

const highlightCards = [
  {
    id: 'workflow',
    eyebrow: 'Workflow',
    title: 'Built for recoverable sessions',
    body:
      'The temporary home page sets the tone for a browser-first workflow that will later guide recording, upload, and recovery flows.',
  },
  {
    id: 'reliability',
    eyebrow: 'Reliability',
    title: 'Local-first by default',
    body:
      'The product story centers on resilient sessions, preserved media, and future upload recovery without depending on a stable call.',
  },
  {
    id: 'roadmap',
    eyebrow: 'Roadmap',
    title: 'v0.1 foundation only',
    body:
      'This scaffold intentionally stops before recording logic, WebRTC, auth, sessions, or API integration so the first experience stays focused.',
  },
];

export default function App() {
  return (
    <div className="page-shell">
      <div className="page-glow page-glow--left" aria-hidden="true" />
      <div className="page-glow page-glow--right" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#product" aria-label="DJOKO STUDIO home">
          <span className="brand-mark" aria-hidden="true">
            D
          </span>
          <span className="brand-text">DJOKO STUDIO</span>
        </a>

        <nav className="nav-links" aria-label="Primary">
          {navItems.map((item) => (
            <a key={item.label} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <a className="nav-link nav-link--muted" href="#roadmap">
            Login
          </a>
          <a className="button button--ghost" href="#roadmap">
            Start for Free
          </a>
        </div>
      </header>

      <main className="page-content">
        <section className="hero" id="product" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">Temporary home page</p>
            <h1 id="hero-title">Record remote interviews with confidence.</h1>
            <p className="subtitle">
              Djoko Studio helps creators capture resilient, recoverable interview
              recordings, even when the live connection is unstable.
            </p>

            <div className="cta-row" aria-label="Primary actions">
              <a className="button button--primary" href="#roadmap">
                Start a Session
              </a>
              <a className="button button--secondary" href="#workflow">
                View Recording Plan
              </a>
            </div>

            <p className="supporting-note">
              Local-first recording foundation. Upload and recovery features coming
              soon.
            </p>

            <ul className="chip-list" aria-label="Planned capabilities">
              {featureChips.map((chip) => (
                <li key={chip} className="chip">
                  {chip}
                </li>
              ))}
            </ul>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="visual-backdrop visual-backdrop--one" />
            <div className="visual-backdrop visual-backdrop--two" />

            <article className="studio-card">
              <div className="studio-card__topline">
                <span className="rec-badge">REC</span>
                <span className="studio-timer">00:12:48</span>
              </div>

              <div className="studio-preview">
                <div className="preview-tile preview-tile--host">
                  <span className="preview-label">Host</span>
                  <div className="avatar avatar--host" />
                </div>
                <div className="preview-tile preview-tile--guest">
                  <span className="preview-label">Guest</span>
                  <div className="avatar avatar--guest" />
                </div>
                <div className="preview-tile preview-tile--notes">
                  <span className="preview-label">Session health</span>
                  <div className="health-lines">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>

              <div className="waveform" aria-hidden="true">
                {Array.from({ length: 18 }, (_, index) => (
                  <span
                    key={index}
                    style={{ '--bar-height': `${34 + ((index * 17) % 56)}%` } as CSSProperties}
                  />
                ))}
              </div>

              <div className="control-strip">
                <span className="control-pill control-pill--active">Tracking</span>
                <span className="control-pill">Local cache</span>
                <span className="control-pill">Upload queue</span>
              </div>
            </article>
          </div>
        </section>

        <section className="highlight-grid" aria-label="Supporting product sections">
          {highlightCards.map((card) => (
            <article key={card.id} className="info-card" id={card.id}>
              <p className="eyebrow">{card.eyebrow}</p>
              <h2>{card.title}</h2>
              <p>{card.body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
