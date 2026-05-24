import type { UserRole } from './userRole';

export type MenuItem = {
  id: string;
  label: string;
  icon: string;
  href?: string;
  children?: MenuItem[];
  /** When true, only the creator (secret login) sees this menu. */
  creatorOnly?: boolean;
};

/**
 * The complete menu tree. Visibility per role is decided by
 * ROLE_MENU_IDS below — anything not in a role's allow-list is hidden.
 *
 * Children's IDs are included in the role allow-list independently of
 * the parent, so we can show a parent dropdown even when only one child
 * is visible to that role.
 */
export const MENU_ITEMS: MenuItem[] = [
  {
    id: 'warehouse',
    label: 'คลัง',
    icon: '📦',
    children: [
      { id: 'in', label: 'รับของ', href: '/in', icon: '📥' },
      { id: 'out', label: 'จัดของ', href: '/out', icon: '📤' },
    ],
  },
  { id: 'request', label: 'เบิก', href: '/request', icon: '📝' },
  { id: 'inspect', label: 'ตรวจสอบ', href: '/inspect', icon: '🔍' },
  { id: 'inspect-history', label: 'ประวัติตรวจสอบ', href: '/inspect/history', icon: '📋' },
  {
    id: 'admin-users',
    label: 'ข้อมูลผู้ใช้งาน',
    href: '/admin/users',
    icon: '👥',
    creatorOnly: true,
  },
];

/**
 * Default per-role visibility. Each entry is the list of menu IDs the
 * role is allowed to see. A parent dropdown is shown if either the
 * parent ID OR any of its children IDs are in the list.
 *
 * Rules from the spec:
 *   WAREHOUSE  : "คลัง (รับของ+จัดของ)" + "เบิก" + "ประวัติตรวจสอบ"
 *   PURCHASING : "เบิก" + "ประวัติตรวจสอบ"
 *   EXECUTIVE  : "ประวัติตรวจสอบ"
 *   QC         : "ตรวจสอบ" + "ประวัติตรวจสอบ"
 *   ASSEMBLY   : "เบิก"
 */
export const ROLE_MENU_IDS: Record<UserRole, string[]> = {
  WAREHOUSE:  ['warehouse', 'in', 'out', 'request', 'inspect-history'],
  PURCHASING: ['request', 'inspect-history'],
  EXECUTIVE:  ['inspect-history'],
  QC:         ['inspect', 'inspect-history'],
  ASSEMBLY:   ['request'],
};

/**
 * Decide which menu IDs to render for a given user. The creator (secret
 * login) sees everything regardless of role.
 *
 * A per-user custom menu list (when present) replaces the role default
 * entirely, so admins can grant precise extra/fewer permissions to
 * specific users without changing their role.
 */
export function getVisibleMenuIds(args: {
  role: UserRole | null;
  isCreator: boolean;
  customMenus?: string[] | null;
}): string[] {
  if (args.isCreator) {
    return MENU_ITEMS.flatMap((m) => [m.id, ...(m.children?.map((c) => c.id) ?? [])]);
  }
  if (Array.isArray(args.customMenus) && args.customMenus.length > 0) {
    return args.customMenus;
  }
  if (!args.role) return [];
  return ROLE_MENU_IDS[args.role];
}

/** Flat list of every menu ID — useful for permission editors / pickers. */
export function getAllMenuIds(includeCreatorOnly = false): Array<{
  id: string;
  label: string;
  parentLabel?: string;
}> {
  const out: Array<{ id: string; label: string; parentLabel?: string }> = [];
  for (const item of MENU_ITEMS) {
    if (item.creatorOnly && !includeCreatorOnly) continue;
    if (item.children?.length) {
      out.push({ id: item.id, label: item.label });
      for (const c of item.children) {
        out.push({ id: c.id, label: c.label, parentLabel: item.label });
      }
    } else {
      out.push({ id: item.id, label: item.label });
    }
  }
  return out;
}
