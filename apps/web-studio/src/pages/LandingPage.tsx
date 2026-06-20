import { useEffect, useRef } from 'react';
import { appRoutes } from '../navigation/routes';

type FeatureCard = {
  title: string;
  description: string;
};

type FlowStep = {
  number: string;
  title: string;
  description: string;
};

const featureCards: FeatureCard[] = [
  {
    title: 'Local-first capture',
    description:
      'The recording starts on each participant’s device first, keeping quality protected when the network is unstable.',
  },
  {
    title: 'Recovery built in',
    description: 'Refreshes, crashes, and interruptions should not destroy the recording flow.',
  },
  {
    title: 'Resumable upload',
    description: 'Large recordings can continue later instead of restarting from zero.',
  },
  {
    title: '1080p export',
    description: 'Prepare a clean MP4 output ready for download and publishing.',
  },
];

const studioFlowSteps: FlowStep[] = [
  {
    number: '01',
    title: 'Create session',
    description: 'Set up the recording room and prepare the studio.',
  },
  {
    number: '02',
    title: 'Invite guest',
    description: 'Share a simple invite link with no account friction.',
  },
  {
    number: '03',
    title: 'Record locally',
    description: 'Capture on device first so the source remains protected.',
  },
  {
    number: '04',
    title: 'Export MP4',
    description: 'Finish with a clean 1080p deliverable.',
  },
];

const workflowSteps: FlowStep[] = [
  {
    number: '01',
    title: 'Create the session',
    description: 'Start the room and define the recording run.',
  },
  {
    number: '02',
    title: 'Invite your guest',
    description: 'Send the invite and keep onboarding lightweight.',
  },
  {
    number: '03',
    title: 'Record locally',
    description: 'Let the browser capture on each device first.',
  },
  {
    number: '04',
    title: 'Upload safely',
    description: 'Move the recording in chunks that can resume.',
  },
  {
    number: '05',
    title: 'Export in 1080p',
    description: 'Package a polished MP4 ready to share.',
  },
];

function FeatureCardView({ item }: { item: FeatureCard }) {
  return (
    <article className="landing-card landing-card--feature landing-reveal" data-reveal>
      <div className="landing-card__accent" aria-hidden="true" />
      <h3>{item.title}</h3>
      <p>{item.description}</p>
    </article>
  );
}

function FlowStepView({ item }: { item: FlowStep }) {
  return (
    <article className="landing-flow-step landing-reveal" data-reveal>
      <p className="landing-flow-step__number">{item.number}</p>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
    </article>
  );
}

