import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { decodeLineSession, getLineLoginConfig } from '@/lib/lineAuth';
import { isUserRole, ROLE_COOKIE, ROLE_HOME } from '@/lib/userRole';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

/**
 * Landing page = login screen. Redirects you onward if you're already
 * signed in:
 *   - signed in + has a role  → straight to that role's home
 *   - signed in + no role     → /role-select
 *   - not signed in           → show the login choices
 */
export default async function Home() {
  const store = await cookies();
  const lineUser = decodeLineSession(store.get('line_user')?.value);
  const adminAuth = store.get('auth_session')?.value === 'authenticated';
  const authed = !!lineUser || adminAuth;

  if (authed) {
    const rawRole = store.get(ROLE_COOKIE)?.value;
    if (isUserRole(rawRole)) {
      redirect(ROLE_HOME[rawRole]);
    }
    redirect('/role-select');
  }

  // Read LINE config presence so we know whether to show the LINE button.
  // We don't pass a request here, but the env-based fallback is enough to
  // decide "is LINE configured at all?".
  const lineLoginEnabled = !!getLineLoginConfig();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>
          PIONEER <span>STOCK</span>
        </h1>
        <p>Inventory · Requisition · Pick & Pack</p>
      </header>

      <div className={styles.loginCard}>
        <div className={styles.loginIcon}>🔐</div>
        <h2>เข้าสู่ระบบ</h2>
        <p className={styles.loginSub}>
          เลือกวิธีเข้าสู่ระบบเพื่อเริ่มต้นใช้งาน
        </p>

        {lineLoginEnabled ? (
          <a
            href={`/api/auth/line?next=${encodeURIComponent('/role-select')}`}
            className={styles.btnLineLogin}
          >
            🟢 เข้าสู่ระบบด้วย LINE
          </a>
        ) : (
          <div className={styles.disabledNote}>
            LINE Login ยังไม่ได้ตั้งค่า — ใช้ปุ่ม Staff login ด้านล่าง
          </div>
        )}

        <div className={styles.divider}>
          <span>หรือ</span>
        </div>

        <Link href="/login" className={styles.btnStaff}>
          🛠 Staff Login (ผู้ดูแลระบบ)
        </Link>
      </div>
    </div>
  );
}
