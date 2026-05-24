'use client';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import styles from './warehouse.module.css';

export const dynamic = 'force-dynamic';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((res) => res.json());

type Item = {
  id: string;
  code: string;
  name: string;
  category: string;
  stock: number;
};

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

/* ─── Toast System ─── */
type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

function ToastContainer({ toasts, remove }: { toasts: Toast[]; remove: (id: number) => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => remove(t.id)}
          style={{
            padding: '12px 20px',
            borderRadius: 10,
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            maxWidth: 360,
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
            animation: 'slideIn 0.3s ease',
            background:
              t.type === 'success'
                ? 'linear-gradient(135deg,#22c55e,#16a34a)'
                : t.type === 'error'
                ? 'linear-gradient(135deg,#ef4444,#dc2626)'
                : 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
          }}
        >
          {t.type === 'success' ? '✅ ' : t.type === 'error' ? '❌ ' : 'ℹ️ '}
          {t.message}
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  const remove = useCallback(
    (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [],
  );
  return { toasts, add, remove };
}

/* ─── Main Page ─── */
export default function WarehousePage() {
  const {
    data: items,
    error: itemsError,
    mutate: mutateItems,
  } = useSWR<Item[]>('/api/items', fetcher, { refreshInterval: 10000 });

  const {
    data: requisitions,
    mutate: mutateReqs,
  } = useSWR<Requisition[]>('/api/requisitions', fetcher, { refreshInterval: 8000 });

  const router = useRouter();
  const { toasts, add: addToast, remove: removeToast } = useToast();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} remove={removeToast} />

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>

      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <Link href="/" className={styles.backLink}>
              ← กลับหน้าหลัก
            </Link>
            <h1>ระบบจัดการคลังสินค้า (Warehouse Dashboard)</h1>
            <p>ตรวจสอบและอนุมัติใบเบิก พร้อมบันทึกการรับเข้าคลัง</p>
          </div>
          <button className={styles.btnLogout} onClick={handleLogout}>
            ออกจากระบบ
          </button>
        </div>
      </header>

      <PendingRequisitions
        requisitions={requisitions ?? []}
        loading={!requisitions}
        onChange={() => {
          mutateReqs();
          mutateItems();
        }}
        addToast={addToast}
      />

      <ReceiveGoodsForm
        items={items ?? []}
        itemsError={!!itemsError}
        onRecorded={() => mutateItems()}
        addToast={addToast}
      />
    </div>
  );
}

