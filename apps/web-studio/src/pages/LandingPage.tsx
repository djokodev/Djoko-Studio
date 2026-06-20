import { useEffect, useRef, useState } from 'react';
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

type ReliabilityPoint = {
  label: string;
  description: string;
};

const featureCards: FeatureCard[] = [
  {
    title: 'Local-first capture',
    description:
      'Recording starts on each participant’s device first, so quality never depends on the call staying up.',
  },
  {
    title: 'Recovery built in',
    description: 'A refresh, a crash, or a dropped tab should not be able to destroy a session.',
  },
  {
    title: 'Resumable upload',
    description: 'Large recordings pick up where they left off instead of restarting from zero.',
  },
  {
    title: '1080p export',
    description: 'A clean MP4, ready to download and publish, every time.',
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
    description: 'Share a link. No account, no install, no friction.',
  },
  {
    number: '03',
    title: 'Record locally',
    description: 'Each device captures on its own first, ahead of the network.',
  },
  {
    number: '04',
    title: 'Upload safely',
    description: 'The recording moves in chunks that resume after a drop.',
  },
  {
    number: '05',
    title: 'Export in 1080p',
    description: 'Package a polished MP4, ready to share.',
  },
];

const reliabilityPoints: ReliabilityPoint[] = [
  {
    label: 'Capture',
    description: 'Source material stays on-device first, where the quality is safest.',
  },
  {
    label: 'Transport',
    description: 'Large uploads resume instead of forcing a full restart after a drop.',
  },
  {
    label: 'Export',
    description: 'The final MP4 is assembled without tying delivery to a fragile live call.',
  },
];

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Nudges an element a few pixels toward the cursor while hovered
 * ("magnetic" hover). Used only on the two primary CTAs so it reads as
 * a deliberate touch rather than a gimmick applied everywhere.
 */
function useMagneticHover<T extends HTMLElement>(strength = 12) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) {
      return;
    }

    function handleMove(event: MouseEvent) {
      const rect = el!.getBoundingClientRect();
      const relX = (event.clientX - rect.left) / rect.width - 0.5;
      const relY = (event.clientY - rect.top) / rect.height - 0.5;
      el!.style.setProperty('--magnet-x', `${relX * strength}px`);
      el!.style.setProperty('--magnet-y', `${relY * strength}px`);
    }

    function handleLeave() {
      el!.style.setProperty('--magnet-x', '0px');
      el!.style.setProperty('--magnet-y', '0px');
    }

    el.addEventListener('mousemove', handleMove);
    el.addEventListener('mouseleave', handleLeave);
    return () => {
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);
    };
  }, [strength]);

  return ref;
}

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

function ReliabilityCard({ item }: { item: ReliabilityPoint }) {
  return (
    <article className="landing-note-card landing-reveal" data-reveal>
      <p className="landing-note-card__label">{item.label}</p>
      <p>{item.description}</p>
    </article>
  );
}

