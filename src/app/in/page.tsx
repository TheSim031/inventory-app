'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { ToastContainer, useToast } from '@/components/Toast';
import styles from './in.module.css';

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

export default function InPage() {
  const {
    data: items,
    error: itemsError,
    mutate: mutateItems,
  } = useSWR<Item[]>('/api/items', fetcher, { refreshInterval: 10000 });

  const { toasts, add: addToast, remove: removeToast } = useToast();

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
    if (!items?.length || !search.trim()) return [];
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
        mutateItems();
      } else {
        addToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
    setSubmitting(false);
  };

  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} remove={removeToast} />

      <header className={styles.header}>
        <h1>
          📥 <span>รับของเข้าคลัง</span>
        </h1>
        <p>บันทึกพัสดุที่นำเข้าใหม่ พร้อมตัดสต็อกอัตโนมัติ</p>
      </header>

      <form onSubmit={handleSubmit} className={styles.card}>
        <h2 className={styles.sectionTitle}>📥 บันทึกการรับเข้า</h2>

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
    </div>
  );
}
