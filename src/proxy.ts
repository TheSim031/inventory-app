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
 */
type Rule = {
  match: (pathname: string) => boolean;
  allowed: UserRole[];
};

const RULES: Rule[] = [
  // Inspection history — read-only for everyone except Assembly.
  {
    match: (p) => p === '/inspect/history' || p.startsWith('/inspect/history/'),
    allowed: ['WAREHOUSE', 'PURCHASING', 'EXECUTIVE', 'QC'],
  },
  // QC inspection screen itself — must come AFTER /inspect/history
  // (so the more-specific path wins the first-match).
  { match: (p) => p === '/inspect' || p.startsWith('/inspect/'), allowed: ['QC'] },

  // Warehouse pages. /out was removed in V7 (approval flow deleted) — keep
  // a rule with an empty allow-list so any deep-link still gets routed to
  // /403 rather than rendering a stale UI that calls a 410 endpoint.
  { match: (p) => p === '/in' || p.startsWith('/in/'), allowed: ['WAREHOUSE'] },
  { match: (p) => p === '/out' || p.startsWith('/out/'), allowed: [] },

  // Requisition (เบิก) — warehouse fulfills, purchasing/assembly request.
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
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const rule = RULES.find((r) => r.match(pathname));
  const authOnly = !rule && needsAuthOnly(pathname);
  if (!rule && !authOnly) return NextResponse.next();

  const ctx = getSessionContext(request);

  // Not signed in → bounce to landing/login. Preserve the destination
  // so post-login flow can return here.
  if (!ctx.isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Creator (super-admin) bypasses every role check.
  if (ctx.isCreator) return NextResponse.next();

  // /admin/* is creator-only — non-creators are denied.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/403';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  // /role-select needs auth but no role — let it through.
  if (authOnly) return NextResponse.next();

  // Role gate: must have a role AND it must be in the rule's allow-list.
  if (!ctx.role || !rule!.allowed.includes(ctx.role)) {
    const url = request.nextUrl.clone();
    url.pathname = '/403';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/in/:path*',
    '/out/:path*',
    '/request/:path*',
    '/inspect/:path*',
    '/purchasing/:path*',
    '/executive/:path*',
    '/qc/:path*',
    '/role-select/:path*',
    '/admin/:path*',
  ],
};
