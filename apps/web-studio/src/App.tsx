import { useEffect, useState, type FormEvent } from 'react';
import {
  buildGuestInviteUrl,
  createSession,
  getApiBaseUrl,
  getGuestSession,
  joinGuestSession,
  type CreateSessionResponse,
  type JoinGuestSessionResponse,
  type Session,
} from './api/client';
import { getSignalingBaseUrl } from './signaling/client';
import { SignalingPanel } from './components/SignalingPanel';

type FormState = {
  title: string;
  hostUserId: string;
  studioId: string;
};

const initialFormState: FormState = {
  title: 'Interview with guest',
  hostUserId: '3c9abfe7-3133-4924-b159-f62277dfce7c',
  studioId: '2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d',
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallback;
}

function getGuestInviteTokenFromPathname(pathname: string): string | null {
  const guestPrefix = '/guest';
  if (pathname !== guestPrefix && !pathname.startsWith(`${guestPrefix}/`)) {
    return null;
  }

  const remainder = pathname.slice(guestPrefix.length).replace(/^\/+/, '');
  if (remainder.trim() === '') {
    return null;
  }

  const encodedToken = remainder.split('/')[0];
  if (encodedToken.trim() === '') {
    return null;
  }

  try {
    const inviteToken = decodeURIComponent(encodedToken).trim();
    return inviteToken === '' ? null : inviteToken;
  } catch {
    return null;
  }
}

function SessionDetails({
  session,
  heading,
  headingId,
}: {
  session: Session;
  heading: string;
  headingId: string;
}) {
  return (
    <section className="summary-block" aria-labelledby={headingId}>
      <div className="panel__header">
        <div>
          <p className="eyebrow">Session summary</p>
          <h3 id={headingId}>{heading}</h3>
        </div>
        <span className="status-pill status-pill--live">{session.status}</span>
      </div>

      <dl className="details-grid">
        <div className="detail-card">
          <dt>Session ID</dt>
          <dd>{session.id}</dd>
        </div>
        <div className="detail-card">
          <dt>Title</dt>
          <dd>{session.title}</dd>
        </div>
        <div className="detail-card">
          <dt>Studio ID</dt>
          <dd>{session.studio_id}</dd>
        </div>
        <div className="detail-card">
          <dt>Host user ID</dt>
          <dd>{session.host_user_id}</dd>
        </div>
        <div className="detail-card">
          <dt>Status</dt>
          <dd>{session.status}</dd>
        </div>
        <div className="detail-card">
          <dt>Created at</dt>
          <dd>{formatDateTime(session.created_at)}</dd>
        </div>
        <div className="detail-card">
          <dt>Updated at</dt>
          <dd>{formatDateTime(session.updated_at)}</dd>
        </div>
        <div className="detail-card">
          <dt>Started at</dt>
          <dd>{formatDateTime(session.started_at)}</dd>
        </div>
      </dl>
    </section>
  );
}

function ParticipantDetails({
  participant,
  heading,
  headingId,
}: {
  participant: JoinGuestSessionResponse['participant'];
  heading: string;
  headingId: string;
}) {
  return (
    <section className="summary-block" aria-labelledby={headingId}>
      <div className="panel__header">
        <div>
          <p className="eyebrow">Joined participant</p>
          <h3 id={headingId}>{heading}</h3>
        </div>
        <span className="status-pill status-pill--live">{participant.status}</span>
      </div>

      <dl className="details-grid">
        <div className="detail-card">
          <dt>Participant ID</dt>
          <dd>{participant.id}</dd>
        </div>
        <div className="detail-card">
          <dt>Display name</dt>
          <dd>{participant.display_name}</dd>
        </div>
        <div className="detail-card">
          <dt>Role</dt>
          <dd>{participant.role}</dd>
        </div>
        <div className="detail-card">
          <dt>Status</dt>
          <dd>{participant.status}</dd>
        </div>
        <div className="detail-card">
          <dt>Joined at</dt>
          <dd>{formatDateTime(participant.joined_at)}</dd>
        </div>
        <div className="detail-card">
          <dt>Updated at</dt>
          <dd>{formatDateTime(participant.updated_at)}</dd>
        </div>
      </dl>
    </section>
  );
}

