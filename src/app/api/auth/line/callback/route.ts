import { NextResponse, type NextRequest } from 'next/server';
import { encodeLineSession, getLineLoginConfig } from '@/lib/lineAuth';
import { findUserRow, upsertUser } from '@/lib/googleSheets';
import { isUserRole, ROLE_COOKIE, ROLE_HOME } from '@/lib/userRole';

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

  // Record the login in the Users sheet and refresh lastLogin. We await
  // here so the subsequent role lookup sees the row.
  try {
    await upsertUser({
      lineUserId: profile.userId,
      displayName: profile.displayName,
    });
  } catch (err) {
    console.error('upsertUser failed:', err);
  }

  // Look up the user's saved group. The group is bound permanently to the
  // LINE userId at first-time selection — on subsequent logins we restore
  // it from the sheet so the user skips /role-select and goes straight to
  // their home. Only an Admin can change the saved group (via the admin
  // panel / sheet directly).
  let savedRole: string | null = null;
  try {
    const row = await findUserRow(profile.userId);
    if (row && row.role && isUserRole(row.role)) {
      savedRole = row.role;
    }
  } catch (err) {
    console.error('findUserRow on callback failed:', err);
  }

  // Decide where to land. If the user already has a saved role, override
  // whatever nextPath said and send them to their role's home — the saved
  // group is authoritative now.
  let landing = nextPath.startsWith('/') ? nextPath : '/role-select';
  if (savedRole && isUserRole(savedRole)) {
    landing = ROLE_HOME[savedRole];
  }

  const target = new URL(landing, request.url);
  const response = NextResponse.redirect(target);

  // Mirror the saved role into a server-trusted role cookie so server pages
  // (and the auth guards) can see it without another Sheets round-trip.
  if (savedRole && isUserRole(savedRole)) {
    response.cookies.set(ROLE_COOKIE, savedRole, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
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
