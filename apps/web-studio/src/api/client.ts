export type SessionStatus = 'draft' | 'waiting' | 'live' | 'ended' | 'cancelled';
export type ParticipantRole = 'host' | 'guest';
export type ParticipantStatus = 'joined' | 'left';

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

export interface Participant {
  id: string;
  session_id: string;
  role: ParticipantRole;
  display_name: string;
  status: ParticipantStatus;
  joined_at?: string | null;
  left_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionResponse {
  session: Session;
  guest_invite_token: string;
}

export interface JoinGuestSessionRequest {
  display_name: string;
}

export interface JoinGuestSessionResponse {
  session: Session;
  participant: Participant;
}

const defaultApiBaseUrl = 'http://localhost:8080';

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL?.trim() || defaultApiBaseUrl;
}

export function buildGuestInviteUrl(inviteToken: string): string {
  return `${window.location.origin}${buildGuestInvitePath(inviteToken)}`;
}

export async function createSession(
  request: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  return requestJson<CreateSessionResponse>('/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
}

export async function getGuestSession(inviteToken: string): Promise<Session> {
  return requestJson<Session>(`/v1/guest/sessions/${encodeURIComponent(inviteToken)}`, {
    method: 'GET',
  });
}

export async function joinGuestSession(
  inviteToken: string,
  request: JoinGuestSessionRequest,
): Promise<JoinGuestSessionResponse> {
  return requestJson<JoinGuestSessionResponse>(
    `/v1/guest/sessions/${encodeURIComponent(inviteToken)}/join`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
  );
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, init);
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, response));
  }

  if (!isRecord(payload)) {
    throw new Error('Unexpected response format');
  }

  return payload as T;
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractErrorMessage(payload: unknown, response: Response): string {
  if (isRecord(payload)) {
    const message = payload.error;

    if (typeof message === 'string' && message.trim() !== '') {
      return message;
    }
  }

  if (response.statusText.trim() !== '') {
    return `Request failed with status ${response.status} ${response.statusText}`;
  }

  return `Request failed with status ${response.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
import { buildGuestInvitePath } from '../navigation/routes';