function HostSessionSummary({ result }: { result: CreateSessionResponse }) {
  const inviteUrl = buildGuestInviteUrl(result.guest_invite_token);

  return (
    <section className="panel panel--success" aria-labelledby="session-summary-title">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Success</p>
          <h2 id="session-summary-title">Session created</h2>
        </div>
        <span className="status-pill status-pill--live">{result.session.status}</span>
      </div>

      <dl className="details-grid">
        <div className="detail-card">
          <dt>Session ID</dt>
          <dd>{result.session.id}</dd>
        </div>
        <div className="detail-card">
          <dt>Title</dt>
          <dd>{result.session.title}</dd>
        </div>
        <div className="detail-card">
          <dt>Guest invite token</dt>
          <dd className="mono">{result.guest_invite_token}</dd>
        </div>
        <div className="detail-card">
          <dt>Guest invite URL</dt>
          <dd className="mono">{inviteUrl}</dd>
        </div>
        <div className="detail-card">
          <dt>Studio ID</dt>
          <dd>{result.session.studio_id}</dd>
        </div>
        <div className="detail-card">
          <dt>Host user ID</dt>
          <dd>{result.session.host_user_id}</dd>
        </div>
        <div className="detail-card">
          <dt>Status</dt>
          <dd>{result.session.status}</dd>
        </div>
        <div className="detail-card">
          <dt>Created at</dt>
          <dd>{formatDateTime(result.session.created_at)}</dd>
        </div>
        <div className="detail-card">
          <dt>Updated at</dt>
          <dd>{formatDateTime(result.session.updated_at)}</dd>
        </div>
      </dl>

      <SignalingPanel
        heading="Host signaling room"
        sessionId={result.session.id}
        participantId={result.session.host_user_id}
        role="host"
      />
    </section>
  );
}

function HostSessionPage() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [sessionResult, setSessionResult] = useState<CreateSessionResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const result = await createSession({
        studio_id: form.studioId.trim(),
        host_user_id: form.hostUserId.trim(),
        title: form.title.trim(),
      });

      setSessionResult(result);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to create session'));
      setSessionResult(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="layout">
      <section className="hero-card" aria-labelledby="page-title">
        <p className="eyebrow">DNA Studio / Djoko Studio</p>
        <h1 id="page-title">Create a host session from the web studio.</h1>
        <p className="lede">
          This first pass lets a host create a session, send the request to the API,
          and immediately see the session ID, title, status, guest invite details, and
          the signaling room foundation.
        </p>
        <ul className="scope-list" aria-label="Current scope">
          <li>No auth yet</li>
          <li>No WebRTC media yet</li>
          <li>No recording, upload, or export yet</li>
          <li>Signaling only for now</li>
        </ul>
        <p className="api-note">
          API base URL: <span className="mono">{getApiBaseUrl()}</span>
        </p>
        <p className="api-note">
          Signaling base URL: <span className="mono">{getSignalingBaseUrl()}</span>
        </p>
      </section>

      <section className="panel" aria-labelledby="form-title">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Host flow</p>
            <h2 id="form-title">Create session</h2>
          </div>
          {isSubmitting ? <span className="status-pill">Creating</span> : null}
        </div>

        <form className="session-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Session title</span>
            <input
              type="text"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Interview with guest"
              required
            />
          </label>

          <label className="field">
            <span>Host user ID</span>
            <input
              type="text"
              value={form.hostUserId}
              onChange={(event) =>
                setForm((current) => ({ ...current, hostUserId: event.target.value }))
              }
              placeholder="3c9abfe7-3133-4924-b159-f62277dfce7c"
              required
            />
          </label>

          <label className="field">
            <span>Studio ID</span>
            <input
              type="text"
              value={form.studioId}
              onChange={(event) =>
                setForm((current) => ({ ...current, studioId: event.target.value }))
              }
              placeholder="2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d"
              required
            />
          </label>

          <button className="submit-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating session…' : 'Create session'}
          </button>
        </form>

        {errorMessage ? (
          <div className="message message--error" role="alert">
            {errorMessage}
          </div>
        ) : null}
      </section>

      {sessionResult ? <HostSessionSummary result={sessionResult} /> : null}
    </main>
  );
}

