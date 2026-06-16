export type SessionStatus = 'draft' | 'waiting' | 'live' | 'ended' | 'cancelled';

export interface CreateSessionRequest {
  studio_id: string;
  host_user_id: string;
  title: string;
  status?: SessionStatus;
  scheduled_at?: string;
}

export interface Session {
  id: string;
  studio_id: string;
  host_user_id: string;
  title: string;
  status: SessionStatus;
  scheduled_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionResponse {
  session: Session;
  guest_invite_token: string;
}

interface ApiErrorResponse {
  error?: string;
}

const defaultApiBaseUrl = 'http://localhost:8080';

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL?.trim() || defaultApiBaseUrl;
}

export function buildGuestInviteUrl(inviteToken: string): string {
  return `${window.location.origin}/guest/${encodeURIComponent(inviteToken)}`;
}

export async function createSession(
  request: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  const response = await fetch(`${getApiBaseUrl()}/v1/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const payload = (await response.json().catch(() => null)) as
    | CreateSessionResponse
    | ApiErrorResponse
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && payload.error
        ? payload.error
        : `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  if (!payload || typeof payload !== 'object' || !('session' in payload)) {
    throw new Error('Unexpected create session response');
  }

  return payload as CreateSessionResponse;
}
