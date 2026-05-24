import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Auth gating for warehouse + role-specific routes. Replaces the
 * deprecated `middleware` file convention with Next.js 16's `proxy`.
 *
 * Authenticated = either the admin session cookie OR a LINE Login session.
 * Role-specific permission gating (does this role match this page?) will
 * happen at the page level in a later phase — for now we only check
 * "is the user signed in at all".
 *
 * /role-select itself needs auth (no anonymous role-setting), but does
 * NOT require a role to be set yet — that's the whole point of the page.
 */
const PROTECTED_PREFIXES = [
  '/in',
  '/out',
  '/role-select',
  '/purchasing',
  '/executive',
  '/qc',
  '/inspect',
  '/admin',
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isProtected) {
    const hasAdmin = request.cookies.get('auth_session')?.value === 'authenticated';
    const hasLineUser = !!request.cookies.get('line_user')?.value;
    const hasCreator =
      request.cookies.get('creator_session')?.value === 'authenticated';
    if (!hasAdmin && !hasLineUser && !hasCreator) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    // /admin/* requires creator session specifically — non-creators bounce
    // back to the landing page (not their role home, to avoid confusion).
    if (pathname.startsWith('/admin') && !hasCreator) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/in/:path*',
    '/out/:path*',
    '/role-select/:path*',
    '/purchasing/:path*',
    '/executive/:path*',
    '/qc/:path*',
    '/inspect/:path*',
    '/admin/:path*',
  ],
};