function GuestSessionPage() {
  const inviteToken = getGuestInviteTokenFromPathname(window.location.pathname);
  const [session, setSession] = useState<Session | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinedResult, setJoinedResult] = useState<JoinGuestSessionResponse | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [displayNameError, setDisplayNameError] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(Boolean(inviteToken));
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    let isActive = true;

    if (!inviteToken) {
      setIsLookingUp(false);
      setSession(null);
      setLookupError('Missing invite token in URL. Use /guest/{invite_token}.');
      setJoinError('');
      setJoinedResult(null);
      return () => {
        isActive = false;
      };
    }

    setIsLookingUp(true);
    setLookupError('');
    setJoinError('');
    setJoinedResult(null);
    setSession(null);

    getGuestSession(inviteToken)
      .then((result) => {
        if (!isActive) {
          return;
        }

        setSession(result);
        setIsLookingUp(false);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setSession(null);
        setIsLookingUp(false);
        setLookupError(getErrorMessage(error, 'Unable to look up guest session'));
      });

    return () => {
      isActive = false;
    };
  }, [inviteToken]);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDisplayNameError('');

    if (!inviteToken) {
      setLookupError('Missing invite token in URL. Use /guest/{invite_token}.');
      return;
    }

    const trimmedDisplayName = displayName.trim();
    if (trimmedDisplayName === '') {
      setDisplayNameError('Display name is required.');
      return;
    }

    setIsJoining(true);
    setJoinError('');

    try {
      const result = await joinGuestSession(inviteToken, {
        display_name: trimmedDisplayName,
      });

      setJoinedResult(result);
      setSession(result.session);
    } catch (error) {
      setJoinError(getErrorMessage(error, 'Unable to join guest session'));
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <main className="layout">
      <section className="hero-card" aria-labelledby="page-title">
        <p className="eyebrow">DNA Studio / Djoko Studio</p>
        <h1 id="page-title">Join a guest session in the web studio.</h1>
        <p className="lede">
          Open the invite link, look up the session, enter a display name, and join
          without auth, WebRTC, recording, or browser media access yet. The signaling
          room is available after you join.
        </p>
        <ul className="scope-list" aria-label="Current scope">
          <li>No auth yet</li>
          <li>No full authorization yet</li>
          <li>No WebRTC or recording yet</li>
          <li>Signaling only for now</li>
        </ul>
        <p className="api-note">
          Guest URLs look like{' '}
          <span className="mono">
            {window.location.origin}/guest/{"{invite_token}"}
          </span>
        </p>
        <p className="api-note">
          Signaling base URL: <span className="mono">{getSignalingBaseUrl()}</span>
        </p>
      </section>

      <section className="panel" aria-labelledby="guest-form-title">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Guest flow</p>
            <h2 id="guest-form-title">Join session</h2>
          </div>
          {isLookingUp ? <span className="status-pill">Looking up</span> : null}
        </div>

        {isLookingUp ? (
          <div className="message" aria-live="polite">
            Looking up invite token…
          </div>
        ) : null}

        {lookupError ? (
          <div className="message message--error" role="alert">
            {lookupError}
          </div>
        ) : null}

        {session ? (
          <>
            <SessionDetails
              session={session}
              heading="Session details"
              headingId="guest-session-summary"
            />

            <form className="session-form session-form--spaced" onSubmit={handleJoin}>
              <label className="field">
                <span>Display name</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.target.value);
                    if (displayNameError) {
                      setDisplayNameError('');
                    }
                    if (joinError) {
                      setJoinError('');
                    }
                  }}
                  placeholder="Guest Name"
                  required
                />
              </label>

              <button className="submit-button" type="submit" disabled={isJoining}>
                {isJoining ? 'Joining session…' : 'Join session'}
              </button>
            </form>

            {displayNameError ? (
              <div className="message message--error" role="alert">
                {displayNameError}
              </div>
            ) : null}

            {joinError ? (
              <div className="message message--error" role="alert">
                {joinError}
              </div>
            ) : null}

            <p className="api-note">
              Recording and WebRTC are not active yet. This screen only looks up the
              invite token and joins the guest participant.
            </p>
          </>
        ) : null}
      </section>

      {joinedResult ? (
        <section className="panel panel--success" aria-labelledby="guest-join-success">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Success</p>
              <h2 id="guest-join-success">Joined session</h2>
            </div>
            <span className="status-pill status-pill--live">{joinedResult.participant.status}</span>
          </div>

          <SessionDetails
            session={joinedResult.session}
            heading="Session details"
            headingId="joined-session-summary"
          />
          <ParticipantDetails
            participant={joinedResult.participant}
            heading="Participant details"
            headingId="joined-participant-summary"
          />
          <SignalingPanel
            heading="Guest signaling room"
            sessionId={joinedResult.session.id}
            participantId={joinedResult.participant.id}
            role="guest"
          />
        </section>
      ) : null}
    </main>
  );
}

export default function App() {
  const pathname = window.location.pathname;
  const isGuestRoute = pathname === '/guest' || pathname.startsWith('/guest/');

  return (
    <div className="page">{isGuestRoute ? <GuestSessionPage /> : <HostSessionPage />}</div>
  );
}
