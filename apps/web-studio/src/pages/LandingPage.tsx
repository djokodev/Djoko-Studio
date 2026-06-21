import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { appRoutes } from '../navigation/routes';

type FeatureCard = {
  label: string;
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
  title: string;
  description: string;
};

const featureCards: FeatureCard[] = [
  {
    label: 'Capture',
    title: 'Local-first capture',
    description:
      'Recording starts on each participant’s device first, so quality never depends on the call staying up.',
  },
  {
    label: 'Recovery',
    title: 'Recovery built in',
    description: 'A refresh, a crash, or a dropped tab should not be able to destroy a session.',
  },
  {
    label: 'Transport',
    title: 'Resumable upload',
    description: 'Large recordings pick up where they left off instead of restarting from zero.',
  },
  {
    label: 'Delivery',
    title: '1080p export',
    description: 'A clean MP4, ready to download and publish, every time.',
  },
];

const workflowSteps: FlowStep[] = [
  {
    number: '01',
    title: 'Open the session',
    description: 'Start the room with a clean recording setup that already feels ready for production.',
  },
  {
    number: '02',
    title: 'Send one simple link',
    description: 'Bring your guest in fast without accounts, installs, or setup friction slowing the conversation.',
  },
  {
    number: '03',
    title: 'Capture with confidence',
    description: 'Each side records with quality in mind, so the session keeps its value beyond the live call.',
  },
  {
    number: '04',
    title: 'Recover through rough moments',
    description: 'Uploads resume safely in the background instead of collapsing after one unstable connection moment.',
  },
  {
    number: '05',
    title: 'Hand off a polished file',
    description: 'Move into review with a final export that already feels ready for editing, delivery, and release.',
  },
];

const reliabilityPoints: ReliabilityPoint[] = [
  {
    label: 'Studio feel',
    title: 'Audio that feels intentional from the first take.',
    description:
      'The session is built to support clear spoken recordings that already feel close to a polished studio setup.',
  },
  {
    label: 'Host focus',
    title: 'The conversation stays in front. The technical stress stays behind.',
    description:
      'DNA STUDIO keeps the recording workflow calm enough that hosts can focus on pacing, tone, and presence.',
  },
  {
    label: 'Ready to publish',
    title: 'A final file that is already moving toward delivery.',
    description:
      'Exports are shaped for real editorial handoff, so interviews can move quickly into review, editing, and release.',
  },
];

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const landingHeroBackgroundStyle: CSSProperties = {
  backgroundImage:
    "linear-gradient(120deg, rgba(2, 6, 23, 0.92) 0%, rgba(2, 6, 23, 0.72) 42%, rgba(2, 6, 23, 0.26) 100%), url('/images/landing/freelaner_interview.jpg')",
  backgroundPosition: 'center center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
};

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

function FeatureCardView({ item, index }: { item: FeatureCard; index: number }) {
  return (
    <article className="landing-card landing-card--feature landing-reveal" data-reveal>
      <div className="landing-card__accent" aria-hidden="true" />
      <div className="landing-card__meta">
        <p className="landing-card__number" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </p>
      </div>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
    </article>
  );
}

function FlowStepView({ item }: { item: FlowStep }) {
  return (
    <article className="landing-flow-step landing-reveal" data-reveal>
      <h3>{item.title}</h3>
      <p>{item.description}</p>
      <span className="landing-flow-step__watermark" aria-hidden="true">
        {item.number}
      </span>
    </article>
  );
}

function ReliabilityCard({ item, index }: { item: ReliabilityPoint; index: number }) {
  return (
    <article className="landing-note-card landing-reveal" data-reveal>
      <div className="landing-note-card__meta">
        <p className="landing-note-card__label">{item.label}</p>
        <p className="landing-note-card__number" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </p>
      </div>
      <h3>{item.title}</h3>
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

      <section className="landing-hero" style={landingHeroBackgroundStyle} aria-labelledby="landing-hero-title">
        <div className="landing-hero__copy landing-reveal is-visible" data-reveal>
          <h1 id="landing-hero-title">Record remote interviews that survive bad connections.</h1>
          <p className="landing-hero__lede">
            Keep the guest experience simple while protecting the recording when the connection
            gets rough.
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

      </section>

      <section
        id="features"
        className="landing-section landing-section--features landing-reveal"
        data-reveal
        aria-labelledby="features-title"
      >
        <div className="landing-feature-intro">
          <div className="landing-section__heading landing-section__heading--feature-intro">
            <p className="landing-kicker">Product strengths</p>
            <h2 id="features-title">Built to protect the session when the network is unstable.</h2>
            <p>
              Capture, recovery, transport, and export stay separate so a bad connection does not
              collapse the whole recording.
            </p>
          </div>

          <figure className="landing-feature-visual landing-reveal" data-reveal>
            <img
              className="landing-feature-visual__photo"
              src="/images/landing/network_unstable.jpg"
              alt="Remote session stress caused by an unstable network"
              loading="lazy"
            />
          </figure>
        </div>

        <div className="landing-feature-grid">
          {featureCards.map((item, index) => (
            <FeatureCardView key={item.title} item={item} index={index} />
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
        </div>

        <div className="landing-product">
          <figure className="landing-product__visual landing-reveal" data-reveal>
            <img
              className="landing-product__photo"
              src="/images/landing/studio-mic-detail.jpg"
              alt="Studio microphone and recording hardware detail"
              loading="lazy"
            />
          </figure>

          <div className="landing-product__notes" aria-label="Reliability breakdown">
            {reliabilityPoints.map((item, index) => (
              <ReliabilityCard key={item.label} item={item} index={index} />
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
        </div>

        <article className="landing-workflow-showcase landing-reveal" data-reveal>
          <div className="landing-workflow-showcase__copy">
            <p className="landing-kicker">Session overview</p>
            <h3>One recording flow, from invite link to polished export.</h3>
            <p>
              Your guest arrives fast, the session records locally, and the final file remains
              usable even after rough connection moments.
            </p>
          </div>
          <img
            className="landing-workflow-showcase__photo"
            src="/images/landing/guest-portrait.jpg"
            alt="Guest joining the interview flow remotely"
            loading="lazy"
          />
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
