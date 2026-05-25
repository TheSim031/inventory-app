'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetchJson, isAuthStatus, type ApiError } from '@/lib/authClient';
import { formatThaiDateTime } from '@/lib/dateTime';
import styles from './out.module.css';

export const dynamic = 'force-dynamic';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

type RequisitionItem = { code: string; name: string; quantity: number };
type RequisitionStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';
type Requisition = {
  id: string;
  date: string;
  recorder: string;
  department?: string;
  purpose?: string;
  poPx?: string;
  status: RequisitionStatus;
  items: RequisitionItem[];
};

export default function OutPage() {
  const { data: requisitions, error } = useSWR<Requisition[]>('/api/requisitions', fetcher, {
    refreshInterval: 8000,
  });

  const pending = useMemo(
    () => (requisitions ?? []).filter((r) => r.status === 'PENDING'),
    [requisitions],
  );

  const loading = !requisitions;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>
          📤 <span>จัดของตามใบเบิก</span>
        </h1>
        <p>เลือกใบเบิกเพื่อรีวิวรายตัว — กดยืนยันท้ายสุดถึงจะตัดสต็อก</p>
      </header>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>
          📋 ใบเบิกรอจัด
          <span className={styles.countPill}>{pending.length}</span>
        </h2>

        {isAuthStatus((error as ApiError | undefined)?.status) ? (
          <p className={styles.empty}>Session หมดอายุหรือสิทธิ์เปลี่ยนไป กรุณาเข้าสู่ระบบใหม่</p>
        ) : loading ? (
          <p className={styles.empty}>กำลังโหลด...</p>
        ) : pending.length === 0 ? (
          <p className={styles.empty}>ไม่มีใบเบิกรอจัดในขณะนี้ 🎉</p>
        ) : (
          <div className={styles.list}>
            {pending.map((req) => (
              <Link
                key={req.id}
                href={`/out/${encodeURIComponent(req.id)}`}
                className={styles.row}
              >
                <div className={styles.info}>
                  <div className={styles.rowHeader}>
                    <span className={styles.reqId}>{req.id}</span>
                    <span className={styles.reqDate}>
                      {req.date ? formatThaiDateTime(req.date) : ''}
                    </span>
                  </div>
                  <div className={styles.meta}>
                    <strong>{req.recorder}</strong>
                    {req.department && <span> · {req.department}</span>}
                  </div>
                  {req.purpose && (
                    <div className={styles.purpose}>วัตถุประสงค์: {req.purpose}</div>
                  )}
                  <ul className={styles.items}>
                    {req.items.map((it, i) => (
                      <li key={i}>
                        <code>{it.code}</code> {it.name}
                        <span className={styles.qty}>×{it.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={styles.cta}>▶ เปิดเพื่อจัด</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