export function LandingPage() {
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    document.title = 'DNA STUDIO | Public landing page';
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }

    const targets = root.querySelectorAll<HTMLElement>('[data-reveal]');
    if (targets.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      {
        threshold: 0.16,
        rootMargin: '0px 0px -8% 0px',
      },
    );

    for (const target of targets) {
      observer.observe(target);
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <main ref={rootRef} className="landing-page">
      <div className="landing-page__backdrop" aria-hidden="true">
        <div className="landing-page__grid" />
        <div className="landing-page__glow landing-page__glow--one" />
        <div className="landing-page__glow landing-page__glow--two" />
      </div>

      <header className="landing-nav landing-reveal is-visible" data-reveal>
        <div className="landing-nav__brand">
          <p className="landing-brand">DNA STUDIO</p>
        </div>

        <nav className="landing-nav__links" aria-label="Primary">
          <a href="#product">Product</a>
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
        </nav>

        <div className="landing-nav__actions">
          <a
            className="landing-button landing-button--ghost"
            href={appRoutes.appHome}
            aria-label="Login is coming soon. Open the app preview."
            title="Login is coming soon. Open the app preview."
          >
            Login
          </a>
          <a className="landing-button landing-button--primary" href={appRoutes.appHome}>
            Start for Free
          </a>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-hero-title">
        <div className="landing-hero__copy landing-reveal is-visible" data-reveal>
          <p className="landing-badge">Built for unstable connections</p>
          <h1 id="landing-hero-title">Record remote interviews that survive bad connections.</h1>
          <p className="landing-hero__lede">
            DNA STUDIO is a premium interview recorder for unstable connection.
          </p>

          <div className="landing-hero__actions">
            <a className="landing-button landing-button--primary" href={appRoutes.appHome}>
              Start for Free
            </a>
            <a className="landing-button landing-button--secondary" href="#workflow">
              See how it works
            </a>
          </div>

          <p className="landing-hero__signals" aria-label="Product highlights">
            <span>Local recording</span>
            <span>Recovery-ready</span>
            <span>1080p export</span>
          </p>
        </div>

        <aside className="landing-hero__panel landing-reveal is-visible" data-reveal aria-label="Studio highlights">
          <div className="landing-hero__panel-card">
            <div className="landing-hero__panel-glow" aria-hidden="true" />
            <p className="landing-kicker">Why it holds up</p>

            <div className="landing-hero__panel-list">
              <article>
                <span>Local recording</span>
                <p>Each device captures first so the source stays protected.</p>
              </article>
              <article>
                <span>Recovery-ready</span>
                <p>Refreshes and interruptions do not erase the session flow.</p>
              </article>
              <article>
                <span>1080p export</span>
                <p>Delivery ends in a clean MP4 built for publishing.</p>
              </article>
            </div>
          </div>
        </aside>
      </section>

      <section
        id="features"
        className="landing-section landing-section--features landing-reveal"
        data-reveal
        aria-labelledby="features-title"
      >
        <div className="landing-section__heading">
          <p className="landing-kicker">Product strengths</p>
          <h2 id="features-title">Built to protect the session when the network is unstable.</h2>
          <p>
            Capture, recovery, transport, and export stay separate so a bad connection does not
            collapse the whole recording.
          </p>
        </div>

        <div className="landing-feature-grid">
          {featureCards.map((item) => (
            <FeatureCardView key={item.title} item={item} />
          ))}
        </div>
      </section>

      <section
        id="product"
        className="landing-section landing-section--product landing-reveal"
        data-reveal
        aria-labelledby="product-title"
      >
        <div className="landing-section__heading">
          <p className="landing-kicker">Studio flow</p>
          <h2 id="product-title">A clean interface path from invite to export.</h2>
          <p>
            The product keeps capture, upload, and delivery visually distinct so the recording
            story stays calm and easy to follow.
          </p>
        </div>

        <div className="landing-product">
          <div className="landing-product__flow" aria-label="Studio flow steps">
            {studioFlowSteps.map((item) => (
              <FlowStepView key={item.number} item={item} />
            ))}
          </div>

          <div className="landing-product__notes" aria-label="Studio notes">
            <article className="landing-note-card">
              <p className="landing-note-card__label">Session state</p>
              <p>Keep the recording path clear from the moment the host starts the room.</p>
            </article>
            <article className="landing-note-card">
              <p className="landing-note-card__label">Guest joining</p>
              <p>Let the invite flow stay lightweight and direct.</p>
            </article>
            <article className="landing-note-card">
              <p className="landing-note-card__label">Delivery</p>
              <p>Finish with a dependable MP4 instead of a fragile one-off capture.</p>
            </article>
          </div>
        </div>
      </section>

      <section
        className="landing-section landing-section--reliability landing-reveal"
        data-reveal
        aria-labelledby="reliability-title"
      >
        <div className="landing-section__heading">
          <p className="landing-kicker">Reliability</p>
          <h2 id="reliability-title">Designed for the moments when the network is not perfect.</h2>
          <p>
            Remote interviews fail when recording depends on a live connection alone. DNA STUDIO
            keeps capture, upload, and export as separate steps so the session can survive the
            rough patches.
          </p>
        </div>

        <div className="landing-reliability-grid">
          <article className="landing-card landing-card--reliability">
            <p className="landing-note-card__label">Capture</p>
            <p>The source material stays on the device first, where the quality is safest.</p>
          </article>
          <article className="landing-card landing-card--reliability">
            <p className="landing-note-card__label">Transport</p>
            <p>Large uploads can recover instead of forcing a full restart after a drop.</p>
          </article>
          <article className="landing-card landing-card--reliability">
            <p className="landing-note-card__label">Export</p>
            <p>The final MP4 can be prepared without tying delivery to a fragile live call.</p>
          </article>
        </div>
      </section>

      <section
        id="workflow"
        className="landing-section landing-section--workflow landing-reveal"
        data-reveal
        aria-labelledby="workflow-title"
      >
        <div className="landing-section__heading">
          <p className="landing-kicker">Workflow</p>
          <h2 id="workflow-title">A simple five-step flow that stays readable at a glance.</h2>
          <p>
            Move through the session in a steady order, from setup to delivery, without any
            unnecessary visual noise.
          </p>
        </div>

        <div className="landing-workflow">
          {workflowSteps.map((item) => (
            <FlowStepView key={item.number} item={item} />
          ))}
        </div>
      </section>

      <section className="landing-cta landing-reveal" data-reveal aria-labelledby="landing-cta-title">
        <div className="landing-cta__copy">
          <p className="landing-kicker">Ready to run the studio</p>
          <h2 id="landing-cta-title">Start your first remote recording today.</h2>
          <p>
            Create a session, invite your guest, and keep recording quality protected even when
            the network is not perfect.
          </p>
        </div>

        <a className="landing-button landing-button--primary landing-button--lg" href={appRoutes.appHome}>
          Start for Free
        </a>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer__brand">
          <p className="landing-footer__name">DNA STUDIO</p>
          <p className="landing-footer__tagline">Premium remote interview recording for unstable connections.</p>
        </div>

        <nav className="landing-footer__links" aria-label="Footer">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <a href={appRoutes.appHome}>Login</a>
        </nav>
      </footer>
    </main>
  );
}
