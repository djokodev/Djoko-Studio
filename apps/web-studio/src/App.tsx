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
import { LocalMediaPreview } from './components/LocalMediaPreview';
import { ProcessingExportPanel } from './components/ProcessingExportPanel';
import { UploadReadinessPanel } from './components/UploadReadinessPanel';
import { DebugOnly } from './components/debug/DebugOnly';
import { debugLog } from './lib/debug';
import {
  appRoutes,
  getGuestInviteTokenFromPathname,
  isAppPathname,
  isGuestInvitePathname,
} from './navigation/routes';
import { LandingPage } from './pages/LandingPage';
import { listRecentPersistedExportSummaries } from './export/recentPersistedExports';
import { formatBytes } from './recording/formatBytes';
import {
  listPersistedLocalRecordings,
  type PersistedLocalRecordingRecord,
} from './recording/recordingPersistence';
import { useLocalMediaRecorder } from './recording/useLocalMediaRecorder';

type FormState = {
  title: string;
  hostUserId: string;
  studioId: string;
};

type HostWorkspace = 'dashboard' | 'record' | 'upload';

const initialFormState: FormState = {
  title: 'Interview with guest',
  hostUserId: '3c9abfe7-3133-4924-b159-f62277dfce7c',
  studioId: '2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d',
};

