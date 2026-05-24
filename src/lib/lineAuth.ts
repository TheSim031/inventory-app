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

export function getLineLoginConfig(): LineLoginConfig | null {
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
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.VERCEL_URL ||
    '';
  const oaBasicId = process.env.LINE_OA_BASIC_ID || '';

  if (!channelId || !channelSecret) return null;

  // Normalize base URL (NEXT_PUBLIC_BASE_URL is preferred; VERCEL_URL has no scheme)
  let normalized = baseUrl;
  if (normalized && !/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  if (!normalized) {
    normalized = 'http://localhost:3000';
  }

  return {
    channelId,
    channelSecret,
    redirectUri: `${normalized.replace(/\/$/, '')}/api/auth/line/callback`,
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
