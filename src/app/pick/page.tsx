'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { fetchJson, isAuthStatus, type ApiError } from '@/lib/authClient';
import { formatThaiDateTime } from '@/lib/dateTime';
import styles from './pick.module.css';

export const dynamic = 'force-dynamic';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

type RequisitionItem = { code: string; name: string; quantity: number };

type Requisition = {
  id: string;
  requestedAt: string;
  requester: string;
  department: string;
  purpose: string;
  items: RequisitionItem[];
  status: 'PENDING' | 'COMPLETED' | 'REJECTED';
};

export default function PickListPage() {
  const { data, error, isLoading } = useSWR<Requisition[]>(
    '/api/requisitions?status=PENDING',
    fetcher,
    { refreshInterval: 10000 },
  );

  const pending = data ?? [];

  return (
    <div className={styles.container}>
      <Link href="/home" className={styles.backLink}>
        ← กลับเมนูหลัก
      </Link>
      <header className={styles.header}>
        <h1>
          📋 <span>จัดของ</span>
        </h1>
        <p>ใบเบิกที่รอคลังยืนยันและตัดสต็อก</p>
      </header>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>
          รอจัดของ
          <span className={styles.countPill}>{pending.length}</span>
        </h2>

        {isAuthStatus((error as ApiError | undefined)?.status) ? (
          <p className={styles.empty}>Session หมดอายุหรือสิทธิ์เปลี่ยนไป กรุณาเข้าสู่ระบบใหม่</p>
        ) : isLoading ? (
          <p className={styles.empty}>กำลังโหลด...</p>
        ) : pending.length === 0 ? (
          <p className={styles.empty}>ไม่มีใบเบิกรอจัดของในขณะนี้ 🎉</p>
        ) : (
          <div className={styles.list}>
            {pending.map((row) => (
              <Link key={row.id} href={`/pick/${encodeURIComponent(row.id)}`} className={styles.row}>
                <div className={styles.rowHead}>
                  <span className={styles.reqId}>{row.id}</span>
                  <span className={styles.rowDate}>{formatThaiDateTime(row.requestedAt)}</span>
                </div>
                <div className={styles.requester}>{row.requester}</div>
                <div className={styles.meta}>
                  {row.department} — {row.purpose}
                </div>
                <div className={styles.itemCount}>{row.items.length} รายการ</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
