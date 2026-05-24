/**
 * Server-side session + role guard.
 *
 * Edge-runtime safe: reads cookies only, no Google Sheets / network calls.
 * The role cookie is server-trusted (set on /role-select POST), so we treat
 * it as authoritative for authorization.
 */
import { NextResponse } from 'next/server';
import { decodeLineSession } from './lineAuth';
import { isUserRole, ROLE_COOKIE, type UserRole } from './userRole';

type CookieJar = {
  get: (name: string) => { value: string } | undefined;
};

type RequestLike = { cookies: CookieJar };

export type SessionContext = {
  isAuthenticated: boolean;
  isCreator: boolean;
  isAdmin: boolean;
  role: UserRole | null;
  lineUserId: string;
  displayName: string;
};

export function getSessionContext(request: RequestLike): SessionContext {
  const lineUser = decodeLineSession(request.cookies.get('line_user')?.value);
  const adminAuth = request.cookies.get('auth_session')?.value === 'authenticated';
  const isCreator =
    request.cookies.get('creator_session')?.value === 'authenticated';

  const rawRole = request.cookies.get(ROLE_COOKIE)?.value;
  const role: UserRole | null = isUserRole(rawRole) ? rawRole : null;

  return {
    isAuthenticated: !!lineUser || adminAuth || isCreator,
    isCreator,
    isAdmin: adminAuth,
    role,
    lineUserId: lineUser?.userId || '',
    displayName: lineUser?.displayName || '',
  };
}

/**
 * Returns null when access is allowed, or a NextResponse 401/403 the route
 * should return immediately. Creator bypasses every role check.
 *
 *   const denied = requireRoles(request, ['WAREHOUSE']);
 *   if (denied) return denied;
 */
export function requireRoles(
  request: RequestLike,
  allowed: UserRole[],
): NextResponse | null {
  const ctx = getSessionContext(request);
  if (!ctx.isAuthenticated) {
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบก่อน' }, { status: 401 });
  }
  if (ctx.isCreator) return null; // super-admin bypass
  if (allowed.length === 0) return null; // any authenticated user
  if (!ctx.role || !allowed.includes(ctx.role)) {
    return NextResponse.json(
      { error: 'ไม่มีสิทธิ์เข้าถึง — ต้องเป็น ' + allowed.join(' / ') },
      { status: 403 },
    );
  }
  return null;
}

/** Require simply that the caller is signed in (any role). */
export function requireAuth(request: RequestLike): NextResponse | null {
  const ctx = getSessionContext(request);
  if (!ctx.isAuthenticated) {
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบก่อน' }, { status: 401 });
  }
  return null;
}
