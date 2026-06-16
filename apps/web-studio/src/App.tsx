import { useState, type FormEvent } from 'react';
import {
  buildGuestInviteUrl,
  createSession,
  type CreateSessionResponse,
  getApiBaseUrl,
} from './api/client';

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

function SessionSummary({ result }: { result: CreateSessionResponse }) {
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
    </section>
  );
}

export default function App() {
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
      const message = error instanceof Error ? error.message : 'Unable to create session';
      setErrorMessage(message);
      setSessionResult(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page">
      <main className="layout">
        <section className="hero-card" aria-labelledby="page-title">
          <p className="eyebrow">DNA Studio / Djoko Studio</p>
          <h1 id="page-title">Create a host session from the web studio.</h1>
          <p className="lede">
            This first pass lets a host create a session, send the request to the API,
            and immediately see the session ID, title, status, and guest invite details.
          </p>
          <ul className="scope-list" aria-label="Current scope">
            <li>No auth yet</li>
            <li>No WebRTC media yet</li>
            <li>No recording, upload, or export yet</li>
          </ul>
          <p className="api-note">
            API base URL: <span className="mono">{getApiBaseUrl()}</span>
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

        {sessionResult ? <SessionSummary result={sessionResult} /> : null}
      </main>
    </div>
  );
}
