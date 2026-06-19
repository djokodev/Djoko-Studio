export const appRoutes = {
  publicLanding: '/',
  appHome: '/app',
  recordSetup: '/record/setup',
  sessionStudioPattern: '/session/:id/studio',
  guestInvitePattern: '/guest/:inviteToken',
  guestInviteRoot: '/guest',
} as const;

export function buildGuestInvitePath(inviteToken: string): string {
  return `${appRoutes.guestInviteRoot}/${encodeURIComponent(inviteToken)}`;
}

export function isGuestInvitePathname(pathname: string): boolean {
  return pathname === appRoutes.guestInviteRoot || pathname.startsWith(`${appRoutes.guestInviteRoot}/`);
}

export function getGuestInviteTokenFromPathname(pathname: string): string | null {
  if (!isGuestInvitePathname(pathname)) {
    return null;
  }

  const remainder = pathname.slice(appRoutes.guestInviteRoot.length).replace(/^\/+/, '');
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
