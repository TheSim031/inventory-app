import { NextResponse } from 'next/server';
import { ROLE_COOKIE } from '@/lib/userRole';

const STAFF_USERNAME = process.env.STAFF_USERNAME || 'admin';
const STAFF_PASSWORD =
  process.env.STAFF_PASSWORD ||
  (process.env.NODE_ENV === 'production' ? '' : 'admin1234');

/**
 * Staff/admin login (legacy username+password). On success we drop both
 * the admin session cookie and a default user_role=WAREHOUSE so the
 * staff path bypasses /role-select — admins are always warehouse users
 * by convention in this build.
 */
export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!STAFF_PASSWORD) {
      return NextResponse.json(
        { error: 'ยังไม่ได้ตั้งค่า STAFF_PASSWORD บน production' },
        { status: 503 },
      );
    }

    if (username === STAFF_USERNAME && password === STAFF_PASSWORD) {
      const response = NextResponse.json({ success: true, role: 'WAREHOUSE' });

      response.cookies.set({
        name: 'auth_session',
        value: 'authenticated',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 1 week
      });

      response.cookies.set({
        name: ROLE_COOKIE,
        value: 'WAREHOUSE',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });

      return response;
    }

    return NextResponse.json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด' }, { status: 500 });
  }
}