/* ─── Pending Requisitions ─── */
function PendingRequisitions({
  requisitions,
  loading,
  onChange,
  addToast,
}: {
  requisitions: Requisition[];
  loading: boolean;
  onChange: () => void;
  addToast: (msg: string, type: ToastType) => void;
}) {
  const [processing, setProcessing] = useState<string | null>(null);

  const pending = useMemo(
    () => requisitions.filter((r) => r.status === 'PENDING'),
    [requisitions],
  );

  const act = async (req: Requisition, action: 'APPROVE' | 'REJECT') => {
    const confirmMsg =
      action === 'APPROVE'
        ? `ยืนยันอนุมัติและตัดสต็อกใบเบิก ${req.id}?`
        : `ยืนยันยกเลิกใบเบิก ${req.id}?`;
    if (!confirm(confirmMsg)) return;

    setProcessing(req.id);
    try {
      const res = await fetch(`/api/requisitions/${encodeURIComponent(req.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(
          action === 'APPROVE'
            ? `อนุมัติใบเบิก ${req.id} แล้ว — ตัดสต็อกเรียบร้อย`
            : `ยกเลิกใบเบิก ${req.id} แล้ว`,
          action === 'APPROVE' ? 'success' : 'info',
        );
        onChange();
      } else {
        addToast(data.error || 'ดำเนินการไม่สำเร็จ', 'error');
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
    setProcessing(null);
  };

  return (
    <section className={styles.pendingCard}>
      <h2 className={styles.sectionTitle}>📋 ใบเบิกรออนุมัติ ({pending.length})</h2>

      {loading ? (
        <p className={styles.emptyState}>กำลังโหลด...</p>
      ) : pending.length === 0 ? (
        <p className={styles.emptyState}>ไม่มีใบเบิกรออนุมัติในขณะนี้</p>
      ) : (
        <div className={styles.reqList}>
          {pending.map((req) => (
            <div key={req.id} className={styles.reqRow}>
              <div className={styles.reqInfo}>
                <div className={styles.reqHeader}>
                  <span className={styles.reqId}>{req.id}</span>
                  <span className={styles.reqDate}>
                    {req.date ? new Date(req.date).toLocaleString('th-TH') : ''}
                  </span>
                </div>
                <div className={styles.reqMeta}>
                  <strong>{req.recorder}</strong>
                  {req.department && <span> · {req.department}</span>}
                </div>
                {req.purpose && <div className={styles.reqPurpose}>วัตถุประสงค์: {req.purpose}</div>}
                {req.poPx && <div className={styles.reqPurpose}>PO/PX: {req.poPx}</div>}
                <ul className={styles.reqItems}>
                  {req.items.map((it, i) => (
                    <li key={i}>
                      <code>{it.code}</code> {it.name}{' '}
                      <span className={styles.qty}>×{it.quantity}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={styles.reqActions}>
                <button
                  type="button"
                  className={styles.btnApprove}
                  disabled={processing === req.id}
                  onClick={() => act(req, 'APPROVE')}
                >
                  {processing === req.id ? '...' : 'อนุมัติ & ตัดสต็อก'}
                </button>
                <button
                  type="button"
                  className={styles.btnReject}
                  disabled={processing === req.id}
                  onClick={() => act(req, 'REJECT')}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─── Receive Goods Form ─── */
function ReceiveGoodsForm({
  items,
  itemsError,
  onRecorded,
  addToast,
}: {
  items: Item[];
  itemsError: boolean;
  onRecorded: () => void;
  addToast: (msg: string, type: ToastType) => void;
}) {
  const [recorder, setRecorder] = useState('');
  const [poRef, setPoRef] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [search, setSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    if (!items.length || !search.trim()) return [];
    const q = search.trim().toLowerCase();
    return items
      .filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.code || '').toLowerCase().includes(q) ||
          (it.category || '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [items, search]);

  const selectItem = (item: Item) => {
    setSelected(item);
    setSearch(`${item.code} — ${item.name}`);
    setShowSuggestions(false);
  };

  const clearSelected = () => {
    setSelected(null);
    setSearch('');
  };

  const canSubmit =
    !submitting &&
    !!recorder.trim() &&
    !!selected &&
    !!poRef.trim() &&
    typeof quantity === 'number' &&
    quantity > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !selected || typeof quantity !== 'number') return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'IN',
          recorder: recorder.trim(),
          poRef: poRef.trim(),
          items: [{ code: selected.code, name: selected.name, quantity }],
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        addToast(`บันทึกรับเข้า "${selected.name}" จำนวน ${quantity} เรียบร้อย`, 'success');
        setRecorder('');
        setPoRef('');
        setQuantity('');
        clearSelected();
        onRecorded();
      } else {
        addToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.receiveCard}>
      <h2 className={styles.sectionTitle}>📥 รับของเข้าคลัง</h2>

      <div className={styles.inputGroup}>
        <label>ชื่อผู้รับ *</label>
        <input
          required
          type="text"
          value={recorder}
          onChange={(e) => setRecorder(e.target.value)}
          placeholder="นาย สมมติ รักดี"
        />
      </div>

      <div className={styles.inputGroup} ref={searchBoxRef}>
        <label>ชื่อรายการสินค้า *</label>
        <div className={styles.searchBox}>
          <input
            required
            type="text"
            placeholder="พิมพ์ชื่อสินค้า / รหัส / ประเภท..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            autoComplete="off"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className={styles.suggestionList}>
              {suggestions.map((it) => (
                <li
                  key={it.id}
                  className={styles.suggestionItem}
                  onClick={() => selectItem(it)}
                >
                  <div className={styles.suggestionMain}>
                    <span className={styles.suggestionName}>
                      <code>{it.code}</code> — {it.name}
                    </span>
                    {it.category && (
                      <span className={styles.suggestionCategory}>{it.category}</span>
                    )}
                  </div>
                  <span className={styles.suggestionStock}>คงเหลือ {it.stock}</span>
                </li>
              ))}
            </ul>
          )}
          {showSuggestions && search.trim() && suggestions.length === 0 && !selected && (
            <ul className={styles.suggestionList}>
              <li className={styles.suggestionEmpty}>
                {itemsError
                  ? 'โหลดรายการสินค้าไม่ได้ — ตรวจสอบการเชื่อมต่อ Google Sheets'
                  : `ไม่พบรายการที่ตรงกับ "${search}"`}
              </li>
            </ul>
          )}
        </div>
        {selected && (
          <p className={styles.selectedHint}>
            ✓ เลือก: <strong>{selected.name}</strong> ({selected.code})
            <button
              type="button"
              onClick={clearSelected}
              className={styles.clearBtn}
              aria-label="ล้างการเลือก"
            >
              ×
            </button>
          </p>
        )}
      </div>

      <div className={styles.inputGroup}>
        <label>รหัส PO / PX *</label>
        <input
          required
          type="text"
          value={poRef}
          onChange={(e) => setPoRef(e.target.value)}
          placeholder="เช่น PO-2025-001"
        />
      </div>

      <div className={styles.inputGroup}>
        <label>จำนวน *</label>
        <input
          required
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => {
            const v = e.target.value;
            setQuantity(v === '' ? '' : Math.max(1, parseInt(v, 10) || 1));
          }}
          placeholder="0"
        />
      </div>

      <button type="submit" className={styles.btnSubmit} disabled={!canSubmit}>
        {submitting ? '⏳ กำลังบันทึก...' : '💾 บันทึกรับเข้าคลัง'}
      </button>
    </form>
  );
}
