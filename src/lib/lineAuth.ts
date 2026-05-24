/**
 * LINE Login helpers — env-driven config, safe to call when the LINE env
 * is missing (returns null so callers can gracefully degrade).
 */

export type LineLoginConfig = {
  channelId: string;
  channelSecret: string;
  redirectUri: string;
  oaBasicId: string; // e.g. "@123abcde" — shown to first-time users so they can add the OA
};

/**
 * Build the LINE config bound to a specific incoming request. We derive the
 * callback's base URL from the request itself (request.nextUrl.origin) so
 * the redirect_uri always matches whichever domain the user came in on —
 * no fragile env-var coordination required between the app and the LINE
 * channel's registered callback URLs.
 *
 * Falls back to NEXT_PUBLIC_BASE_URL → VERCEL_URL for callers that don't
 * have a request handy (e.g. server-side utilities). Returns null if the
 * channel credentials are missing.
 */
export function getLineLoginConfig(
  request?: { nextUrl: { origin: string } } | { url: string },
): LineLoginConfig | null {
  // Accept either the "_CHANNEL_" naming (what LINE docs use) or the
  // "_CLIENT_" naming (what some teams prefer to mirror OAuth jargon).
  const channelId =
    process.env.LINE_LOGIN_CHANNEL_ID ||
    process.env.LINE_CLIENT_ID ||
    '';
  const channelSecret =
    process.env.LINE_LOGIN_CHANNEL_SECRET ||
    process.env.LINE_CLIENT_SECRET ||
    '';
  const oaBasicId = process.env.LINE_OA_BASIC_ID || '';

  if (!channelId || !channelSecret) return null;

  // Prefer the live request's origin — that's the URL the user is actually
  // browsing from, which is what LINE will see on the callback.
  let baseUrl = '';
  if (request) {
    if ('nextUrl' in request) {
      baseUrl = request.nextUrl.origin;
    } else if ('url' in request) {
      try {
        baseUrl = new URL(request.url).origin;
      } catch {
        baseUrl = '';
      }
    }
  }

  // Fallbacks (legacy / non-request callers)
  if (!baseUrl) {
    baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL || '';
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      baseUrl = `https://${baseUrl}`;
    }
  }
  if (!baseUrl) baseUrl = 'http://localhost:3000';

  return {
    channelId,
    channelSecret,
    redirectUri: `${baseUrl.replace(/\/$/, '')}/api/auth/line/callback`,
    oaBasicId,
  };
}

export type LineSession = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

export function encodeLineSession(s: LineSession): string {
  return JSON.stringify(s);
}

export function decodeLineSession(raw: string | undefined): LineSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LineSession;
    if (!parsed.userId || !parsed.displayName) return null;
    return parsed;
  } catch {
    return null;
  }
}
