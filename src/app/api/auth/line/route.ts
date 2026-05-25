import { NextResponse, type NextRequest } from 'next/server';
import { decodeLineSession, getLineLoginConfig } from '@/lib/lineAuth';
import { isUserRole, ROLE_COOKIE, ROLE_HOME } from '@/lib/userRole';

export const dynamic = 'force-dynamic';

/**
 * Initiate LINE Login. Generates a random state token, stores it in a
 * short-lived httpOnly cookie, and redirects the user to LINE's auth page.
 * The callback handler verifies the state to defeat CSRF.
 *
 * Short-circuit: if the caller already has a valid `line_user` cookie,
 * we skip the OAuth round-trip entirely and send them straight to the
 * page they wanted (or their role's home). This is what makes the
 * "ไม่ต้องกดปุ่มล็อกอินซ้ำอีกรอบ" persistent-login guarantee hold even
 * when a Rich Menu / login-button URL points back at this endpoint.
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

  // ?next= lets us bounce the user back to where they came from after login.
  const nextParam = request.nextUrl.searchParams.get('next') || '/role-select';

  // Already signed in? Skip OAuth and just go where they were headed.
  const existing = decodeLineSession(request.cookies.get('line_user')?.value);
  if (existing) {
    const rawRole = request.cookies.get(ROLE_COOKIE)?.value;
    let landing = nextParam.startsWith('/') ? nextParam : '/role-select';
    if (landing === '/role-select' && isUserRole(rawRole)) {
      landing = ROLE_HOME[rawRole];
    }
    return NextResponse.redirect(new URL(landing, request.url));
  }

  const state = crypto.randomUUID();

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
