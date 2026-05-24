'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/**
 * Tab strip shown at the top of warehouse pages (/in and /out).
 * The "active" pill is just the link whose href is the current pathname.
 */
export function WarehouseNav() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  };

  const tabs = [
    { href: '/in', label: '📥 รับของ (IN)' },
    { href: '/out', label: '📤 จัดของ (OUT)' },
  ];

  return (
    <nav
      className="no-print"
      style={{
        background: '#0A0A0A',
        borderRadius: '1rem',
        padding: '0.4rem',
        display: 'flex',
        gap: '0.4rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        alignItems: 'center',
        boxShadow: '0 6px 18px -8px rgba(0,0,0,0.45)',
      }}
    >
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              flex: '1 1 0',
              minWidth: '140px',
              textAlign: 'center',
              padding: '0.7rem 1rem',
              borderRadius: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              fontSize: '0.85rem',
              textDecoration: 'none',
              transition: 'background 0.15s, color 0.15s',
              background: active ? '#DC2626' : 'transparent',
              color: active ? '#fff' : '#cbd5e1',
            }}
          >
            {t.label}
          </Link>
        );
      })}
      <Link
        href="/"
        style={{
          padding: '0.7rem 1rem',
          borderRadius: '0.65rem',
          fontSize: '0.8rem',
          color: '#cbd5e1',
          textDecoration: 'none',
          letterSpacing: '0.05em',
        }}
      >
        ← หน้าหลัก
      </Link>
      <button
        type="button"
        onClick={handleLogout}
        style={{
          padding: '0.6rem 1rem',
          borderRadius: '0.65rem',
          fontSize: '0.8rem',
          color: '#fca5a5',
          background: 'transparent',
          border: '1px solid #4b5563',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        ออกจากระบบ
      </button>
    </nav>
  );
}
