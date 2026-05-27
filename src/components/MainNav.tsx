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
import { AUTH_EVENT_KEY, broadcastAuthChanged, fetchJson } from '@/lib/authClient';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

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
 * Global top-of-page navigation.
 *
 * Two layouts share the same data:
 *   - Desktop (≥ 768px) — horizontal tab bar with click-to-open dropdowns.
 *   - Mobile  (< 768px) — hamburger icon that opens a full-height drawer
 *     with the menu tree stacked vertically. Sub-items are always visible
 *     under their parent so the user only taps once.
 */
export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me, mutate } = useSWR<MeResponse>('/api/auth/me', fetcher);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
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

  useEffect(() => {
    const onAuthEvent = (e: StorageEvent) => {
      if (e.key !== AUTH_EVENT_KEY) return;
      mutate(undefined, { revalidate: true });
      router.push('/');
      router.refresh();
    };
    window.addEventListener('storage', onAuthEvent);
    return () => window.removeEventListener('storage', onAuthEvent);
  }, [mutate, router]);

  // Auto-close mobile drawer on route change so users don't have to tap close.
  useEffect(() => {
    setMobileOpen(false);
    setOpenDropdown(null);
  }, [pathname]);

  // Lock page scroll while drawer is open.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  if (HIDDEN_ON.includes(pathname)) return null;
  if (!me?.isAuthenticated) return null;

  // Admin (ผู้ดูแลระบบ) unlocks every menu the same way Creator does, so
  // the test account can hop between pages from the top nav / mobile
  // drawer without role-juggling. Regular roles stay restricted.
  const isPower = me.isCreator || me.adminAuth;
  const visibleIds = new Set(
    getVisibleMenuIds({
      role: me.role,
      isCreator: me.isCreator,
      isAdmin: me.adminAuth,
      customMenus: me.customMenus,
    }),
  );

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const doLogout = async () => {
    setLoggingOut(true);
    await Promise.all([
      fetch('/api/auth/logout', { method: 'POST' }),
      fetch('/api/auth/line/logout', { method: 'POST' }),
      fetch('/api/auth/creator', { method: 'DELETE' }),
      fetch('/api/auth/role', { method: 'DELETE' }),
    ]);
    broadcastAuthChanged('logout');
    mutate();
    setShowLogoutConfirm(false);
    setLoggingOut(false);
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

  // Mobile drawer renders the whole tree flat (parent label + children) so
  // there is no second tap to discover sub-items.
  const renderMobileItem = (item: MenuItem) => {
    if (item.children?.length) {
      const visibleChildren = item.children.filter((c) => visibleIds.has(c.id));
      const parentVisible = visibleIds.has(item.id) || visibleChildren.length > 0;
      if (!parentVisible) return null;
      return (
        <div key={item.id} className="mainnav-mobile-group">
          <div className="mainnav-mobile-grouphead">
            <span className="mainnav-icon">{item.icon}</span> {item.label}
          </div>
          <div className="mainnav-mobile-children">
            {visibleChildren.map((c) => (
              <Link
                key={c.id}
                href={c.href || '#'}
                className={`mainnav-mobile-link${isActive(c) ? ' mainnav-mobile-link-active' : ''}`}
              >
                <span className="mainnav-icon">{c.icon}</span>
                <span className="mainnav-mobile-link-label">{c.label}</span>
                <span className="mainnav-mobile-link-arrow">→</span>
              </Link>
            ))}
          </div>
        </div>
      );
    }
    if (!visibleIds.has(item.id)) return null;
    return (
      <Link
        key={item.id}
        href={item.href || '#'}
        className={`mainnav-mobile-link mainnav-mobile-link-solo${isActive(item) ? ' mainnav-mobile-link-active' : ''}`}
      >
        <span className="mainnav-icon">{item.icon}</span>
        <span className="mainnav-mobile-link-label">{item.label}</span>
        <span className="mainnav-mobile-link-arrow">→</span>
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
        {/* Hamburger — visible only on mobile. */}
        <button
          type="button"
          className={`mainnav-hamburger${mobileOpen ? ' mainnav-hamburger-open' : ''}`}
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
          aria-expanded={mobileOpen}
        >
          <span />
          <span />
          <span />
        </button>

        {/* Desktop horizontal tabs. */}
        <div className="mainnav-items mainnav-items-desktop">
          {MENU_ITEMS.map(renderTopItem)}
        </div>

        <div className="mainnav-right">
          {userBadge}
          {/*
            Regular users cannot change their own group once it is bound
            (locked by /api/auth/role + the role-select server guard). The
            self-service "🔄 เปลี่ยนกลุ่ม" shortcut is therefore only shown
            to Creator + Admin sessions — Creator for impersonation/support,
            Admin for system-wide testing across every role.
          */}
          {isPower && (
            <Link href="/role-select" className="mainnav-secondary" title="เปลี่ยนกลุ่ม (ผู้ดูแลระบบ)">
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

      {/* Logout confirmation modal */}
      {showLogoutConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-title">🚪 ออกจากระบบ</div>
            <div className="modal-body">
              คุณต้องการออกจากระบบใช่หรือไม่?
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn-no"
                onClick={() => setShowLogoutConfirm(false)}
                disabled={loggingOut}
              >
                ไม่ใช่
              </button>
              <button
                type="button"
                className="modal-btn modal-btn-yes"
                onClick={doLogout}
                disabled={loggingOut}
              >
                {loggingOut ? '⏳ กำลังออก...' : 'ใช่ ออกจากระบบ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="mainnav-mobile-backdrop"
          role="presentation"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="mainnav-mobile-panel"
            role="dialog"
            aria-label="เมนูหลัก"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mainnav-mobile-head">
              <div className="mainnav-mobile-head-title">เมนูหลัก</div>
              <button
                type="button"
                className="mainnav-mobile-close"
                onClick={() => setMobileOpen(false)}
                aria-label="ปิดเมนู"
              >
                ✕
              </button>
            </div>
            <div className="mainnav-mobile-body">
              {MENU_ITEMS.map(renderMobileItem)}
            </div>
            <div className="mainnav-mobile-foot">
              {userBadge}
              {isPower && (
                <Link href="/role-select" className="mainnav-secondary mainnav-mobile-secondary">
                  🔄 เปลี่ยนกลุ่ม
                </Link>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="mainnav-secondary mainnav-logout mainnav-mobile-secondary"
              >
                ออกจากระบบ
              </button>
            </div>
          </aside>
        </div>
      )}
    </nav>
  );
}
