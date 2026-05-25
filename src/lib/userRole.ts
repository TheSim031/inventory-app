/**
 * User role — chosen on /role-select after login, persisted in a server-
 * trusted httpOnly cookie. Used to route the user to their default home
 * after login and (eventually) to gate per-role pages.
 */

export const USER_ROLES = [
  'WAREHOUSE',
  'PURCHASING',
  'EXECUTIVE',
  'QC',
  'ASSEMBLY',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, { th: string; en: string; icon: string }> = {
  WAREHOUSE:  { th: 'คลัง',       en: 'Warehouse',  icon: '📦' },
  PURCHASING: { th: 'จัดซื้อ',     en: 'Purchasing', icon: '🛒' },
  EXECUTIVE:  { th: 'ผู้บริหาร',   en: 'Executive',  icon: '📈' },
  QC:         { th: 'QC',         en: 'Quality',    icon: '🔍' },
  ASSEMBLY:   { th: 'ประกอบ',     en: 'Assembly',   icon: '🔧' },
};

/**
 * Where each role lands when they enter the system. Used both for post-
 * login redirects and for the "go to my home" link in shared chrome.
 */
/**
 * Where each role lands when they enter the system. Everyone goes to the
 * unified two-layer `/home` menu — clicking a main-category card from there
 * reveals the role-appropriate sub-items.
 */
export const ROLE_HOME: Record<UserRole, string> = {
  WAREHOUSE:  '/home',
  PURCHASING: '/home',
  EXECUTIVE:  '/home',
  QC:         '/home',
  ASSEMBLY:   '/home',
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export const ROLE_COOKIE = 'user_role';