function formatDateTime(value: string | number | null | undefined): string {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
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

function formatRoleLabel(role: 'host' | 'guest' | null | undefined): string {
  if (role === 'host') {
    return 'Host recording';
  }

  if (role === 'guest') {
    return 'Guest recording';
  }

  return 'Local recording';
}

function formatCompactId(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatDuration(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const totalSeconds = Math.max(1, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getHostWorkspaceFromSearch(search: string): HostWorkspace {
  const workspace = new URLSearchParams(search).get('workspace');

  if (workspace === 'record' || workspace === 'upload') {
    return workspace;
  }

  return 'dashboard';
}

function syncHostWorkspaceUrl(workspace: HostWorkspace): void {
  try {
    const url = new URL(window.location.href);

    if (workspace === 'dashboard') {
      url.searchParams.delete('workspace');
    } else {
      url.searchParams.set('workspace', workspace);
    }

    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Best-effort URL sync for dashboard workspace state.
  }
}

function AppHomeDashboard({
  onOpenRecord,
  onOpenUpload,
}: {
  onOpenRecord: () => void;
  onOpenUpload: () => void;
}) {
  const [persistedRecordings, setPersistedRecordings] = useState<PersistedLocalRecordingRecord[]>([]);

  useEffect(() => {
    let isActive = true;

    void listPersistedLocalRecordings()
      .then((recordings) => {
        if (!isActive) {
          return;
        }

        setPersistedRecordings(recordings);
      })
      .catch(() => {
        if (!isActive) {
          return;
        }

        setPersistedRecordings([]);
      });

    return () => {
      isActive = false;
    };
  }, []);

  const recentRecordings = persistedRecordings.slice(0, 3);
  const recentExports = listRecentPersistedExportSummaries(persistedRecordings);
  const recordWorkspaceHref = `${appRoutes.appHome}?workspace=record#app-record-flow`;
  const uploadWorkspaceHref = `${appRoutes.appHome}?workspace=upload#app-upload-flow`;

  return (
    <div className="app-dashboard-home">
      <header className="app-dashboard-home__header">
        <div>
          <p className="eyebrow">Home</p>
          <h1 className="app-dashboard-home__title">Dashboard</h1>
          <p className="app-dashboard-home__subtitle">
            Start recording, continue an upload, or jump back into recent work.
          </p>
        </div>
      </header>

      <section className="app-dashboard-shortcuts" aria-labelledby="app-dashboard-shortcuts-title">
        <div className="app-dashboard-section-heading">
          <p className="eyebrow">Quick actions</p>
          <h2 id="app-dashboard-shortcuts-title">What would you like to create today?</h2>
          <p className="app-dashboard-home__subtitle">
            Keep the first screen focused on your next action, not the full studio internals.
          </p>
        </div>

        <div className="app-dashboard-shortcuts__grid">
          <button
            className="app-dashboard-shortcut app-dashboard-shortcut--primary"
            type="button"
            onClick={onOpenRecord}
          >
            <span className="app-dashboard-shortcut__icon" aria-hidden="true">
              R
            </span>
            <span className="app-dashboard-shortcut__label">Record</span>
            <span className="app-dashboard-shortcut__copy">
              Start a remote recording session with local capture and recovery.
            </span>
          </button>

          <button
            className="app-dashboard-shortcut"
            type="button"
            onClick={onOpenUpload}
          >
            <span className="app-dashboard-shortcut__icon" aria-hidden="true">
              U
            </span>
            <span className="app-dashboard-shortcut__label">Upload</span>
            <span className="app-dashboard-shortcut__copy">
              Continue uploads and exports from recordings saved in this browser.
            </span>
          </button>

          <div className="app-dashboard-shortcut app-dashboard-shortcut--disabled" aria-disabled="true">
            <span className="app-dashboard-shortcut__icon" aria-hidden="true">
              E
            </span>
            <span className="app-dashboard-shortcut__label">Edit a video</span>
            <span className="app-dashboard-shortcut__badge">Coming soon</span>
            <span className="app-dashboard-shortcut__copy">
              Trim, polish, and prepare your final video.
            </span>
          </div>
        </div>
      </section>

      <section className="app-dashboard-recent" aria-labelledby="app-dashboard-recent-title">
        <div className="app-dashboard-section-heading">
          <p className="eyebrow">Recent work</p>
          <h3 id="app-dashboard-recent-title">Keep moving from your last saved step</h3>
        </div>

        <div className="app-dashboard-recent__grid">
          <article className="app-dashboard-panel">
            <div className="app-dashboard-panel__header">
              <h4>Recent recordings</h4>
              <a className="app-dashboard-panel__link" href={recordWorkspaceHref}>
                Start recording
              </a>
            </div>

            {recentRecordings.length > 0 ? (
              <ul className="app-dashboard-list">
                {recentRecordings.map((record) => (
                  <li className="app-dashboard-list__item" key={record.recordingId}>
                    <div>
                      <div className="app-dashboard-list__title-row">
                        <p className="app-dashboard-list__title">
                          {formatRoleLabel(record.manifest.role)}
                        </p>
                        <span className="app-dashboard-list__badge">Saved</span>
                      </div>
                      <p className="app-dashboard-list__meta">
                        Saved {formatDateTime(record.lastPersistedAt)}
                        {record.manifest.approximateDurationMs !== null
                          ? ` • ${formatDuration(record.manifest.approximateDurationMs)}`
                          : ''}
                        {' • '}
                        {formatBytes(record.manifest.totalBytes)}
                      </p>
                    </div>
                    <span className="app-dashboard-list__value mono">{formatCompactId(record.recordingId)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="app-dashboard-empty-state" role="status">
                <p>No local recordings yet.</p>
                <p>Start a recording to see it here.</p>
              </div>
            )}
          </article>

          <article className="app-dashboard-panel">
            <div className="app-dashboard-panel__header">
              <h4>Recent exports</h4>
              <a className="app-dashboard-panel__link" href={uploadWorkspaceHref}>
                Open export flow
              </a>
            </div>

            {recentExports.length > 0 ? (
              <ul className="app-dashboard-list">
                {recentExports.map((exportSummary) => (
                  <li className="app-dashboard-list__item" key={exportSummary.exportId}>
                    <div>
                      <div className="app-dashboard-list__title-row">
                        <p className="app-dashboard-list__title">
                          {formatRoleLabel(exportSummary.role)} export
                        </p>
                        <span className="app-dashboard-list__badge app-dashboard-list__badge--export">
                          Export
                        </span>
                      </div>
                      <p className="app-dashboard-list__meta">
                        Recording {formatCompactId(exportSummary.recordingId)}
                        {exportSummary.lastSavedAt !== null
                          ? ` • Saved ${formatDateTime(exportSummary.lastSavedAt)}`
                          : ''}
                      </p>
                    </div>
                    <span className="app-dashboard-list__value mono">
                      {formatCompactId(exportSummary.exportId)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="app-dashboard-empty-state" role="status">
                <p>No exports yet.</p>
                <p>Exported videos will appear here.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="app-dashboard-safety" aria-labelledby="app-dashboard-safety-title">
        <p className="eyebrow">Recovery</p>
        <h3 id="app-dashboard-safety-title">Recover saved recordings</h3>
        <p className="app-dashboard-safety__copy">
          DNA STUDIO keeps local recordings in your browser so you can recover work after a drop.
        </p>
      </section>
    </div>
  );
}

function DashboardSidebar({
  activeWorkspace,
  onChangeWorkspace,
}: {
  activeWorkspace: HostWorkspace;
  onChangeWorkspace: (workspace: HostWorkspace) => void;
}) {
  return (
    <aside className="app-sidebar" aria-label="Dashboard navigation">
      <div className="app-sidebar__brand">
        <p className="app-sidebar__eyebrow">DNA STUDIO</p>
        <h1 className="app-sidebar__title">Dashboard</h1>
      </div>

      <nav className="app-sidebar__nav">
        <SidebarNavButton
          label="Home"
          active={activeWorkspace === 'dashboard'}
          onClick={() => onChangeWorkspace('dashboard')}
        />
        <SidebarNavButton
          label="Record"
          active={activeWorkspace === 'record'}
          onClick={() => onChangeWorkspace('record')}
        />
        <SidebarNavButton
          label="Upload"
          active={activeWorkspace === 'upload'}
          onClick={() => onChangeWorkspace('upload')}
        />
        <SidebarNavButton label="Projects" disabled detail="Coming soon" />
        <SidebarNavButton label="Settings" disabled detail="Coming soon" />
      </nav>

      <div className="app-sidebar__footer">
        <a className="app-sidebar__back-link" href={appRoutes.publicLanding}>
          Back to landing
        </a>
      </div>
    </aside>
  );
}

function SidebarNavButton({
  label,
  active = false,
  disabled = false,
  detail,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  detail?: string;
  onClick?: () => void;
}) {
  return (
    <button
      className={`app-sidebar__nav-button${active ? ' app-sidebar__nav-button--active' : ''}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <span>{label}</span>
      {detail ? <span className="app-sidebar__nav-detail">{detail}</span> : null}
    </button>
  );
}

function WorkspaceToolbar({
  title,
  description,
  onBack,
}: {
  title: string;
  description: string;
  onBack: () => void;
}) {
  return (
    <header className="app-workspace-toolbar">
      <button
        className="app-workspace-toolbar__back"
        type="button"
        onClick={onBack}
      >
        Back to dashboard
      </button>
      <div>
        <p className="eyebrow">Workspace</p>
        <h2>{title}</h2>
        <p className="app-workspace-toolbar__description">{description}</p>
      </div>
    </header>
  );
}

function UploadWorkspace({ onBack }: { onBack: () => void }) {
  const recorder = useLocalMediaRecorder();

  return (
    <div className="app-workspace-screen">
      <WorkspaceToolbar
        title="Upload workspace"
        description="Continue uploads and exports for recordings already saved in this browser."
        onBack={onBack}
      />

      <section className="panel app-workspace app-workspace--upload" aria-labelledby="upload-workspace-title">
        <div className="panel__header">
          <div>
            <p className="eyebrow">Upload</p>
            <h3 id="upload-workspace-title">Continue upload and export</h3>
          </div>
        </div>

        <p className="api-note app-workspace__note">
          Use this workspace when you already have local recordings and want to resume upload or export work.
        </p>

        <UploadReadinessPanel recorder={recorder} />
        <ProcessingExportPanel recorder={recorder} />
      </section>
    </div>
  );
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

function HostSessionSummary({
  result,
  localMediaStream,
}: {
  result: CreateSessionResponse;
  localMediaStream: MediaStream | null;
}) {
  const inviteUrl = buildGuestInviteUrl(result.guest_invite_token);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');

  async function handleCopyInviteLink() {
    try {
      setCopyStatus('copying');
      const clipboard = window.navigator.clipboard;
      if (!clipboard) {
        throw new Error('Clipboard access is not available.');
      }

      await clipboard.writeText(inviteUrl);
      setCopyStatus('copied');
      debugLog('host', 'Copied guest invite link', {
        sessionId: result.session.id,
        inviteToken: result.guest_invite_token,
      });
    } catch (error) {
      setCopyStatus('failed');
      debugLog('host', 'Failed to copy guest invite link', error);
    }
  }

  return (
    <section className="panel panel--success" aria-labelledby="session-summary-title">
      <div className="panel__header">
        <div>
          <p className="eyebrow">Session ready</p>
          <h2 id="session-summary-title">Invite your guest</h2>
        </div>
        <span className="status-pill status-pill--live">{result.session.status}</span>
      </div>

      <p className="api-note">
        Your guest can join with the invite link below.
      </p>

      <div className="session-form session-form--spaced">
        <label className="field">
          <span>Guest invite link</span>
          <input type="text" value={inviteUrl} readOnly />
        </label>
        <button className="submit-button signaling-button" type="button" onClick={handleCopyInviteLink}>
          {copyStatus === 'copying'
            ? 'Copying invite link…'
            : copyStatus === 'copied'
              ? 'Invite link copied'
              : 'Copy invite link'}
        </button>
        <p className="api-note">
          {copyStatus === 'failed'
            ? 'Copying the link failed. You can retry.'
            : 'Share the invite link with the guest when you are ready.'}
        </p>
      </div>

      <DebugOnly>
        <SessionDetails
          session={result.session}
          heading="Session details"
          headingId="host-session-summary"
        />
        <dl className="details-grid">
          <div className="detail-card">
            <dt>Guest invite token</dt>
            <dd className="mono">{result.guest_invite_token}</dd>
          </div>
        </dl>
      </DebugOnly>

      <SignalingPanel
        heading="Host signaling room"
        sessionId={result.session.id}
        participantId={result.session.host_user_id}
        role="host"
        localMediaStream={localMediaStream}
      />
    </section>
  );
}

function HostSessionPage() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [sessionResult, setSessionResult] = useState<CreateSessionResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localMediaStream, setLocalMediaStream] = useState<MediaStream | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<HostWorkspace>(() =>
    getHostWorkspaceFromSearch(window.location.search),
  );

  useEffect(() => {
    const handlePopState = () => {
      setActiveWorkspace(getHostWorkspaceFromSearch(window.location.search));
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

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
      debugLog('host', 'Created session', {
        sessionId: result.session.id,
        title: result.session.title,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to create session'));
      setSessionResult(null);
      debugLog('host', 'Failed to create session', error);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleWorkspaceChange(nextWorkspace: HostWorkspace) {
    setActiveWorkspace(nextWorkspace);
    syncHostWorkspaceUrl(nextWorkspace);
  }

  return (
    <main className="app-shell">
      <DashboardSidebar
        activeWorkspace={activeWorkspace}
        onChangeWorkspace={handleWorkspaceChange}
      />

      <div className="app-shell__main">
        {activeWorkspace === 'dashboard' ? (
          <AppHomeDashboard
            onOpenRecord={() => handleWorkspaceChange('record')}
            onOpenUpload={() => handleWorkspaceChange('upload')}
          />
        ) : null}

        {activeWorkspace === 'record' ? (
          <div className="app-workspace-screen">
            <WorkspaceToolbar
              title="Recording workspace"
              description="Create your host session, invite your guest, then continue into preview, recording, upload, and export."
              onBack={() => handleWorkspaceChange('dashboard')}
            />

            <section className="panel app-workspace" aria-labelledby="form-title" id="app-record-flow">
              <div className="panel__header">
                <div>
                  <p className="eyebrow">Record</p>
                  <h3 id="form-title">Start a recording session</h3>
                </div>
                {isSubmitting ? <span className="status-pill">Creating</span> : null}
              </div>

              <p className="api-note app-workspace__note">
                Set up the session first, then use the studio tools below when you are ready to record.
              </p>

              <DebugOnly>
                <p className="api-note">
                  API base URL: <span className="mono">{getApiBaseUrl()}</span>
                </p>
                <p className="api-note">
                  Signaling base URL: <span className="mono">{getSignalingBaseUrl()}</span>
                </p>
              </DebugOnly>

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

                <DebugOnly>
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
                </DebugOnly>

                <button className="submit-button" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating session…' : 'Create session'}
                </button>
              </form>

              {errorMessage ? (
                <div className="message message--error" role="alert">
                  {errorMessage}
                </div>
              ) : null}

              <LocalMediaPreview
                onStreamChange={setLocalMediaStream}
                sessionId={sessionResult?.session.id}
                participantId={sessionResult?.session.host_user_id}
                role="host"
              />
            </section>

            {sessionResult ? (
              <HostSessionSummary result={sessionResult} localMediaStream={localMediaStream} />
            ) : null}
          </div>
        ) : null}

        {activeWorkspace === 'upload' ? (
          <UploadWorkspace onBack={() => handleWorkspaceChange('dashboard')} />
        ) : null}
      </div>
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
  const [localMediaStream, setLocalMediaStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    let isActive = true;

    if (!inviteToken) {
      setIsLookingUp(false);
      setSession(null);
      setLookupError('This invite link is incomplete.');
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
        debugLog('guest', 'Loaded guest session', {
          sessionId: result.id,
        });
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        setSession(null);
        setIsLookingUp(false);
        setLookupError(getErrorMessage(error, 'Unable to look up guest session'));
        debugLog('guest', 'Failed to load guest session', error);
      });

    return () => {
      isActive = false;
    };
  }, [inviteToken]);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDisplayNameError('');

    if (!inviteToken) {
      setLookupError('This invite link is incomplete.');
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
      debugLog('guest', 'Joined guest session', {
        sessionId: result.session.id,
        participantId: result.participant.id,
      });
    } catch (error) {
      setJoinError(getErrorMessage(error, 'Unable to join guest session'));
      debugLog('guest', 'Failed to join guest session', error);
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <main className="layout">
      <section className="hero-card" aria-labelledby="page-title">
        <p className="eyebrow">DNA STUDIO</p>
        <h1 id="page-title">Join the session and check your device.</h1>
        <p className="lede">
          Open the invite link, add your display name, and join. Camera, microphone,
          recording, upload, and export stay focused on the session flow.
        </p>
        <ul className="scope-list" aria-label="Current scope">
          <li>Guest invite</li>
          <li>Device preview</li>
          <li>Join session</li>
          <li>Local recording</li>
          <li>Export when ready</li>
        </ul>
        <p className="api-note">Use the invite link from your host to continue.</p>
        <DebugOnly>
          <p className="api-note">
            Guest URLs look like{' '}
            <span className="mono">
              {window.location.origin}
              {appRoutes.guestInvitePattern.replace(':inviteToken', '{invite_token}')}
            </span>
          </p>
          <p className="api-note">
            Signaling base URL: <span className="mono">{getSignalingBaseUrl()}</span>
          </p>
        </DebugOnly>
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

        <LocalMediaPreview
          onStreamChange={setLocalMediaStream}
          sessionId={joinedResult?.session.id ?? session?.id}
          participantId={joinedResult?.participant.id}
          role="guest"
        />

        {session ? (
          <>
            <div className="message" role="status">
              Session ready: {session.title}
            </div>

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
              You are ready to join the studio.
            </p>

            <DebugOnly>
              <SessionDetails
                session={session}
                heading="Session details"
                headingId="guest-session-summary"
              />
            </DebugOnly>
          </>
        ) : null}
      </section>

      {joinedResult ? (
        <section className="panel panel--success" aria-labelledby="guest-join-success">
          <div className="panel__header">
            <div>
              <p className="eyebrow">Guest joined</p>
              <h2 id="guest-join-success">You are in the session</h2>
            </div>
            <span className="status-pill status-pill--live">{joinedResult.participant.status}</span>
          </div>

          <p className="api-note">Camera and microphone stay local while the studio connects.</p>

          <DebugOnly>
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
          </DebugOnly>
          <SignalingPanel
            heading="Guest signaling room"
            sessionId={joinedResult.session.id}
            participantId={joinedResult.participant.id}
            role="guest"
            localMediaStream={localMediaStream}
          />
        </section>
      ) : null}
    </main>
  );
}

export default function App() {
  const pathname = window.location.pathname;
  const isGuestRoute = isGuestInvitePathname(pathname);
  const isAppRoute = isAppPathname(pathname);

  if (!isGuestRoute && !isAppRoute) {
    return <LandingPage />;
  }

  return <div className="page">{isGuestRoute ? <GuestSessionPage /> : <HostSessionPage />}</div>;
}
