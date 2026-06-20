import { useEffect } from 'react';
import { appRoutes } from '../navigation/routes';

type ProofPoint = {
  label: string;
  value: string;
  detail: string;
};

type FeatureCard = {
  eyebrow: string;
  title: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
};

type WorkflowStep = {
  number: string;
  title: string;
  description: string;
};

const proofPoints: ProofPoint[] = [
  {
    label: 'Local-first capture',
    value: 'Records stay on the host and guest machines first',
    detail: 'The browser keeps quality high even when the network is not.',
  },
  {
    label: 'Recovery built in',
    value: 'Refresh-safe recording and persistence recovery',
    detail: 'Completed work can survive tab closes, crashes, and unstable sessions.',
  },
  {
    label: 'Resumable upload',
    value: 'Chunked transfer that can continue later',
    detail: 'Large recordings move safely without forcing a single fragile upload.',
  },
  {
    label: '1080p export',
    value: 'Final MP4 output tuned for polished delivery',
    detail: 'The finished result is ready for sharing, publishing, or downloading.',
  },
];

const featureCards: FeatureCard[] = [
  {
    eyebrow: 'Recording',
    title: 'Local-first recording built for bad connections',
    description:
      'DNA STUDIO records locally in the browser so the source quality is not hostage to the live call.',
    imageSrc: '/images/landing/feature-local-first-recording.png',
    imageAlt: 'DNA STUDIO local-first recording screen with browser capture controls',
  },
  {
    eyebrow: 'Transport',
    title: 'Resumable upload for long-form sessions',
    description:
      'Chunks upload safely and can be resumed instead of restarting from zero after a network drop.',
    imageSrc: '/images/landing/feature-resumable-upload.png',
    imageAlt: 'DNA STUDIO resumable upload dashboard with chunk progress and recovery state',
  },
  {
    eyebrow: 'Delivery',
    title: 'Polished 1080p export for the final handoff',
    description:
      'The export path is designed to produce a credible finished video, not just a raw capture dump.',
    imageSrc: '/images/landing/feature-1080p-export.png',
    imageAlt: 'DNA STUDIO export dashboard showing 1080p MP4 delivery status',
  },
];

const workflowSteps: WorkflowStep[] = [
  {
    number: '01',
    title: 'Create the session in the app',
    description:
      'Open /app to start the host flow, set up the recording session, and prepare the guest invite.',
  },
  {
    number: '02',
    title: 'Let the guest join with the invite link',
    description:
      'Guests enter through a single invite URL that stays simple and does not require an account.',
  },
  {
    number: '03',
    title: 'Check devices, record locally, and export',
    description:
      'The studio checks camera and microphone, captures locally, recovers from disruption, and exports in 1080p.',
  },
];

function LandingMetric({ item }: { item: ProofPoint }) {
  return (
    <article className="landing-metric">
      <p className="landing-metric__label">{item.label}</p>
      <h3 className="landing-metric__value">{item.value}</h3>
      <p className="landing-metric__detail">{item.detail}</p>
    </article>
  );
}

function LandingFeatureCard({ item }: { item: FeatureCard }) {
  return (
    <article className="landing-feature-card">
      <img className="landing-feature-card__image" src={item.imageSrc} alt={item.imageAlt} />
      <div className="landing-feature-card__body">
        <p className="landing-feature-card__eyebrow">{item.eyebrow}</p>
        <h3>{item.title}</h3>
        <p>{item.description}</p>
      </div>
    </article>
  );
}

function LandingWorkflowStep({ item }: { item: WorkflowStep }) {
  return (
    <article className="landing-step">
      <p className="landing-step__number">{item.number}</p>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
    </article>
  );
}

