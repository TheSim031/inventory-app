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
 * Two-layer menu tree. The /home landing page renders top-level items as
 * "main category" cards; clicking a card reveals its sub-items in a slide
 * panel. The MainNav top bar uses the same tree as a dropdown menu.
 *
 * Visibility per role is decided by ROLE_MENU_IDS below — anything not in a
 * role's allow-list is hidden. A parent is shown when its own id OR any of
 * its children's ids are visible.
 */
export const MENU_ITEMS: MenuItem[] = [
  {
    id: 'warehouse',
    label: 'คลังสินค้า',
    icon: '📦',
    children: [
      { id: 'in', label: 'บันทึกรับของ', href: '/in', icon: '📥' },
      { id: 'pick', label: 'จัดของ', href: '/out', icon: '📋' },
      { id: 'request', label: 'ใบเบิกสินค้า', href: '/request', icon: '📝' },
      { id: 'limit-stock', label: 'Limit Stock', href: '/limit-stock', icon: '🚨' },
    ],
  },
  {
    id: 'inspect',
    label: 'งานตรวจสอบ (QC)',
    icon: '🔍',
    children: [
      { id: 'inspect-do', label: 'ตรวจสอบรับเข้า', href: '/inspect', icon: '✅' },
      { id: 'inspect-history', label: 'ประวัติตรวจสอบ', href: '/inspect/history', icon: '📋' },
    ],
  },
  {
    id: 'admin',
    label: 'ระบบ',
    icon: '🛠',
    creatorOnly: true,
    children: [
      {
        id: 'admin-users',
        label: 'ข้อมูลผู้ใช้งาน',
        href: '/admin/users',
        icon: '👥',
        creatorOnly: true,
      },
      {
        id: 'admin-departments',
        label: 'แก้ไขแผนก',
        href: '/admin/departments',
        icon: '🏢',
        creatorOnly: true,
      },
      {
        id: 'admin-internal-pick',
        label: 'เบิกสินค้าภายใน (ไม่แจ้งเตือน)',
        href: '/admin/internal-pick',
        icon: '🤫',
        creatorOnly: true,
      },
    ],
  },
];

/**
 * Default per-role visibility. Each entry is the list of menu IDs the role
 * is allowed to see. A parent dropdown / card is shown if either the parent
 * ID OR any of its children IDs are in the list.
 *
 * Rules from the spec (unchanged in scope, restructured under new parents):
 *   WAREHOUSE  : คลัง (รับของ + จัดของ + เบิก + Limit Stock) + ประวัติตรวจสอบ
 *   PURCHASING : คลัง (เบิก + Limit Stock) + ประวัติตรวจสอบ
 *   EXECUTIVE  : ประวัติตรวจสอบ
 *   QC         : ตรวจสอบรับเข้า + ประวัติตรวจสอบ
 *   ASSEMBLY   : คลัง (เบิก)
 */
export const ROLE_MENU_IDS: Record<UserRole, string[]> = {
  WAREHOUSE:  ['warehouse', 'in', 'pick', 'request', 'limit-stock', 'inspect', 'inspect-history'],
  PURCHASING: ['warehouse', 'request', 'limit-stock', 'inspect', 'inspect-history'],
  EXECUTIVE:  ['inspect', 'inspect-history'],
  QC:         ['inspect', 'inspect-do', 'inspect-history'],
  ASSEMBLY:   ['warehouse', 'request'],
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
  /**
   * Staff/Admin session ("ผู้ดูแลระบบ"). When true, treated like Creator
   * for visibility — every main + sub menu is returned so the admin can
   * test every page without role-juggling. Regular users (role-only) stay
   * locked to their ROLE_MENU_IDS / customMenus list.
   */
  isAdmin?: boolean;
  customMenus?: string[] | null;
}): string[] {
  if (args.isCreator || args.isAdmin) {
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
        if (c.creatorOnly && !includeCreatorOnly) continue;
        out.push({ id: c.id, label: c.label, parentLabel: item.label });
      }
    } else {
      out.push({ id: item.id, label: item.label });
    }
  }
  return out;
}
