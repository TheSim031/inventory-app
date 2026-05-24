'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  getVisibleMenuIds,
  MENU_ITEMS,
  type MenuItem,
} from '@/lib/menu';
import { ROLE_LABELS, type UserRole } from '@/lib/userRole';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((r) => r.json());

type MeResponse = {
  user: { userId: string; displayName: string; pictureUrl?: string } | null;
  adminAuth: boolean;
  isAuthenticated: boolean;
  isCreator: boolean;
  role: UserRole | null;
  customMenus: string[] | null;
};

const HIDDEN_ON = ['/', '/login', '/role-select'];

/**
 * Global top-of-page navigation. Renders nothing on auth pages so the
 * landing/role-select screens stay uncluttered. The visible menu items
 * are computed from the user's role + creator flag + per-user override
 * (filled in once the admin panel ships).
 */
export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me, mutate } = useSWR<MeResponse>('/api/auth/me', fetcher);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (HIDDEN_ON.includes(pathname)) return null;
  if (!me?.isAuthenticated) return null;

  const visibleIds = new Set(
    getVisibleMenuIds({
      role: me.role,
      isCreator: me.isCreator,
      customMenus: me.customMenus,
    }),
  );

  const handleLogout = async () => {
    if (!confirm('ออกจากระบบ?')) return;
    await Promise.all([
      fetch('/api/auth/logout', { method: 'POST' }),
      fetch('/api/auth/line/logout', { method: 'POST' }),
      fetch('/api/auth/creator', { method: 'DELETE' }),
      fetch('/api/auth/role', { method: 'DELETE' }),
    ]);
    mutate();
    router.push('/');
    router.refresh();
  };

  const isActive = (item: MenuItem): boolean => {
    if (item.href && pathname === item.href) return true;
    if (item.href && pathname.startsWith(`${item.href}/`)) return true;
    if (item.children) {
      return item.children.some((c) => isActive(c));
    }
    return false;
  };

  const renderTopItem = (item: MenuItem) => {
    // Parent with children → only show if parent or any child is visible
    if (item.children?.length) {
      const visibleChildren = item.children.filter((c) => visibleIds.has(c.id));
      const parentVisible = visibleIds.has(item.id) || visibleChildren.length > 0;
      if (!parentVisible) return null;
      const active = isActive(item);
      const open = openDropdown === item.id;
      return (
        <div key={item.id} className="mainnav-group">
          <button
            type="button"
            className={`mainnav-tab${active ? ' mainnav-tab-active' : ''}`}
            onClick={() => setOpenDropdown(open ? null : item.id)}
            aria-expanded={open}
          >
            <span className="mainnav-icon">{item.icon}</span> {item.label}
            <span className="mainnav-caret">▾</span>
          </button>
          {open && (
            <div className="mainnav-dropdown">
              {visibleChildren.map((c) => (
                <Link
                  key={c.id}
                  href={c.href || '#'}
                  className={`mainnav-drop-item${isActive(c) ? ' mainnav-drop-active' : ''}`}
                  onClick={() => setOpenDropdown(null)}
                >
                  <span className="mainnav-icon">{c.icon}</span> {c.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      );
    }
    // Leaf
    if (!visibleIds.has(item.id)) return null;
    const active = isActive(item);
    return (
      <Link
        key={item.id}
        href={item.href || '#'}
        className={`mainnav-tab${active ? ' mainnav-tab-active' : ''}`}
      >
        <span className="mainnav-icon">{item.icon}</span> {item.label}
      </Link>
    );
  };

  const userBadge = (() => {
    if (me.isCreator) {
      return (
        <span className="mainnav-badge mainnav-badge-creator">
          🔐 Creator
        </span>
      );
    }
    if (me.user) {
      return (
        <span className="mainnav-badge mainnav-badge-line">
          🟢 {me.user.displayName}
          {me.role && (
            <span className="mainnav-role">· {ROLE_LABELS[me.role].th}</span>
          )}
        </span>
      );
    }
    if (me.adminAuth) {
      return <span className="mainnav-badge mainnav-badge-admin">🛠 Staff</span>;
    }
    return null;
  })();

  return (
    <nav className="mainnav no-print" ref={navRef}>
      <div className="mainnav-inner">
        <div className="mainnav-items">
          {MENU_ITEMS.map(renderTopItem)}
        </div>
        <div className="mainnav-right">
          {userBadge}
          {!me.isCreator && me.role && (
            <Link href="/role-select" className="mainnav-secondary" title="เปลี่ยนกลุ่ม">
              🔄
            </Link>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="mainnav-secondary mainnav-logout"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </nav>
  );
}
