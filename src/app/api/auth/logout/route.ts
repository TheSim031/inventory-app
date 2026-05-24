import { NextResponse } from 'next/server';
import { ROLE_COOKIE } from '@/lib/userRole';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete('auth_session');
  response.cookies.delete(ROLE_COOKIE);
  return response;
}
