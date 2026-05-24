import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Protect warehouse staff routes. Replaces the deprecated `middleware`
 * file convention with Next.js 16's `proxy` file convention.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsAuth =
    pathname === '/in' ||
    pathname.startsWith('/in/') ||
    pathname === '/out' ||
    pathname.startsWith('/out/');

  if (needsAuth) {
    const authed = request.cookies.get('auth_session')?.value === 'authenticated';
    if (!authed) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/in/:path*', '/out/:path*'],
};
