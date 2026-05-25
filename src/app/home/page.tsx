import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { decodeLineSession } from '@/lib/lineAuth';
import { findUserRow } from '@/lib/googleSheets';
import { isUserRole, ROLE_COOKIE, ROLE_LABELS, type UserRole } from '@/lib/userRole';
import HomeMenu from './HomeMenu';

export const dynamic = 'force-dynamic';

/**
 * Unified post-login landing. Renders the two-layer category menu (main
 * categories as cards → click reveals sub-items in a slide panel). Server-
 * side it figures out the user's role from cookie (fast path) or the Users
 * sheet (fallback after a cookie wipe), and also pulls any per-user custom
 * menu override so the page renders correctly on first paint.
 */
export default async function HomePage() {
  const store = await cookies();
  const lineUser = decodeLineSession(store.get('line_user')?.value);
  const adminAuth = store.get('auth_session')?.value === 'authenticated';
  const isCreator = store.get('creator_session')?.value === 'authenticated';

  if (!lineUser && !adminAuth && !isCreator) {
    redirect('/');
  }

  // Resolve role: cookie first, then the Users sheet for LINE users.
  const rawRole = store.get(ROLE_COOKIE)?.value;
  let role: UserRole | null = isUserRole(rawRole) ? rawRole : null;
  let customMenus: string[] | null = null;

  if (lineUser?.userId) {
    try {
      const row = await findUserRow(lineUser.userId);
      if (row) {
        if (!role && row.role && isUserRole(row.role)) {
          role = row.role;
        }
        if (row.customMenus.length > 0) {
          customMenus = row.customMenus;
        }
      }
    } catch (err) {
      console.error('home page: findUserRow failed:', err);
    }
  }

  // Regular LINE user with no bound role yet — send them to onboarding.
  // (Creator / admin can browse /home with no role; everything is hidden
  // except the admin category which they see via the creator flag.)
  if (lineUser && !role && !isCreator && !adminAuth) {
    redirect('/role-select');
  }

  const displayName =
    lineUser?.displayName || (isCreator ? 'Creator' : adminAuth ? 'Staff' : 'ผู้ใช้');

  const roleLabel = role ? ROLE_LABELS[role].th : isCreator ? 'Creator' : 'Staff';
  const roleIcon = role ? ROLE_LABELS[role].icon : isCreator ? '🔐' : '🛠';

  return (
    <HomeMenu
      role={role}
      isCreator={isCreator}
      customMenus={customMenus}
      displayName={displayName}
      roleLabel={roleLabel}
      roleIcon={roleIcon}
    />
  );
}