export function LandingPage() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [isNavScrolled, setIsNavScrolled] = useState(false);
  const [navTransition, setNavTransition] = useState<'idle' | 'revealing' | 'hiding'>('idle');
  const heroCtaRef = useMagneticHover<HTMLAnchorElement>();
  const finalCtaRef = useMagneticHover<HTMLAnchorElement>();

  useEffect(() => {
    document.title = 'DNA STUDIO | Public landing page';
  }, []);

  // Cursor-spotlight on dark cards: one delegated listener handles every
  // card on the page instead of attaching a handler per instance.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '.landing-card, .landing-note-card, .landing-flow-step',
      );
      if (!target) {
        return;
      }
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
      target.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
    }

    root.addEventListener('pointermove', handlePointerMove);
    return () => {
      root.removeEventListener('pointermove', handlePointerMove);
    };
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

  useEffect(() => {
    let rafId = 0;
    let revealTimeoutId = 0;
    let transitionResetTimeoutId = 0;

    const clearRevealTimeout = () => {
      if (revealTimeoutId !== 0) {
        window.clearTimeout(revealTimeoutId);
        revealTimeoutId = 0;
      }
    };

    const clearTransitionResetTimeout = () => {
      if (transitionResetTimeoutId !== 0) {
        window.clearTimeout(transitionResetTimeoutId);
        transitionResetTimeoutId = 0;
      }
    };

    const scheduleTransitionReset = (delayMs: number) => {
      clearTransitionResetTimeout();
      transitionResetTimeoutId = window.setTimeout(() => {
        setNavTransition((current) => (current === 'idle' ? current : 'idle'));
        transitionResetTimeoutId = 0;
      }, delayMs);
    };

    const updateNavState = () => {
      const shouldShowScrolledNav = window.scrollY > 16;

      if (shouldShowScrolledNav) {
        if (isNavScrolled || revealTimeoutId !== 0) {
          return;
        }

        setNavTransition('revealing');
        revealTimeoutId = window.setTimeout(() => {
          setIsNavScrolled(true);
          revealTimeoutId = 0;
          scheduleTransitionReset(440);
        }, 167);
        return;
      }

      clearRevealTimeout();

      if (!isNavScrolled) {
        setNavTransition('idle');
        return;
      }

      setNavTransition('hiding');
      setIsNavScrolled(false);
      scheduleTransitionReset(220);
    };

    const handleScroll = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(updateNavState);
    };

    updateNavState();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      clearRevealTimeout();
      clearTransitionResetTimeout();
      window.cancelAnimationFrame(rafId);
    };
  }, [isNavScrolled]);

  return (
    <main ref={rootRef} className="landing-page">
      <div className="landing-page__backdrop" aria-hidden="true">
        <div className="landing-page__grid" />
        <div className="landing-page__glow landing-page__glow--one" />
        <div className="landing-page__glow landing-page__glow--two" />
      </div>

      <header
        className={`landing-nav landing-reveal is-visible ${isNavScrolled ? 'landing-nav--scrolled' : 'landing-nav--top'
          } landing-nav--${navTransition}`}
        data-reveal
      >
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
            <a
              ref={heroCtaRef}
              className="landing-button landing-button--primary landing-button--magnetic"
              href={appRoutes.appHome}
            >
              Start for Free
            </a>
            <a className="landing-button landing-button--secondary" href="#workflow">
              See how it works
            </a>
          </div>

          <ul className="landing-hero__checklist" aria-label="Built for these formats">
            <li>Interviews</li>
            <li>Podcasts</li>
            <li>Webinars</li>
            <li>Coaching calls</li>
          </ul>
        </div>

        <aside className="landing-hero__panel landing-reveal is-visible" data-reveal aria-label="Live session preview">
          <div className="landing-hero__panel-card">
            <div className="landing-hero__panel-glow" aria-hidden="true" />
            <div className="landing-hero__call-bar">
              <span className="landing-hero__live">
                <span className="landing-hero__live-dot" aria-hidden="true" />
                REC
              </span>
              <span className="landing-hero__call-badges">
                <span className="landing-status-chip landing-status-chip--ok">Local recording</span>
                <span className="landing-status-chip">1080p</span>
              </span>
            </div>

            <div className="landing-hero__visual-story">
              <figure className="landing-hero__visual-stage landing-hero__call-stage">
                <img
                  className="landing-hero__call-photo"
                  src="/images/landing/hero-host.jpg"
                  alt="Host recording a remote interview in a dark home studio"
                  loading="eager"
                />
                <span className="landing-hero__call-tag landing-hero__call-tag--host">Host</span>

                <article className="landing-hero__guest-card landing-hero__call-pip">
                  <img
                    className="landing-hero__guest-photo"
                    src="/images/landing/guest-portrait.jpg"
                    alt="Guest joining the interview remotely"
                    loading="lazy"
                  />
                  <span className="landing-hero__call-tag landing-hero__call-tag--inline">Guest</span>
                </article>
              </figure>
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
          <p className="landing-kicker">Reliability</p>
          <h2 id="product-title">Designed for the moments when the network is not perfect.</h2>
          <p>
            Remote interviews fail when recording depends on a live connection alone. DNA STUDIO
            keeps capture, upload, and export as separate steps so the session survives the rough
            patches.
          </p>
        </div>

        <div className="landing-product">
          <figure className="landing-product__visual landing-reveal" data-reveal>
            <img
              className="landing-product__photo"
              src="/images/landing/studio-mic-detail.jpg"
              alt="Studio microphone and recording hardware detail"
              loading="lazy"
            />
            <figcaption className="landing-product__caption">
              <p className="landing-kicker">Same session, two paths</p>
              <h3>Capture first. Recover second. Export when the session is safe.</h3>
              <p>
                DNA STUDIO treats the live call as just one layer, not the single point of
                failure.
              </p>
            </figcaption>
          </figure>

          <div className="landing-product__notes" aria-label="Reliability breakdown">
            {reliabilityPoints.map((item) => (
              <ReliabilityCard key={item.label} item={item} />
            ))}
          </div>
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
          <h2 id="workflow-title">A calm workflow for sessions that still need to look premium.</h2>
          <p>
            The page should feel like a studio product, not a dashboard. Setup, recording, and
            delivery stay legible from the first glance.
          </p>
        </div>

        <article className="landing-workflow-showcase landing-reveal" data-reveal>
          <img
            className="landing-workflow-showcase__photo"
            src="/images/landing/guest-portrait.jpg"
            alt="Guest joining the interview flow remotely"
            loading="lazy"
          />
          <div className="landing-workflow-showcase__copy">
            <p className="landing-kicker">Session overview</p>
            <h3>One recording flow, from invite link to polished export.</h3>
            <p>
              Your guest arrives fast, the session records locally, and the final file remains
              usable even after rough connection moments.
            </p>
          </div>
        </article>

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

        <a
          ref={finalCtaRef}
          className="landing-button landing-button--primary landing-button--lg landing-button--magnetic"
          href={appRoutes.appHome}
        >
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
