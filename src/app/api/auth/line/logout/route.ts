import { NextResponse } from 'next/server';
import { ROLE_COOKIE } from '@/lib/userRole';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('line_user');
  // Clearing role on logout means the next sign-in always lands on
  // /role-select — same UX for everyone.
  response.cookies.delete(ROLE_COOKIE);
  return response;
}
