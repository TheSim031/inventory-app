import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const CREATOR_USERNAME = process.env.CREATOR_USERNAME || 'admin';
const CREATOR_PASSWORD =
  process.env.CREATOR_PASSWORD ||
  (process.env.NODE_ENV === 'production' ? '' : 'admin1234');
const COOKIE_NAME = 'creator_session';

/**
 * Creator login — the "secret button" at the bottom-left of the screen
 * funnels into here. Uses the legacy admin username/password so the
 * person who built the system can pop into a super-admin mode that
 * unlocks every menu plus the user-management admin pages.
 *
 * Accepts either { password } (modal — username defaults to "admin")
 * or { username, password } (form).
 */
export async function POST(request: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const username = body.username ?? CREATOR_USERNAME;
  const password = body.password ?? '';

  if (!CREATOR_PASSWORD) {
    return NextResponse.json(
      { error: 'ยังไม่ได้ตั้งค่า CREATOR_PASSWORD บน production' },
      { status: 503 },
    );
  }

  if (username !== CREATOR_USERNAME || password !== CREATOR_PASSWORD) {
    return NextResponse.json(
      { error: 'รหัสผ่านไม่ถูกต้อง' },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: 'authenticated',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 1 week
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
