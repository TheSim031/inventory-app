'use client';
import useSWR from 'swr';
import Link from 'next/link';
import { fetchJson, isAuthStatus, type ApiError } from '@/lib/authClient';
import { formatThaiDateTime } from '@/lib/dateTime';
import type { DashboardResponse } from '@/app/api/dashboard/route';
import styles from './dashboard.module.css';

export const dynamic = 'force-dynamic';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

export default function DashboardPage() {
  const { data, error, isLoading } = useSWR<DashboardResponse>(
    '/api/dashboard',
    fetcher,
    { refreshInterval: 30000 },
  );

  const apiStatus = (error as ApiError | undefined)?.status;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>
          📊 <span>แดชบอร์ด</span>
        </h1>
        <p>
          ภาพรวมคลังสินค้าแบบเรียลไทม์ — สต็อกต่ำ งานค้าง และความเคลื่อนไหวล่าสุด
        </p>
      </header>

      {isAuthStatus(apiStatus) ? (
        <div className={styles.warn}>
          🔒 Session หมดอายุหรือไม่มีสิทธิ์ — โปรดเข้าสู่ระบบใหม่
        </div>
      ) : error ? (
        <div className={styles.warn}>❌ โหลดข้อมูลไม่สำเร็จ — ลองรีเฟรชอีกครั้ง</div>
      ) : isLoading || !data ? (
        <div className={styles.empty}>⏳ กำลังโหลดข้อมูล...</div>
      ) : (
        <>
          {/* ── Key stat cards ── */}
          <section className={styles.statGrid}>
            <StatCard
              tone="dark"
              label="รายการสินค้าทั้งหมด"
              value={data.stock.total}
              sub="ดึงจากสต็อกสินค้า"
            />
            <StatCard
              tone="danger"
              label="หมดคลัง (0 ชิ้น)"
              value={data.stock.zero}
              sub="ควรสั่งซื้อด่วน"
              href="/limit-stock"
            />
            <StatCard
              tone="warn"
              label="ต่ำกว่าเกณฑ์"
              value={data.stock.low}
              sub="เฝ้าระวัง"
              href="/limit-stock"
            />
            <StatCard
              tone="primary"
              label="ใบเบิกรอจัด"
              value={data.pending.requisitions}
              sub="คิวจัดของ"
              href="/out"
            />
            <StatCard
              tone="primary"
              label="รอตรวจสอบ (QC)"
              value={data.pending.inspections}
              sub="คิวตรวจรับเข้า"
              href="/inspect"
            />
          </section>

          {/* ── Movement summary ── */}
          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>📈 ความเคลื่อนไหว</h2>
            <div className={styles.movementGrid}>
              <MovementBlock title="7 วันล่าสุด" bucket={data.movement.last7} />
              <MovementBlock title="30 วันล่าสุด" bucket={data.movement.last30} />
            </div>
          </section>

          <div className={styles.twoCol}>
            {/* ── Top withdrawn items ── */}
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>🔥 เบิกออกมากสุด (30 วัน)</h2>
              {data.topOut.length === 0 ? (
                <p className={styles.empty}>ยังไม่มีการเบิกออกใน 30 วัน</p>
              ) : (
                <ol className={styles.topList}>
                  {data.topOut.map((it, i) => (
                    <li key={it.code} className={styles.topRow}>
                      <span className={styles.rank}>{i + 1}</span>
                      <span className={styles.topName}>
                        <code>{it.code}</code> {it.name}
                      </span>
                      <span className={styles.topQty}>
                        {it.qty.toLocaleString('th-TH')}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* ── Recent activity ── */}
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>🕒 ความเคลื่อนไหวล่าสุด</h2>
              {data.recent.length === 0 ? (
                <p className={styles.empty}>ยังไม่มีรายการเข้า-ออก</p>
              ) : (
                <ul className={styles.recentList}>
                  {data.recent.map((r, i) => (
                    <li key={i} className={styles.recentRow}>
                      <span
                        className={`${styles.typeTag} ${
                          r.type === 'IN' ? styles.tagIn : styles.tagOut
                        }`}
                      >
                        {r.type === 'IN' ? '📥 รับเข้า' : '📤 เบิกออก'}
                      </span>
                      <span className={styles.recentName}>
                        <code>{r.code}</code> {r.name}
                        <span className={styles.recentQty}>×{r.quantity}</span>
                      </span>
                      <span className={styles.recentMeta}>
                        {r.recorder || '-'}
                        {r.date ? ` · ${formatThaiDateTime(r.date)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <p className={styles.footnote}>
            อัปเดตล่าสุด: {formatThaiDateTime(data.generatedAt)} · รีเฟรชอัตโนมัติทุก 30 วินาที
          </p>
        </>
      )}
    </div>
  );
}

function StatCard({
  tone,
  label,
  value,
  sub,
  href,
}: {
  tone: 'dark' | 'danger' | 'warn' | 'primary';
  label: string;
  value: number;
  sub: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value.toLocaleString('th-TH')}</span>
      <span className={styles.statSub}>{sub}</span>
    </>
  );
  const className = `${styles.statCard} ${styles[tone]}`;
  return href ? (
    <Link href={href} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function MovementBlock({
  title,
  bucket,
}: {
  title: string;
  bucket: DashboardResponse['movement']['last7'];
}) {
  return (
    <div className={styles.movementBlock}>
      <div className={styles.movementTitle}>{title}</div>
      <div className={styles.movementRow}>
        <div className={styles.movementIn}>
          <span className={styles.movementHead}>📥 รับเข้า</span>
          <span className={styles.movementBig}>
            {bucket.inCount.toLocaleString('th-TH')}
          </span>
          <span className={styles.movementSub}>
            {bucket.inQty.toLocaleString('th-TH')} ชิ้น
          </span>
        </div>
        <div className={styles.movementOut}>
          <span className={styles.movementHead}>📤 เบิกออก</span>
          <span className={styles.movementBig}>
            {bucket.outCount.toLocaleString('th-TH')}
          </span>
          <span className={styles.movementSub}>
            {bucket.outQty.toLocaleString('th-TH')} ชิ้น
          </span>
        </div>
      </div>
    </div>
  );
}
