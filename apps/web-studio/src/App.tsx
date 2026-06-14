const plannedCapabilities = [
  'browser-based recording',
  'local-first media safety',
  'resumable upload',
  'separate raw tracks',
  'final 1080p export',
];

export default function App() {
  return (
    <div className="page">
      <main className="panel" aria-labelledby="studio-title">
        <p className="eyebrow">v0.1 frontend scaffold</p>
        <h1 id="studio-title">Djoko Studio</h1>
        <p className="promise">
          Remote interview recording built for resilient, recoverable sessions.
        </p>
        <p className="notice">
          Recording features are not implemented yet. This screen is the first
          browser-facing foundation for the web studio.
        </p>

        <section className="section" aria-labelledby="planned-capabilities">
          <div className="section-heading">
            <p className="section-label">Planned v0.1 capabilities</p>
            <h2 id="planned-capabilities">What this scaffold is preparing for</h2>
          </div>

          <ul className="capability-list">
            {plannedCapabilities.map((capability) => (
              <li key={capability} className="capability-card">
                {capability}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
