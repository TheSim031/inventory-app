import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { decodeLineSession, getLineLoginConfig } from '@/lib/lineAuth';
import { isUserRole, ROLE_COOKIE, ROLE_HOME } from '@/lib/userRole';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

type HomeSearchParams = Promise<{ next?: string | string[] }>;

/**
 * Landing page = login screen. Redirects you onward if you're already
 * signed in:
 *   - signed in + has a role  → straight to that role's home
 *   - signed in + no role     → /role-select
 *   - not signed in           → show the login choices
 *
 * When the proxy bounces an unauthenticated user here with `?next=<path>`,
 * we forward that path into the LINE Login button so the OAuth callback
 * brings them back to the page they originally tried to open.
 */
export default async function Home({
  searchParams,
}: {
  searchParams?: HomeSearchParams;
}) {
  const store = await cookies();
  const lineUser = decodeLineSession(store.get('line_user')?.value);
  const adminAuth = store.get('auth_session')?.value === 'authenticated';
  const authed = !!lineUser || adminAuth;

  if (authed) {
    const rawRole = store.get(ROLE_COOKIE)?.value;
    if (isUserRole(rawRole)) {
      redirect(ROLE_HOME[rawRole]); // unified /home for all roles
    }
    // No bound role yet → first-time onboarding screen. The /role-select
    // server guard will redirect back here if the sheet already has a
    // bound role for this LINE userId.
    redirect('/role-select');
  }

  // Forward the proxy's `?next=` (deep-link destination) into the OAuth
  // start URL — only when it looks like a same-site path, to avoid open
  // redirects.
  const resolvedParams = (await searchParams) ?? {};
  const rawNext = resolvedParams.next;
  const candidate = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  const safeNext =
    typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//')
      ? candidate
      : '/role-select';

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
        <p>Inventory · Requisition · QC</p>
      </header>

      <div className={styles.loginCard}>
        <div className={styles.loginIcon}>🔐</div>
        <h2>เข้าสู่ระบบ</h2>
        <p className={styles.loginSub}>
          เลือกวิธีเข้าสู่ระบบเพื่อเริ่มต้นใช้งาน
        </p>

        {lineLoginEnabled ? (
          <a
            href={`/api/auth/line?next=${encodeURIComponent(safeNext)}`}
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
