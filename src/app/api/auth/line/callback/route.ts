import { NextResponse, type NextRequest } from 'next/server';
import { encodeLineSession, getLineLoginConfig } from '@/lib/lineAuth';
import { upsertUser } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';

/**
 * LINE Login callback. Exchanges the auth code for an access token,
 * fetches the profile, and sets an httpOnly session cookie. Bounces the
 * user to the page they came from (?next=… captured at the /api/auth/line
 * step) — defaults to /request.
 */
export async function GET(request: NextRequest) {
  const cfg = getLineLoginConfig(request);
  if (!cfg) {
    return NextResponse.json({ error: 'LINE Login not configured' }, { status: 503 });
  }

  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    const failUrl = new URL('/', request.url);
    failUrl.searchParams.set('line_error', errorDescription || error);
    return NextResponse.redirect(failUrl);
  }

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code/state in callback' }, { status: 400 });
  }

  const expectedState = request.cookies.get('line_oauth_state')?.value;
  if (!expectedState || expectedState !== state) {
    return NextResponse.json({ error: 'Invalid state (possible CSRF)' }, { status: 400 });
  }

  const nextPath = request.cookies.get('line_oauth_next')?.value || '/role-select';

  // Exchange authorization code → access token
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.channelId,
    client_secret: cfg.channelSecret,
  });

  let accessToken = '';
  try {
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('LINE token exchange failed:', body);
      return NextResponse.json({ error: 'Token exchange failed', detail: body }, { status: 500 });
    }
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    accessToken = tokenData.access_token || '';
  } catch (err) {
    console.error('LINE token exchange error:', err);
    return NextResponse.json({ error: 'Token exchange request failed' }, { status: 500 });
  }

  if (!accessToken) {
    return NextResponse.json({ error: 'No access token returned by LINE' }, { status: 500 });
  }

  // Fetch profile
  let profile: { userId: string; displayName: string; pictureUrl?: string };
  try {
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      const body = await profileRes.text();
      console.error('LINE profile fetch failed:', body);
      return NextResponse.json({ error: 'Profile fetch failed', detail: body }, { status: 500 });
    }
    profile = (await profileRes.json()) as typeof profile;
  } catch (err) {
    console.error('LINE profile fetch error:', err);
    return NextResponse.json({ error: 'Profile fetch request failed' }, { status: 500 });
  }

  if (!profile.userId || !profile.displayName) {
    return NextResponse.json({ error: 'Incomplete profile from LINE' }, { status: 500 });
  }

  // Record the login in the Users sheet — fire and forget. If the sheet
  // isn't reachable we don't want to fail the login over it.
  upsertUser({
    lineUserId: profile.userId,
    displayName: profile.displayName,
  }).catch((err) => console.error('upsertUser failed:', err));

  // Set session cookie + clear oauth state cookies, then redirect to wherever
  // the user was trying to go.
  const target = new URL(nextPath.startsWith('/') ? nextPath : '/role-select', request.url);
  const response = NextResponse.redirect(target);
  response.cookies.set(
    'line_user',
    encodeLineSession({
      userId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
  );
  response.cookies.delete('line_oauth_state');
  response.cookies.delete('line_oauth_next');
  return response;
}
