'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

export const dynamic = 'force-dynamic';

function ForbiddenInner() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get('from') || '';

  const handleLogout = async () => {
    if (!confirm('ออกจากระบบ?')) return;
    await Promise.all([
      fetch('/api/auth/logout', { method: 'POST' }),
      fetch('/api/auth/line/logout', { method: 'POST' }),
      fetch('/api/auth/creator', { method: 'DELETE' }),
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
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.25rem',
        background:
          'radial-gradient(ellipse at top, rgba(220,38,38,0.10), transparent 60%), linear-gradient(135deg,#fff 0%,#f5f5f5 100%)',
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
        <div style={{ fontSize: '4rem', marginBottom: '0.5rem', lineHeight: 1 }}>
          🚫
        </div>
        <div
          style={{
            color: '#DC2626',
            fontWeight: 800,
            fontSize: '0.8rem',
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            marginBottom: '0.5rem',
          }}
        >
          403 · Forbidden
        </div>
        <h1
          style={{
            fontSize: '1.5rem',
            fontWeight: 800,
            color: '#0a0a0a',
            marginBottom: '0.5rem',
          }}
        >
          ไม่มีสิทธิ์เข้าถึงหน้านี้
        </h1>
        <p style={{ color: '#4B5563', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          กลุ่มผู้ใช้ของคุณไม่ได้รับอนุญาตให้เข้าหน้านี้
          {from && (
            <>
              <br />
              <code
                style={{
                  fontSize: '0.8rem',
                  background: '#f3f4f6',
                  padding: '0.15rem 0.4rem',
                  borderRadius: '0.25rem',
                  color: '#0a0a0a',
                }}
              >
                {from}
              </code>
            </>
          )}
          <br />
          หากต้องการสิทธิ์เพิ่มเติม กรุณาติดต่อผู้ดูแลระบบ
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
            🏠 กลับหน้าหลัก
          </Link>
          <Link
            href="/role-select"
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
              textDecoration: 'none',
            }}
          >
            🔄 เปลี่ยนกลุ่มผู้ใช้
          </Link>
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

export default function ForbiddenPage() {
  return (
    <Suspense fallback={null}>
      <ForbiddenInner />
    </Suspense>
  );
}
