import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { decodeLineSession } from '@/lib/lineAuth';
import { findUserRow } from '@/lib/googleSheets';
import { isUserRole, ROLE_HOME } from '@/lib/userRole';
import RoleSelectClient from './RoleSelectClient';

export const dynamic = 'force-dynamic';

/**
 * Role-select is a *first-time-only* screen for LINE users. Once a group
 * is bound to a LINE userId in the Users sheet, this route bounces them
 * straight to /home — they can't self-change. Creator and Admin sessions
 * are exempt (they may need to set/change a role for support).
 */
export default async function RoleSelectPage() {
  const store = await cookies();
  const lineUser = decodeLineSession(store.get('line_user')?.value);
  const adminAuth = store.get('auth_session')?.value === 'authenticated';
  const isCreator = store.get('creator_session')?.value === 'authenticated';

  if (!lineUser && !adminAuth && !isCreator) {
    redirect('/');
  }

  // Creator + admin bypass the lock — they may legitimately need to pick a
  // role during impersonation or first staff setup.
  if (isCreator || adminAuth) {
    return <RoleSelectClient />;
  }

  // LINE users: if a group is already bound in the sheet, send them home.
  if (lineUser?.userId) {
    try {
      const row = await findUserRow(lineUser.userId);
      if (row && row.role && isUserRole(row.role)) {
        redirect(ROLE_HOME[row.role]);
      }
    } catch (err) {
      console.error('role-select sheet lookup failed:', err);
      // Fall through — let the user choose if Sheets is unreachable so
      // they aren't locked out of the system.
    }
  }

  return <RoleSelectClient />;
}
