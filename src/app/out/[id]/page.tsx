'use client';
import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ToastContainer, useToast } from '@/components/Toast';
import styles from './pick.module.css';

export const dynamic = 'force-dynamic';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((res) => res.json());

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

type Item = {
  id: string;
  code: string;
  name: string;
  category: string;
  stock: number;
};

type PickStatus = 'PICKED' | 'OUT_OF_STOCK' | null;

export default function PickPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toasts, add: addToast, remove: removeToast } = useToast();

  const { data: requisitions, mutate: mutateReqs } = useSWR<Requisition[]>(
    '/api/requisitions',
    fetcher,
    { refreshInterval: 0 },
  );
  const { data: itemsList } = useSWR<Item[]>('/api/items', fetcher, { refreshInterval: 0 });

  const requisition = useMemo(
    () => requisitions?.find((r) => r.id === id),
    [requisitions, id],
  );

  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    (itemsList ?? []).forEach((it) => m.set(it.code, it.stock));
    return m;
  }, [itemsList]);

  // pickStates keyed by index — same code may appear multiple times
  const [pickStates, setPickStates] = useState<Record<number, PickStatus>>({});
  const [submitting, setSubmitting] = useState(false);

  const setStatus = (idx: number, status: PickStatus) => {
    setPickStates((prev) => {
      if (prev[idx] === status) {
        const next = { ...prev };
        delete next[idx];
        return next;
      }
      return { ...prev, [idx]: status };
    });
  };

  const reviewed = useMemo(() => {
    if (!requisition) return 0;
    return requisition.items.filter((_, i) => pickStates[i] != null).length;
  }, [requisition, pickStates]);

  const total = requisition?.items.length ?? 0;
  const allReviewed = total > 0 && reviewed === total;

  const handlePrint = (which: 'pick' | 'cover') => {
    const cls = `printing-${which}`;
    document.body.classList.remove('printing-pick', 'printing-cover');
    document.body.classList.add(cls);
    // Browsers run the print dialog synchronously; remove the class once it returns.
    setTimeout(() => {
      window.print();
      document.body.classList.remove(cls);
    }, 50);
  };

  const handleConfirm = async () => {
    if (!requisition || !allReviewed) return;
    const pickedCount = Object.values(pickStates).filter((s) => s === 'PICKED').length;
    const outCount = total - pickedCount;
    const msg = outCount
      ? `ยืนยัน — จะตัดสต็อก ${pickedCount} รายการ และทำเครื่องหมาย "พัสดุหมด" อีก ${outCount} รายการ`
      : `ยืนยันตัดสต็อกทั้งหมด ${pickedCount} รายการ?`;
    if (!confirm(msg)) return;

    setSubmitting(true);
    try {
      const itemStatuses = requisition.items.map(
        (_, i) => (pickStates[i] === 'PICKED' ? 'PICKED' : 'OUT_OF_STOCK'),
      );
      const res = await fetch(`/api/requisitions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CONFIRM_PICK', itemStatuses }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(`✓ ยืนยันใบเบิก ${id} แล้ว — แจ้งเตือนผู้เบิกแล้ว`, 'success');
        mutateReqs();
        setTimeout(() => router.push('/out'), 800);
      } else {
        addToast(data.error || 'ดำเนินการไม่สำเร็จ', 'error');
        setSubmitting(false);
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!confirm(`ยืนยันยกเลิกใบเบิก ${id}?`)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/requisitions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REJECT' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(`ยกเลิกใบเบิก ${id} แล้ว`, 'info');
        setTimeout(() => router.push('/out'), 600);
      } else {
        addToast(data.error || 'ดำเนินการไม่สำเร็จ', 'error');
        setSubmitting(false);
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
      setSubmitting(false);
    }
  };

  if (!requisitions) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>กำลังโหลด...</div>
      </div>
    );
  }

  if (!requisition) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          ไม่พบใบเบิก <strong>{id}</strong> — อาจถูกประมวลผลไปแล้ว
        </div>
        <Link href="/out" className={styles.backLink}>
          ← กลับรายการ
        </Link>
      </div>
    );
  }

  if (requisition.status !== 'PENDING') {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          ใบเบิก <strong>{id}</strong> ถูกประมวลผลไปแล้ว (สถานะ: {requisition.status})
        </div>
        <Link href="/out" className={styles.backLink}>
          ← กลับรายการ
        </Link>
      </div>
    );
  }

  const dateText = requisition.date ? new Date(requisition.date).toLocaleString('th-TH') : '-';

  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} remove={removeToast} />
<div className={`${styles.headerBar} no-print`}>
        <div>
          <Link href="/out" className={styles.backLink}>
            ← กลับรายการ
          </Link>
          <h1>
            📦 <span>จัดของ</span>
          </h1>
          <p>รีวิวสถานะของแต่ละรายการก่อนกดยืนยันตัดสต็อก</p>
        </div>
        <span className={styles.reqIdPill}>{requisition.id}</span>
      </div>

      <section className={`${styles.infoCard} no-print`}>
        <div className={styles.infoGrid}>
          <div className={styles.infoField}>
            <label>ผู้เบิก</label>
            <div className={styles.value}>{requisition.recorder || '-'}</div>
          </div>
          <div className={styles.infoField}>
            <label>แผนก</label>
            <div className={styles.value}>{requisition.department || '-'}</div>
          </div>
          <div className={styles.infoField}>
            <label>วัตถุประสงค์</label>
            <div className={styles.value}>{requisition.purpose || '-'}</div>
          </div>
          <div className={styles.infoField}>
            <label>วันที่</label>
            <div className={styles.value}>{dateText}</div>
          </div>
        </div>
      </section>

      <div className={`${styles.printRow} no-print`}>
        <button
          type="button"
          className={styles.btnPrint}
          onClick={() => handlePrint('pick')}
        >
          🖨 พิมพ์รายการจัดของ
        </button>
        <button
          type="button"
          className={`${styles.btnPrint} ${styles.btnPrintAlt}`}
          onClick={() => handlePrint('cover')}
        >
          🏷 พิมพ์ใบปะหน้า
        </button>
      </div>

      <section className={`${styles.itemsCard} no-print`}>
        <h2 className={styles.sectionTitle}>
          🛒 รายการที่ต้องจัด ({total})
        </h2>

        <div className={styles.progressBar}>
          <span>
            รีวิวแล้ว <strong>{reviewed}</strong> / {total} รายการ
          </span>
          <div className={styles.progressFill}>
            <div
              className={styles.progressInner}
              style={{ width: total ? `${(reviewed / total) * 100}%` : '0%' }}
            />
          </div>
        </div>

        {requisition.items.map((it, idx) => {
          const status = pickStates[idx];
          const stock = stockMap.get(it.code);
          const stockLow = stock != null && stock < it.quantity;
          const rowClass =
            status === 'PICKED'
              ? `${styles.itemRow} ${styles.statusPicked}`
              : status === 'OUT_OF_STOCK'
              ? `${styles.itemRow} ${styles.statusOut}`
              : styles.itemRow;
          return (
            <div key={idx} className={rowClass}>
              <div className={styles.itemMain}>
                <div>
                  <span className={styles.itemCode}>{it.code}</span>
                  <span className={styles.itemName}>{it.name}</span>
                </div>
                <div className={styles.itemSub}>
                  <span className={styles.itemQty}>ต้องการ {it.quantity}</span>
                  <span className={stockLow ? styles.itemStockLow : styles.itemStock}>
                    คงเหลือในระบบ {stock != null ? stock : '-'}
                  </span>
                </div>
              </div>
              <div className={styles.itemActions}>
                <button
                  type="button"
                  className={`${styles.btnPick} ${status === 'PICKED' ? styles.active : ''}`}
                  onClick={() => setStatus(idx, 'PICKED')}
                >
                  ✓ จัดแล้ว
                </button>
                <button
                  type="button"
                  className={`${styles.btnOut} ${status === 'OUT_OF_STOCK' ? styles.active : ''}`}
                  onClick={() => setStatus(idx, 'OUT_OF_STOCK')}
                >
                  ⚠ พัสดุหมด
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <div className={`${styles.confirmBar} no-print`}>
        <button
          type="button"
          className={styles.btnReject}
          disabled={submitting}
          onClick={handleReject}
        >
          ยกเลิกใบเบิก
        </button>
        <button
          type="button"
          className={styles.btnConfirm}
          disabled={!allReviewed || submitting}
          onClick={handleConfirm}
        >
          {submitting
            ? '⏳ กำลังตัดสต็อก...'
            : allReviewed
            ? '✓ ยืนยันรายการทั้งหมดเพื่อตัดสต็อก'
            : `รีวิวให้ครบก่อน (${reviewed}/${total})`}
        </button>
      </div>

      {/* ─── Print: Pick List ─── */}
      <section className={`${styles.printSheet} ${styles.pickSheet}`}>
        <div className={styles.printHeader}>
          <h2>รายการจัดของ — ใบเบิก {requisition.id}</h2>
          <p>บริษัท ไพโอเนียร์ เอ็นจิเนียริ่ง อินเตอร์เนชั่นแนล จำกัด</p>
        </div>
        <div className={styles.printMeta}>
          <div>
            <strong>ผู้เบิก:</strong> {requisition.recorder || '-'}
          </div>
          <div>
            <strong>แผนก:</strong> {requisition.department || '-'}
          </div>
          <div>
            <strong>วัตถุประสงค์:</strong> {requisition.purpose || '-'}
          </div>
          <div>
            <strong>วันที่:</strong> {dateText}
          </div>
        </div>
        <table className={styles.printTable}>
          <thead>
            <tr>
              <th className={styles.printCheckbox}>✓</th>
              <th style={{ width: '40px' }}>#</th>
              <th>รหัส</th>
              <th>ชื่อรายการ</th>
              <th style={{ width: '90px', textAlign: 'right' }}>จำนวน</th>
              <th style={{ width: '110px' }}>คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            {requisition.items.map((it, i) => (
              <tr key={i}>
                <td className={styles.printCheckbox}>☐</td>
                <td>{i + 1}</td>
                <td>{it.code}</td>
                <td>{it.name}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{it.quantity}</td>
                <td>{stockMap.get(it.code) ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.printSignBlock}>
          <div>
            <div className={styles.printSignLine}>ลายเซ็นเจ้าหน้าที่คลัง / วันที่</div>
          </div>
          <div>
            <div className={styles.printSignLine}>ลายเซ็นผู้รับ / วันที่</div>
          </div>
        </div>
      </section>

      {/* ─── Print: Cover Sheet ─── */}
      <section className={`${styles.printSheet} ${styles.coverSheet}`}>
        <div className={styles.printHeader}>
          <h2>ใบปะหน้ากล่องพัสดุ</h2>
          <p>ใบเบิก {requisition.id}</p>
        </div>
        <div className={styles.printCoverBig}>{requisition.recorder || '-'}</div>
        <div className={styles.printMeta}>
          <div>
            <strong>แผนก:</strong> {requisition.department || '-'}
          </div>
          <div>
            <strong>ชื่องาน / วัตถุประสงค์:</strong> {requisition.purpose || '-'}
          </div>
        </div>
        <table className={styles.printTable}>
          <thead>
            <tr>
              <th style={{ width: '40px' }}>#</th>
              <th>รหัส</th>
              <th>ชื่อรายการ</th>
              <th style={{ width: '90px', textAlign: 'right' }}>จำนวน</th>
            </tr>
          </thead>
          <tbody>
            {requisition.items.map((it, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{it.code}</td>
                <td>{it.name}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{it.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
