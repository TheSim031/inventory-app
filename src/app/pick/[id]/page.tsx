'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ToastContainer, useToast } from '@/components/Toast';
import {
  broadcastAuthChanged,
  fetchJson,
  isAuthStatus,
  readErrorMessage,
  type ApiError,
} from '@/lib/authClient';
import { formatThaiDateTime } from '@/lib/dateTime';
import styles from '../pick.module.css';

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
  lineUserId: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED';
  picker: string;
  completedAt: string;
};

export default function PickDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const encodedId = encodeURIComponent(id);
  const { data, error, isLoading } = useSWR<Requisition>(
    `/api/requisitions/${encodedId}`,
    fetcher,
  );
  const { toasts, add: addToast, remove: removeToast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleAction = async (action: 'CONFIRM' | 'REJECT') => {
    if (!data || busy) return;
    const label = action === 'CONFIRM' ? 'ยืนยันจัดของและตัดสต็อก' : 'ปฏิเสธใบเบิก';
    if (!confirm(`${label}?\n\nรหัส: ${data.id}`)) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/requisitions/${encodedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isAuthStatus(res.status)) broadcastAuthChanged('denied');
        addToast(
          (body as { error?: string }).error ||
            (await readErrorMessage(res, 'ดำเนินการไม่สำเร็จ')),
          'error',
        );
        setBusy(false);
        return;
      }
      addToast(
        action === 'CONFIRM' ? '✅ จัดของและบันทึกเบิกเรียบร้อย' : 'ปฏิเสธใบเบิกแล้ว',
        action === 'CONFIRM' ? 'success' : 'info',
      );
      router.push('/pick');
      router.refresh();
    } catch (err) {
      console.error(err);
      addToast('เกิดข้อผิดพลาด', 'error');
    }
    setBusy(false);
  };

  if (isAuthStatus((error as ApiError | undefined)?.status)) {
    return (
      <div className={styles.container}>
        <p className={styles.empty}>Session หมดอายุหรือสิทธิ์เปลี่ยนไป</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className={styles.container}>
        <Link href="/pick" className={styles.backLink}>
          ← รายการรอจัด
        </Link>
        <p className={styles.empty}>{error ? 'ไม่พบใบเบิก' : 'กำลังโหลด...'}</p>
      </div>
    );
  }

  if (data.status !== 'PENDING') {
    return (
      <div className={styles.container}>
        <Link href="/pick" className={styles.backLink}>
          ← รายการรอจัด
        </Link>
        <p className={styles.empty}>ใบเบิกนี้ถูกดำเนินการแล้ว ({data.status})</p>
      </div>
    );
  }

  const totalQty = data.items.reduce((s, it) => s + it.quantity, 0);

  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} remove={removeToast} />

      <div className={`${styles.noPrint}`}>
        <Link href="/pick" className={styles.backLink}>
          ← รายการรอจัด
        </Link>
        <header className={styles.header}>
          <h1>
            📋 <span>จัดของ</span>
          </h1>
          <p>{data.id}</p>
        </header>

        <section className={styles.card}>
          <div className={styles.metaGrid}>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>วันที่ขอ</span>
              <span className={styles.metaValue}>{formatThaiDateTime(data.requestedAt)}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>ผู้ขอ</span>
              <span className={styles.metaValue}>{data.requester}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>แผนก</span>
              <span className={styles.metaValue}>{data.department}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>วัตถุประสงค์</span>
              <span className={styles.metaValue}>{data.purpose}</span>
            </div>
          </div>

          <table className={styles.itemsTable}>
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th>จำนวน</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={it.code}>
                  <td>{it.code}</td>
                  <td>{it.name}</td>
                  <td>{it.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnConfirm}
              disabled={busy}
              onClick={() => handleAction('CONFIRM')}
            >
              {busy ? 'กำลังบันทึก...' : '✅ ยืนยันจัดของ'}
            </button>
            <button
              type="button"
              className={styles.btnReject}
              disabled={busy}
              onClick={() => handleAction('REJECT')}
            >
              ปฏิเสธ
            </button>
            <button type="button" className={styles.btnPrint} onClick={() => window.print()}>
              🖨 พิมพ์ใบหยิบ
            </button>
          </div>
        </section>
      </div>

      <div className={styles.printSheet}>
        <h1>ใบหยิบของ — {data.id}</h1>
        <p>
          <strong>ผู้ขอ:</strong> {data.requester} | <strong>แผนก:</strong> {data.department}
        </p>
        <p>
          <strong>วัตถุประสงค์:</strong> {data.purpose}
        </p>
        <p>
          <strong>วันที่:</strong> {formatThaiDateTime(data.requestedAt)} |{' '}
          <strong>รวม:</strong> {data.items.length} รายการ / {totalQty} ชิ้น
        </p>
        <table>
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อ</th>
              <th>จำนวน</th>
              <th>✓</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.code}>
                <td>{it.code}</td>
                <td>{it.name}</td>
                <td>{it.quantity}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
