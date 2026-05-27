'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { USER_ROLES, ROLE_LABELS, type UserRole } from '@/lib/userRole';
import { broadcastAuthChanged, fetchJson } from '@/lib/authClient';
import styles from './role-select.module.css';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

type MeResponse = {
  user: { userId: string; displayName: string; pictureUrl?: string } | null;
  adminAuth: boolean;
  isAuthenticated: boolean;
  role: UserRole | null;
  lineLoginEnabled: boolean;
  oaBasicId: string;
};

type CustomGroup = {
  id: string;
  name: string;
  icon: string;
  menuIds: string[];
  baseRole: string;
};

type CustomGroupsResponse = { groups: CustomGroup[] };

type Selection =
  | { type: 'role'; value: UserRole }
  | { type: 'group'; value: CustomGroup };

export default function RoleSelectClient() {
  const router = useRouter();

  const [selected, setSelected] = useState<Selection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const { data: me, isLoading } = useSWR<MeResponse>('/api/auth/me', fetcher, {
    onSuccess: (data) => {
      if (data.role) {
        setSelected((prev) =>
          prev ?? { type: 'role', value: data.role as UserRole },
        );
      }
    },
  });
  const { data: groupsData } = useSWR<CustomGroupsResponse>(
    '/api/admin/groups',
    fetcher,
  );
  const customGroups = groupsData?.groups ?? [];

  // Anyone hitting /role-select without a session should bounce back to /
  useEffect(() => {
    if (me && !me.isAuthenticated) {
      router.replace('/');
    }
  }, [me, router]);

  const handleConfirm = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload =
        selected.type === 'role'
          ? { role: selected.value }
          : { customGroupId: selected.value.id };
      const res = await fetch('/api/auth/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { success?: boolean; home?: string; error?: string };
      if (res.ok && data.home) {
        router.push(data.home);
        router.refresh();
        return;
      }
      setError(data.error || 'บันทึก role ไม่สำเร็จ');
    } catch {
      setError('เชื่อมต่อระบบไม่ได้');
    }
    setSubmitting(false);
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const doLogout = async () => {
    setLoggingOut(true);
    await Promise.all([
      fetch('/api/auth/line/logout', { method: 'POST' }),
      fetch('/api/auth/logout', { method: 'POST' }),
      fetch('/api/auth/role', { method: 'DELETE' }),
    ]);
    broadcastAuthChanged('logout');
    setShowLogoutConfirm(false);
    setLoggingOut(false);
    router.push('/');
    router.refresh();
  };

  if (isLoading || !me) {
    return (
      <div className={styles.container}>
        <p style={{ color: 'var(--text-secondary)' }}>กำลังโหลด...</p>
      </div>
    );
  }

  const displayName =
    me.user?.displayName || (me.adminAuth ? 'Staff (admin)' : 'ผู้ใช้');

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.greeting}>
          🟢 สวัสดีคุณ {displayName}
        </div>
        <h1>
          เลือก<span>กลุ่มประเภทผู้ใช้งาน</span>
        </h1>
        <p>
          ระบบจะใช้กลุ่มที่คุณเลือกเพื่อแสดงเมนูและกำหนดสิทธิ์การเข้าถึงที่เกี่ยวข้อง
        </p>
      </header>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.grid}>
        {USER_ROLES.map((role) => {
          const info = ROLE_LABELS[role];
          const active = selected?.type === 'role' && selected.value === role;
          return (
            <button
              key={role}
              type="button"
              onClick={() => setSelected({ type: 'role', value: role })}
              className={`${styles.roleCard} ${active ? styles.roleCardActive : ''}`}
            >
              <div className={styles.roleIcon}>{info.icon}</div>
              <div className={styles.roleTh}>{info.th}</div>
              <div className={styles.roleEn}>{info.en}</div>
            </button>
          );
        })}
        {customGroups.map((group) => {
          const active = selected?.type === 'group' && selected.value.id === group.id;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setSelected({ type: 'group', value: group })}
              className={`${styles.roleCard} ${active ? styles.roleCardActive : ''}`}
              title={`กลุ่มกำหนดเอง — ${group.menuIds.length} เมนู`}
            >
              <div className={styles.roleIcon}>{group.icon || '👥'}</div>
              <div className={styles.roleTh}>{group.name}</div>
              <div className={styles.roleEn}>Custom Group</div>
            </button>
          );
        })}
      </div>

      <div className={styles.confirmBar}>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!selected || submitting}
          className={styles.btnConfirm}
        >
          {submitting
            ? '⏳ กำลังบันทึก...'
            : selected
            ? `✓ ยืนยันเข้าใช้งานในฐานะ ${
                selected.type === 'role'
                  ? ROLE_LABELS[selected.value].th
                  : selected.value.name
              }`
            : 'เลือกกลุ่มก่อนกดยืนยัน'}
        </button>
        <button type="button" onClick={handleLogout} className={styles.btnLogout}>
          ออกจากระบบ
        </button>
      </div>

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
    </div>
  );
}
