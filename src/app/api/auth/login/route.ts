import { NextResponse } from 'next/server';
import { ROLE_COOKIE } from '@/lib/userRole';

/**
 * Staff/admin login (legacy username+password). On success we drop both
 * the admin session cookie and a default user_role=WAREHOUSE so the
 * staff path bypasses /role-select — admins are always warehouse users
 * by convention in this build.
 */
export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    // Hardcoded credentials for now, as requested
    if (username === 'admin' && password === 'admin1234') {
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