export function LandingPage() {
  useEffect(() => {
    document.title = 'DNA STUDIO | Remote interviews. Local quality.';
  }, []);

  return (
    <main className="landing-page">
      <div className="landing-page__glow landing-page__glow--one" aria-hidden="true" />
      <div className="landing-page__glow landing-page__glow--two" aria-hidden="true" />

      <header className="landing-nav">
        <div className="landing-nav__brand">
          <p className="landing-brand">DNA STUDIO</p>
          <p className="landing-brand__tagline">Remote interviews. Local quality.</p>
        </div>

        <nav className="landing-nav__links" aria-label="Primary">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a className="landing-button landing-button--ghost" href={appRoutes.appHome}>
            Open app
          </a>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-hero-title">
        <div className="landing-hero__copy">
          <p className="landing-kicker">Remote interviews. Local quality.</p>
          <h1 id="landing-hero-title">
            Record high-quality conversations locally, recover when the network drops, and ship
            polished 1080p video.
          </h1>
          <p className="landing-hero__lede">
            DNA STUDIO is a premium interview recorder for unstable connections: local-first
            capture, refresh-safe recovery, resumable upload, guest invite links, and a final
            export flow designed to feel production ready.
          </p>

          <div className="landing-hero__actions">
            <a className="landing-button landing-button--primary" href={appRoutes.appHome}>
              Open the app
            </a>
            <a className="landing-button landing-button--secondary" href="#workflow">
              See how it works
            </a>
          </div>

          <ul className="landing-pill-row" aria-label="Product strengths">
            <li>Local-first recording</li>
            <li>Resumable upload</li>
            <li>Recording recovery</li>
            <li>Guest invite flow</li>
            <li>1080p export</li>
          </ul>
        </div>

        <div className="landing-hero__visual" aria-label="DNA STUDIO product preview">
          <div className="landing-hero__frame">
            <img
              className="landing-hero__image"
              src="/images/landing/hero-remote-interviews.png"
              alt="DNA STUDIO hero preview for remote interviews and local recording"
              fetchPriority="high"
            />
          </div>

          <div className="landing-hero__badge landing-hero__badge--top">
            <span className="landing-hero__badge-label">Built for unstable networks</span>
            <strong>Local capture first</strong>
          </div>

          <div className="landing-hero__badge landing-hero__badge--middle">
            <span className="landing-hero__badge-label">Guest invite flow</span>
            <strong>Account-light joining</strong>
          </div>

          <div className="landing-hero__badge landing-hero__badge--bottom">
            <span className="landing-hero__badge-label">Final output</span>
            <strong>1080p MP4 export</strong>
          </div>
        </div>
      </section>

      <section className="landing-metrics" aria-label="Product proof points">
        {proofPoints.map((item) => (
          <LandingMetric key={item.label} item={item} />
        ))}
      </section>

      <section id="features" className="landing-section" aria-labelledby="features-title">
        <div className="landing-section__heading">
          <p className="landing-kicker">Product strengths</p>
          <h2 id="features-title">Built for the real failure modes of remote recording.</h2>
          <p>
            The product keeps recording, transport, and export boundaries separate so a bad
            connection does not destroy the session.
          </p>
        </div>

        <div className="landing-feature-grid">
          {featureCards.map((item) => (
            <LandingFeatureCard key={item.title} item={item} />
          ))}
        </div>
      </section>

      <section id="workflow" className="landing-section landing-section--workflow" aria-labelledby="workflow-title">
        <div className="landing-section__heading">
          <p className="landing-kicker">Simple workflow</p>
          <h2 id="workflow-title">A clean host and guest flow, from invite to export.</h2>
          <p>
            Hosts create the session, guests join with the invite link, and the studio handles
            device check, capture, upload, and delivery in a tight sequence.
          </p>
        </div>

        <div className="landing-workflow">
          <div className="landing-workflow__steps">
            {workflowSteps.map((item) => (
              <LandingWorkflowStep key={item.number} item={item} />
            ))}
          </div>

          <div className="landing-workflow__visuals">
            <figure className="landing-workflow__figure landing-workflow__figure--primary">
              <img
                src="/images/landing/dashboard-home.png"
                alt="DNA STUDIO dashboard home screen with session overview and recording workflow"
              />
              <figcaption>Studio home dashboard</figcaption>
            </figure>

            <figure className="landing-workflow__figure landing-workflow__figure--secondary">
              <img
                src="/images/landing/prejoin-device-check.png"
                alt="DNA STUDIO pre-join device check screen for camera and microphone readiness"
              />
              <figcaption>Pre-join device check</figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="landing-cta" aria-labelledby="landing-cta-title">
        <div>
          <p className="landing-kicker">Ready to run the studio</p>
          <h2 id="landing-cta-title">Open the app and start a recording session.</h2>
          <p>
            The public landing page introduces the product, while the app keeps the current
            workflow under /app and guest invite links under /guest/:inviteToken.
          </p>
        </div>

        <a className="landing-button landing-button--primary" href={appRoutes.appHome}>
          Open the app
        </a>
      </section>

      <footer className="landing-footer">
        <p>DNA STUDIO</p>
        <p>Remote interviews. Local quality.</p>
      </footer>
    </main>
  );
}
