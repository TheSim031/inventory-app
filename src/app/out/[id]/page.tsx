'use client';
import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ToastContainer, useToast } from '@/components/Toast';
import {
  broadcastAuthChanged,
  fetchJson,
  isAuthStatus,
  type ApiError,
} from '@/lib/authClient';
import { formatThaiDateTime } from '@/lib/dateTime';
import styles from './pick.module.css';

export const dynamic = 'force-dynamic';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

type RequisitionItem = { code: string; name: string; quantity: number };
type RequisitionStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';
type Requisition = {
  id: string;
  requestedAt: string;
  requester: string;
  department: string;
  purpose: string;
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

  const { data: requisition, error: requisitionsError, mutate: mutateReq } = useSWR<Requisition>(
    `/api/requisitions/${encodeURIComponent(id)}`,
    fetcher,
    { refreshInterval: 0 },
  );
  const { data: itemsList, error: itemsError } = useSWR<Item[]>('/api/items', fetcher, { refreshInterval: 0 });

  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    (itemsList ?? []).forEach((it) => m.set(it.code, it.stock));
    return m;
  }, [itemsList]);

  // pickStates keyed by index — same code may appear multiple times
  const [pickStates, setPickStates] = useState<Record<number, PickStatus>>({});
  // Editable picked quantities — keyed by index, defaults to requested quantity
  const [pickedQty, setPickedQty] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);

  // Reject modal — requires a reason that's sent to the requester via LINE
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

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

  const getPickedQty = (idx: number, requested: number): number => {
    const v = pickedQty[idx];
    return Number.isFinite(v) && v >= 0 ? v : requested;
  };

  const setPickedQtyAt = (idx: number, value: number) => {
    setPickedQty((prev) => ({ ...prev, [idx]: value }));
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
      // Send the warehouse-edited actual quantity for each line — the API
      // uses this to decide the OUT row amount and the LINE-notify payload.
      const pickedQuantities = requisition.items.map((it, i) =>
        getPickedQty(i, it.quantity),
      );
      const res = await fetch(`/api/requisitions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CONFIRM_PICK', itemStatuses, pickedQuantities }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(`✓ ยืนยันใบเบิก ${id} แล้ว — แจ้งเตือนผู้เบิกแล้ว`, 'success');
        mutateReq();
        setTimeout(() => router.push('/out'), 800);
      } else {
        if (isAuthStatus(res.status)) broadcastAuthChanged('denied');
        addToast(data.error || 'ดำเนินการไม่สำเร็จ', 'error');
        setSubmitting(false);
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
      setSubmitting(false);
    }
  };

  const openRejectModal = () => {
    setRejectReason('');
    setShowRejectModal(true);
  };

  const submitReject = async () => {
    const reason = rejectReason.trim();
    if (!reason) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/requisitions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REJECT', reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(`ยกเลิกใบเบิก ${id} แล้ว — แจ้งเหตุผลถึงผู้เบิกทาง LINE แล้ว`, 'info');
        setShowRejectModal(false);
        setTimeout(() => router.push('/out'), 800);
      } else {
        if (isAuthStatus(res.status)) broadcastAuthChanged('denied');
        addToast(data.error || 'ดำเนินการไม่สำเร็จ', 'error');
        setSubmitting(false);
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
      setSubmitting(false);
    }
  };

  const authError = (requisitionsError || itemsError) as ApiError | undefined;
  if (isAuthStatus(authError?.status)) {
    return (
      <div className={styles.container}>
        <ToastContainer toasts={toasts} remove={removeToast} />
        <div className={styles.errorState}>
          Session หมดอายุหรือสิทธิ์เปลี่ยนไป กรุณาเข้าสู่ระบบใหม่
        </div>
      </div>
    );
  }

  if (!requisition && !requisitionsError) {
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

  const dateText = formatThaiDateTime(requisition.requestedAt);

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
            <div className={styles.value}>{requisition.requester || '-'}</div>
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
          const currentQty = getPickedQty(idx, it.quantity);
          const stockLow = stock != null && stock < currentQty;
          const qtyMismatch = currentQty !== it.quantity;
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
                <div className={styles.pickedQtyRow}>
                  <label className={styles.pickedQtyLabel}>
                    จำนวนที่จัด:
                  </label>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className={`${styles.pickedQtyInput} ${qtyMismatch ? styles.pickedQtyEdited : ''}`}
                    value={currentQty}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') {
                        setPickedQtyAt(idx, 0);
                        return;
                      }
                      const n = parseInt(v, 10);
                      if (Number.isFinite(n) && n >= 0) setPickedQtyAt(idx, n);
                    }}
                    disabled={status === 'OUT_OF_STOCK'}
                    aria-label={`จำนวนที่จัดของ ${it.name}`}
                  />
                  {qtyMismatch && status !== 'OUT_OF_STOCK' && (
                    <span className={styles.pickedQtyHint}>
                      ✎ แก้แล้ว ({it.quantity} → {currentQty})
                    </span>
                  )}
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
          onClick={openRejectModal}
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
            <strong>ผู้เบิก:</strong> {requisition.requester || '-'}
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

      {/* ─── Print: Cover Sheet — 8 cells per A4 page, cut-and-paste tags ─── */}
      <section className={`${styles.printSheet} ${styles.coverSheet}`}>
        {chunk(requisition.items, 8).map((page, pageIdx) => (
          <div key={pageIdx} className={styles.coverPage}>
            <div className={styles.coverGrid}>
              {page.map((it, i) => {
                const globalIdx = pageIdx * 8 + i;
                return (
                  <div key={globalIdx} className={styles.coverCell}>
                    <div className={styles.coverCellHeader}>
                      <span>{requisition.id}</span>
                      <span>
                        #{globalIdx + 1}/{requisition.items.length}
                      </span>
                    </div>
                    <div className={styles.coverCellName}>
                      {requisition.requester || '-'}
                    </div>
                    <div className={styles.coverCellMeta}>
                      {requisition.department && <div>{requisition.department}</div>}
                      {requisition.purpose && (
                        <div className={styles.coverCellPurpose}>
                          {requisition.purpose}
                        </div>
                      )}
                    </div>
                    <div className={styles.coverCellItem}>
                      <div className={styles.coverCellCode}>{it.code}</div>
                      <div
                        className={styles.coverCellItemName}
                        style={{ fontSize: coverItemNameFontSize(it.name) }}
                      >
                        {it.name}
                      </div>
                      <div className={styles.coverCellQty}>× {it.quantity}</div>
                    </div>
                  </div>
                );
              })}
              {/* Fill the rest of the last grid with empty cells so the
                  layout stays a clean 2×4 even when items < 8 */}
              {page.length < 8 &&
                Array.from({ length: 8 - page.length }).map((_, i) => (
                  <div
                    key={`empty-${pageIdx}-${i}`}
                    className={`${styles.coverCell} ${styles.coverCellEmpty}`}
                  />
                ))}
            </div>
          </div>
        ))}
      </section>

      {/* ─── Reject modal — reason is mandatory and sent to requester ─── */}
      {showRejectModal && (
        <div
          className={`${styles.rejectModalBackdrop} no-print`}
          onClick={() => !submitting && setShowRejectModal(false)}
        >
          <div className={styles.rejectModal} onClick={(e) => e.stopPropagation()}>
            <h3>❌ ยกเลิกใบเบิก {requisition.id}</h3>
            <p className={styles.rejectModalSub}>
              ระบุเหตุผลที่ต้องยกเลิก — เหตุผลจะถูกส่งให้ผู้เบิกทาง LINE
            </p>
            <textarea
              className={styles.rejectModalTextarea}
              placeholder="เช่น สินค้าหมด · เบิกซ้ำ · ผู้เบิกขอยกเลิกเอง · ฯลฯ"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              autoFocus
              rows={4}
            />
            <div className={styles.rejectModalActions}>
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                disabled={submitting}
                className={styles.rejectModalCancel}
              >
                กลับ
              </button>
              <button
                type="button"
                onClick={submitReject}
                disabled={submitting || !rejectReason.trim()}
                className={styles.rejectModalConfirm}
              >
                {submitting
                  ? '⏳ กำลังยกเลิก...'
                  : '❌ ยืนยันยกเลิก + แจ้งผู้เบิก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function coverItemNameFontSize(name: string): string {
  const len = Array.from(name.trim()).length;
  if (len > 54) return '0.72rem';
  if (len > 42) return '0.82rem';
  if (len > 30) return '0.92rem';
  return '1.05rem';
}
