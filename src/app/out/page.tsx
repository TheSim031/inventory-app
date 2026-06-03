'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetchJson, isAuthStatus, type ApiError } from '@/lib/authClient';
import { formatThaiDateTime } from '@/lib/dateTime';
import styles from './out.module.css';

export const dynamic = 'force-dynamic';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

type RequisitionItem = { code: string; name: string; quantity: number };

type Requisition = {
  id: string;
  requestedAt: string;
  requester: string;
  department: string;
  purpose: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED';
  items: RequisitionItem[];
};

export default function OutPage() {
  const { data: requisitions, error } = useSWR<Requisition[]>(
    '/api/requisitions?status=PENDING',
    fetcher,
    { refreshInterval: 8000 },
  );

  const [search, setSearch] = useState('');

  const allPending = useMemo(() => requisitions ?? [], [requisitions]);
  const loading = !requisitions && !error;

  // Filter by requisition id, requester, department, purpose, or any item
  // code/name so warehouse staff can find a slip fast in a long queue.
  const pending = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allPending;
    return allPending.filter((req) => {
      const haystack = [
        req.id,
        req.requester,
        req.department,
        req.purpose,
        ...req.items.flatMap((it) => [it.code, it.name]),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allPending, search]);

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

        {allPending.length > 0 && (
          <div className={styles.searchBar}>
            <input
              type="text"
              className={styles.searchInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 ค้นหา: เลขใบเบิก / ผู้เบิก / แผนก / รหัส-ชื่อสินค้า"
            />
            {search && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setSearch('')}
                aria-label="ล้างคำค้นหา"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {isAuthStatus((error as ApiError | undefined)?.status) ? (
          <p className={styles.empty}>Session หมดอายุหรือสิทธิ์เปลี่ยนไป กรุณาเข้าสู่ระบบใหม่</p>
        ) : loading ? (
          <p className={styles.empty}>กำลังโหลด...</p>
        ) : pending.length === 0 ? (
          <p className={styles.empty}>
            {search.trim()
              ? `ไม่พบใบเบิกที่ตรงกับ "${search.trim()}"`
              : 'ไม่มีใบเบิกรอจัดในขณะนี้ 🎉'}
          </p>
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
                      {req.requestedAt ? formatThaiDateTime(req.requestedAt) : ''}
                    </span>
                  </div>
                  <div className={styles.meta}>
                    <strong>{req.requester}</strong>
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
