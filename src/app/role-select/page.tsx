'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { USER_ROLES, ROLE_LABELS, type UserRole } from '@/lib/userRole';
import styles from './role-select.module.css';

export const dynamic = 'force-dynamic';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((res) => res.json());

type MeResponse = {
  user: { userId: string; displayName: string; pictureUrl?: string } | null;
  adminAuth: boolean;
  isAuthenticated: boolean;
  role: UserRole | null;
  lineLoginEnabled: boolean;
  oaBasicId: string;
};

export default function RoleSelectPage() {
  const router = useRouter();
  const { data: me, isLoading } = useSWR<MeResponse>('/api/auth/me', fetcher);

  const [selected, setSelected] = useState<UserRole | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anyone hitting /role-select without a session should bounce back to /
  useEffect(() => {
    if (me && !me.isAuthenticated) {
      router.replace('/');
    }
  }, [me, router]);

  // Pre-select whatever role the cookie currently has, so users get a
  // visual reminder of their previous choice when revisiting.
  useEffect(() => {
    if (me?.role && !selected) setSelected(me.role);
  }, [me?.role, selected]);

  const handleConfirm = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selected }),
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

  const handleLogout = async () => {
    if (!confirm('ออกจากระบบ?')) return;
    // Clear both kinds of session + the role, then send the user home.
    await Promise.all([
      fetch('/api/auth/line/logout', { method: 'POST' }),
      fetch('/api/auth/logout', { method: 'POST' }),
      fetch('/api/auth/role', { method: 'DELETE' }),
    ]);
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
          const active = selected === role;
          return (
            <button
              key={role}
              type="button"
              onClick={() => setSelected(role)}
              className={`${styles.roleCard} ${active ? styles.roleCardActive : ''}`}
            >
              <div className={styles.roleIcon}>{info.icon}</div>
              <div className={styles.roleTh}>{info.th}</div>
              <div className={styles.roleEn}>{info.en}</div>
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
            ? `✓ ยืนยันเข้าใช้งานในฐานะ ${ROLE_LABELS[selected].th}`
            : 'เลือกกลุ่มก่อนกดยืนยัน'}
        </button>
        <button type="button" onClick={handleLogout} className={styles.btnLogout}>
          ออกจากระบบ
        </button>
      </div>
    </div>
  );
}
