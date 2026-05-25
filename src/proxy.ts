import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import type { UserRole } from '@/lib/userRole';

/**
 * Auth + role gate for every protected page. Next.js 16 replaced
 * `middleware` with `proxy`, so this file is the single source of truth
 * for "can this user reach this URL". The MainNav hides menu items the
 * user shouldn't see, but typing a URL directly would bypass that —
 * these rules enforce it server-side.
 *
 * Order matters: the first matching rule wins, so list more specific
 * paths (e.g. `/inspect/history`) before less specific ones (`/inspect`).
 *
 * Rules mirror ROLE_MENU_IDS in src/lib/menu.ts — keep them in sync.
 *
 * Persistent login: when an authenticated request comes in, we also push
 * the LINE session + role cookies' expiry forward by another 30 days
 * (rolling TTL). The only way to lose the session is to explicitly hit
 * the "ออกจากระบบ" button — which clears every cookie below.
 */
type Rule = {
  match: (pathname: string) => boolean;
  allowed: UserRole[];
};

const SESSION_COOKIE = 'line_user';
const ROLE_COOKIE = 'user_role';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const RULES: Rule[] = [
  // Inspection history — read-only for everyone except Assembly.
  {
    match: (p) => p === '/inspect/history' || p.startsWith('/inspect/history/'),
    allowed: ['WAREHOUSE', 'PURCHASING', 'EXECUTIVE', 'QC'],
  },
  // QC inspection screen itself — must come AFTER /inspect/history
  // (so the more-specific path wins the first-match).
  { match: (p) => p === '/inspect' || p.startsWith('/inspect/'), allowed: ['QC'] },

  { match: (p) => p === '/in' || p.startsWith('/in/'), allowed: ['WAREHOUSE'] },

  // Pick queue — warehouse fulfills pending requisitions.
  { match: (p) => p === '/pick' || p.startsWith('/pick/'), allowed: ['WAREHOUSE'] },

  // Limit Stock — Warehouse + Purchasing can view/edit.
  {
    match: (p) => p === '/limit-stock' || p.startsWith('/limit-stock/'),
    allowed: ['WAREHOUSE', 'PURCHASING'],
  },

  // Requisition (เบิก) — any of these roles can submit OUT directly.
  {
    match: (p) => p === '/request' || p.startsWith('/request/'),
    allowed: ['WAREHOUSE', 'PURCHASING', 'ASSEMBLY'],
  },

  // Role-home placeholder pages — only the matching role belongs here.
  {
    match: (p) => p === '/purchasing' || p.startsWith('/purchasing/'),
    allowed: ['PURCHASING'],
  },
  {
    match: (p) => p === '/executive' || p.startsWith('/executive/'),
    allowed: ['EXECUTIVE'],
  },
  { match: (p) => p === '/qc' || p.startsWith('/qc/'), allowed: ['QC'] },
];

/**
 * Paths that need authentication but don't have a role rule:
 *   - /role-select: must be signed in, role not required (that's the point)
 *   - /admin/*    : creator-only, handled separately below
 */
function needsAuthOnly(pathname: string): boolean {
  if (pathname === '/role-select' || pathname.startsWith('/role-select/')) return true;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return true;
  // Unified post-login menu — must be signed in but works for every role.
  if (pathname === '/home' || pathname.startsWith('/home/')) return true;
  return false;
}

/**
 * Heuristic to detect a request coming from the LINE in-app browser.
 * When true and the user is signed out, we deep-link them straight to
 * `/api/auth/line` so they don't have to tap the "🟢 เข้าสู่ระบบด้วย
 * LINE" button on the landing page — the OAuth round trip starts the
 * moment they tap a Rich Menu link.
 *
 * Regular desktop / mobile browsers still see the landing page so the
 * Staff Login fallback stays reachable.
 */
function isLineInAppBrowser(request: NextRequest): boolean {
  const ua = request.headers.get('user-agent') || '';
  return /\bLine\//i.test(ua);
}

/**
 * Rolling refresh of the persistent-login cookies. Re-issues `line_user`
 * and `user_role` with a fresh 30-day TTL on every authenticated page
 * hit, so as long as the user opens the app at least once a month they
 * remain signed in until they explicitly log out.
 *
 * Only refreshes cookies that already exist — never creates new ones.
 */
function rollSessionCookies(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const secure = process.env.NODE_ENV === 'production';
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session) {
    response.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
  }
  const role = request.cookies.get(ROLE_COOKIE)?.value;
  if (role) {
    response.cookies.set(ROLE_COOKIE, role, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
  }
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const rule = RULES.find((r) => r.match(pathname));
  const authOnly = !rule && needsAuthOnly(pathname);
  if (!rule && !authOnly) {
    return rollSessionCookies(request, NextResponse.next());
  }

  const ctx = getSessionContext(request);

  // Not signed in → kick off auth. For LINE in-app browser users we
  // skip the landing-page picker entirely and go straight to LINE
  // OAuth, so a Rich Menu tap feels like a single redirect.
  if (!ctx.isAuthenticated) {
    if (isLineInAppBrowser(request)) {
      const oauth = new URL('/api/auth/line', request.url);
      oauth.searchParams.set('next', pathname);
      return NextResponse.redirect(oauth);
    }
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Creator (super-admin) and Admin (staff session, "ผู้ดูแลระบบ") both
  // bypass every role check. Admin is unlocked here so the test account
  // can freely jump between /in, /request, /limit-stock, /inspect, etc.
  // without flipping the user_role cookie each time.
  if (ctx.isCreator || ctx.isAdmin) {
    return rollSessionCookies(request, NextResponse.next());
  }

  // /admin/* is creator/admin-only — regular roles are denied. (The bypass
  // above already let Creator/Admin through, so reaching this branch means
  // the caller is a normal LINE user.)
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/403';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  // /role-select needs auth but no role — let it through.
  if (authOnly) {
    return rollSessionCookies(request, NextResponse.next());
  }

  // Role gate: must have a role AND it must be in the rule's allow-list.
  if (!ctx.role || !rule!.allowed.includes(ctx.role)) {
    const url = request.nextUrl.clone();
    url.pathname = '/403';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  return rollSessionCookies(request, NextResponse.next());
}

export const config = {
  matcher: [
    '/home/:path*',
    '/in/:path*',
    '/request/:path*',
    '/limit-stock/:path*',
    '/inspect/:path*',
    '/purchasing/:path*',
    '/executive/:path*',
    '/qc/:path*',
    '/role-select/:path*',
    '/admin/:path*',
  ],
};
