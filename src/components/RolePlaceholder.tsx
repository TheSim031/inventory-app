'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ROLE_LABELS, type UserRole } from '@/lib/userRole';

/**
 * Stub UI for role homes that haven't been built out yet. Phase 5 just
 * persists the role and lands the user here so they know the routing
 * works end-to-end — the actual workflow for each role is a follow-up.
 */
export function RolePlaceholder({ role }: { role: UserRole }) {
  const router = useRouter();
  const info = ROLE_LABELS[role];

  const handleChangeRole = () => {
    router.push('/role-select');
  };

  const handleLogout = async () => {
    if (!confirm('ออกจากระบบ?')) return;
    await Promise.all([
      fetch('/api/auth/line/logout', { method: 'POST' }),
      fetch('/api/auth/logout', { method: 'POST' }),
      fetch('/api/auth/role', { method: 'DELETE' }),
    ]);
    router.push('/');
    router.refresh();
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.25rem',
        background:
          'radial-gradient(ellipse at top, rgba(220,38,38,0.07), transparent 60%), linear-gradient(135deg,#fff 0%,#f5f5f5 100%)',
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: '100%',
          background: '#fff',
          border: '2px solid #0a0a0a',
          borderTop: '6px solid #DC2626',
          borderRadius: '1rem',
          padding: '2.5rem 2rem',
          textAlign: 'center',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ fontSize: '4rem', marginBottom: '0.75rem', lineHeight: 1 }}>
          {info.icon}
        </div>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 800,
            color: '#0a0a0a',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: '0.3rem',
          }}
        >
          {info.th}
        </h1>
        <div
          style={{
            color: '#DC2626',
            fontWeight: 700,
            fontSize: '0.75rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            marginBottom: '1.25rem',
          }}
        >
          {info.en}
        </div>
        <p
          style={{
            color: '#4B5563',
            lineHeight: 1.6,
            marginBottom: '1.5rem',
          }}
        >
          คุณเข้าสู่ระบบในฐานะ <strong>{info.th}</strong> เรียบร้อยแล้ว
          <br />
          ฟีเจอร์เฉพาะของกลุ่มนี้กำลังพัฒนาอยู่ — เปิดให้ใช้งานเร็วๆ นี้
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'column' }}>
          <Link
            href="/"
            style={{
              padding: '0.85rem 1.25rem',
              background: '#0a0a0a',
              color: '#fff',
              borderRadius: '0.5rem',
              fontWeight: 700,
              fontSize: '0.9rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            🏠 หน้าหลัก
          </Link>
          <button
            type="button"
            onClick={handleChangeRole}
            style={{
              padding: '0.75rem 1.25rem',
              background: 'transparent',
              color: '#0a0a0a',
              border: '2px solid #0a0a0a',
              borderRadius: '0.5rem',
              fontWeight: 700,
              fontSize: '0.85rem',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            🔄 เปลี่ยนกลุ่มผู้ใช้
          </button>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: '0.5rem',
              background: 'transparent',
              color: '#6B7280',
              border: 'none',
              fontSize: '0.8rem',
              cursor: 'pointer',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </div>
  );
}
