const navItems = ['Product', 'Workflow', 'Reliability', 'Roadmap'];

const featureChips = [
  'Remote interviews',
  'Local-first recording',
  'Separate raw tracks',
  'Resumable upload',
  '1080p exports',
  'Recovery-first workflow',
];

const focusItems = [
  {
    title: 'Recording foundation',
    body: 'The first release starts with a browser-first shell for resilient interview capture.',
  },
  {
    title: 'Recovery-minded',
    body: 'Everything below the hero stays intentionally minimal while the workflow matures.',
  },
  {
    title: 'Future upload',
    body: 'Upload, auth, sessions, and API integration remain out of scope for this scaffold.',
  },
];

export default function App() {
  return (
    <div className="page-shell">
      <div className="hero-backdrop" aria-hidden="true">
        <span className="hero-backdrop__orb hero-backdrop__orb--purple" />
        <span className="hero-backdrop__orb hero-backdrop__orb--amber" />
        <span className="hero-backdrop__orb hero-backdrop__orb--blue" />
        <span className="hero-backdrop__column" />
        <span className="hero-backdrop__mic" />
        <span className="hero-backdrop__light" />
        <span className="hero-backdrop__stage" />
      </div>

      <header className="topbar">
        <a className="brand" href="#product" aria-label="DNA STUDIO home">
          <span className="brand-mark" aria-hidden="true">
            D
          </span>
          <span className="brand-text">DNA STUDIO</span>
        </a>

        <nav className="nav-links" aria-label="Primary">
          {navItems.map((item) => (
            <a key={item} href={`#${item.toLowerCase()}`}>
              {item}
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <a className="nav-link" href="#roadmap">
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
            <h1 id="hero-title">
              <span className="headline-line">Record remote interviews</span>
              <span className="headline-line">with confidence.</span>
            </h1>
            <p className="subtitle">
              DNA Studio helps creators capture resilient, recoverable interview
              recordings, even when the live connection is unstable.
            </p>

            <ul className="chip-list" aria-label="Planned capabilities">
              {featureChips.map((chip) => (
                <li key={chip} className="chip">
                  <span className="chip-icon" aria-hidden="true" />
                  <span>{chip}</span>
                </li>
              ))}
            </ul>

            <div className="cta-stack">
              <a className="button button--primary" href="#roadmap">
                Start a Session
              </a>
              <p className="supporting-note">
                Local-first recording foundation. Upload and recovery features coming
                soon.
              </p>
            </div>
          </div>
        </section>

        <section className="focus-strip" aria-label="v0.1 focus">
          {focusItems.map((item) => (
            <article key={item.title} className="focus-item" id={item.title.toLowerCase().replace(/\s+/g, '-')}>
              <p className="focus-item__eyebrow">v0.1 focus</p>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
