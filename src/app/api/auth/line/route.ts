import { NextResponse, type NextRequest } from 'next/server';
import { getLineLoginConfig } from '@/lib/lineAuth';

export const dynamic = 'force-dynamic';

/**
 * Initiate LINE Login. Generates a random state token, stores it in a
 * short-lived httpOnly cookie, and redirects the user to LINE's auth page.
 * The callback handler verifies the state to defeat CSRF.
 */
export function GET(request: NextRequest) {
  const cfg = getLineLoginConfig(request);
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          'LINE Login is not configured. Set LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET / NEXT_PUBLIC_BASE_URL on Vercel.',
      },
      { status: 503 },
    );
  }

  const state = crypto.randomUUID();
  // ?next= lets us bounce the user back to where they came from after login.
  const nextParam = request.nextUrl.searchParams.get('next') || '/role-select';

  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cfg.channelId);
  authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'profile openid');
  // "consent" forces the bot-link prompt every time even for returning users —
  // omit it to be polite. The bot link is configured channel-side, not here.

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set('line_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  });
  response.cookies.set('line_oauth_next', nextParam, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });
  return response;
}
