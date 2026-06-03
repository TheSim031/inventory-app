'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { ToastContainer, useToast } from '@/components/Toast';
import { fetchJson } from '@/lib/authClient';
import { bangkokTodayISO } from '@/lib/dateTime';
import styles from './internal-pick.module.css';

export const dynamic = 'force-dynamic';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

type Item = {
  id: string;
  code: string;
  name: string;
  category: string;
  stock: number;
};

type SlipItem = {
  uid: string;
  selected: Item | null;
  search: string;
  showSuggestions: boolean;
  quantity: number | '';
};

type Slip = {
  uid: string;
  requester: string;
  purpose: string;
  requestedDate: string; // YYYY-MM-DD (Bangkok); default today, editable
  items: SlipItem[];
};

const newSlipItem = (): SlipItem => ({
  uid: `si-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  selected: null,
  search: '',
  showSuggestions: false,
  quantity: '',
});

const newSlip = (): Slip => ({
  uid: `slip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  requester: '',
  purpose: '',
  requestedDate: bangkokTodayISO(),
  items: [newSlipItem()],
});

export default function InternalPickPage() {
  const { data: items } = useSWR<Item[]>('/api/items', fetcher, {
    refreshInterval: 10000,
  });
  const { toasts, add: addToast, remove: removeToast } = useToast();

  const [slips, setSlips] = useState<Slip[]>(() => [newSlip()]);
  const [submitting, setSubmitting] = useState(false);
  const slipsRef = useRef<HTMLDivElement>(null);

  // Close any open suggestion dropdowns when clicking elsewhere.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (slipsRef.current && !slipsRef.current.contains(e.target as Node)) {
        setSlips((prev) =>
          prev.map((s) => ({
            ...s,
            items: s.items.map((it) => ({ ...it, showSuggestions: false })),
          })),
        );
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const updateSlip = (uid: string, patch: Partial<Slip>) => {
    setSlips((prev) => prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)));
  };

  const updateSlipItem = (
    slipUid: string,
    itemUid: string,
    patch: Partial<SlipItem>,
  ) => {
    setSlips((prev) =>
      prev.map((s) =>
        s.uid === slipUid
          ? {
              ...s,
              items: s.items.map((it) =>
                it.uid === itemUid ? { ...it, ...patch } : it,
              ),
            }
          : s,
      ),
    );
  };

  const addSlip = () =>
    setSlips((prev) => [...prev, newSlip()]);
  const removeSlip = (uid: string) =>
    setSlips((prev) => (prev.length === 1 ? prev : prev.filter((s) => s.uid !== uid)));
  const addItemToSlip = (slipUid: string) =>
    setSlips((prev) =>
      prev.map((s) =>
        s.uid === slipUid ? { ...s, items: [...s.items, newSlipItem()] } : s,
      ),
    );
  const removeItemFromSlip = (slipUid: string, itemUid: string) =>
    setSlips((prev) =>
      prev.map((s) =>
        s.uid === slipUid
          ? {
              ...s,
              items:
                s.items.length === 1
                  ? s.items
                  : s.items.filter((it) => it.uid !== itemUid),
            }
          : s,
      ),
    );

  const suggestionsFor = (search: string): Item[] => {
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
  };

  const allValid = useMemo(() => {
    return (
      slips.length > 0 &&
      slips.every(
        (s) =>
          s.requester.trim() &&
          s.purpose.trim() &&
          s.requestedDate &&
          s.items.length > 0 &&
          s.items.every(
            (it) =>
              it.selected &&
              typeof it.quantity === 'number' &&
              it.quantity > 0,
          ),
      )
    );
  }, [slips]);

  const submit = async () => {
    if (!allValid) return;
    setSubmitting(true);
    try {
      const payload = {
        slips: slips.map((s) => ({
          requester: s.requester.trim(),
          purpose: s.purpose.trim(),
          requestedDate: s.requestedDate,
          items: s.items.map((it) => ({
            code: it.selected!.code,
            name: it.selected!.name,
            quantity: it.quantity as number,
          })),
        })),
      };
      const res = await fetch('/api/admin/internal-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addToast(
          `✅ บันทึกเบิกภายใน ${data.slipCount} ใบ (${data.totalRows} รายการ) — ไม่แจ้งเตือน LINE`,
          'success',
        );
        setSlips([newSlip()]);
      } else {
        addToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
    setSubmitting(false);
  };

  const handlePrint = () => {
    document.body.classList.add('printing-internal-slips');
    setTimeout(() => {
      window.print();
      document.body.classList.remove('printing-internal-slips');
    }, 50);
  };

  type PrintCell =
    | { type: 'blank'; key: string }
    | {
        type: 'header';
        key: string;
        slipIdx: number;
        requester: string;
        purpose: string;
      }
    | {
        type: 'item';
        key: string;
        slipIdx: number;
        idx: number;
        total: number;
        requester: string;
        purpose: string;
        item: SlipItem;
      };

  const printCells = useMemo<PrintCell[]>(() => {
    const cells: PrintCell[] = [];
    slips.forEach((slip, slipIdx) => {
      if (slipIdx > 0) {
        cells.push({ type: 'blank', key: `blank-${slip.uid}` });
      }
      cells.push({
        type: 'header',
        key: `header-${slip.uid}`,
        slipIdx,
        requester: slip.requester,
        purpose: slip.purpose,
      });
      slip.items.forEach((it, idx) => {
        cells.push({
          type: 'item',
          key: `item-${it.uid}`,
          slipIdx,
          idx,
          total: slip.items.length,
          requester: slip.requester,
          purpose: slip.purpose,
          item: it,
        });
      });
    });
    return cells;
  }, [slips]);

  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} remove={removeToast} />

      <header className={`${styles.header} no-print`}>
        <h1>
          🤫 <span>เบิกสินค้าภายใน</span>
        </h1>
        <p>
          เบิกของเฉพาะกิจหรือทดสอบ — ระบบ <strong>จะไม่ส่ง LINE แจ้งเตือน</strong>
          ให้ผู้เบิก แต่จะตัดสต็อกและบันทึกประวัติเข้า-ออกตามปกติ
        </p>
      </header>

      <div ref={slipsRef} className={styles.slips}>
        {slips.map((slip, slipIdx) => (
          <section key={slip.uid} className={styles.slipCard}>
            <div className={`${styles.slipHead} no-print`}>
              <h2>
                ใบเบิกที่ {slipIdx + 1}{' '}
                <span className={styles.slipCount}>
                  ({slip.items.length} รายการ)
                </span>
              </h2>
              {slips.length > 1 && (
                <button
                  type="button"
                  className={styles.btnRemoveSlip}
                  onClick={() => removeSlip(slip.uid)}
                >
                  × ลบใบนี้
                </button>
              )}
            </div>

            <div className={`${styles.fieldRow} no-print`}>
              <div className={styles.field}>
                <label>ชื่อผู้เบิก *</label>
                <input
                  type="text"
                  value={slip.requester}
                  onChange={(e) =>
                    updateSlip(slip.uid, { requester: e.target.value })
                  }
                  placeholder="เช่น คุณสมชาย"
                  className={styles.input}
                />
              </div>

              <div className={styles.field}>
                <label>วัตถุประสงค์ *</label>
                <input
                  type="text"
                  value={slip.purpose}
                  onChange={(e) =>
                    updateSlip(slip.uid, { purpose: e.target.value })
                  }
                  placeholder="เช่น ทดสอบประกอบ / งานซ่อม"
                  className={styles.input}
                />
              </div>
            </div>

            <div className={`${styles.fieldRow} no-print`}>
              <div className={styles.field}>
                <label>วันที่เบิก *</label>
                <input
                  type="date"
                  value={slip.requestedDate}
                  onChange={(e) =>
                    updateSlip(slip.uid, { requestedDate: e.target.value })
                  }
                  className={styles.input}
                />
              </div>
            </div>

            <div className={`${styles.itemsHead} no-print`}>
              <span>รายการสินค้า ({slip.items.length})</span>
              <button
                type="button"
                onClick={() => addItemToSlip(slip.uid)}
                className={styles.btnAddItem}
              >
                + เพิ่มรายการ
              </button>
            </div>

            <div className={`${styles.itemList} no-print`}>
              {slip.items.map((it, itemIdx) => {
                const suggestions = suggestionsFor(it.search);
                return (
                  <div key={it.uid} className={styles.itemRow}>
                    <div className={styles.itemRowHead}>
                      <span className={styles.itemRowIdx}>#{itemIdx + 1}</span>
                      {slip.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItemFromSlip(slip.uid, it.uid)}
                          className={styles.btnRemoveItem}
                        >
                          × ลบ
                        </button>
                      )}
                    </div>
                    <div className={styles.itemGrid}>
                      <div className={styles.field}>
                        <label>ชื่อสินค้า *</label>
                        <div className={styles.searchBox}>
                          <input
                            type="text"
                            value={it.search}
                            onChange={(e) =>
                              updateSlipItem(slip.uid, it.uid, {
                                search: e.target.value,
                                selected: null,
                                showSuggestions: true,
                              })
                            }
                            onFocus={() =>
                              updateSlipItem(slip.uid, it.uid, {
                                showSuggestions: true,
                              })
                            }
                            placeholder="พิมพ์ชื่อ / รหัส / ประเภท..."
                            className={styles.input}
                            autoComplete="off"
                          />
                          {it.showSuggestions && suggestions.length > 0 && (
                            <ul className={styles.suggestionList}>
                              {suggestions.map((opt) => (
                                <li
                                  key={opt.id}
                                  className={styles.suggestionItem}
                                  onClick={() =>
                                    updateSlipItem(slip.uid, it.uid, {
                                      selected: opt,
                                      search: `${opt.code} — ${opt.name}`,
                                      showSuggestions: false,
                                    })
                                  }
                                >
                                  <span className={styles.suggestionName}>
                                    <code>{opt.code}</code> {opt.name}
                                  </span>
                                  <span className={styles.suggestionStock}>
                                    คงเหลือ {opt.stock}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div className={styles.field} style={{ maxWidth: 120 }}>
                        <label>จำนวน *</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={it.quantity}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateSlipItem(slip.uid, it.uid, {
                              quantity:
                                v === '' ? '' : Math.max(1, parseInt(v, 10) || 1),
                            });
                          }}
                          placeholder="0"
                          className={styles.input}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

          </section>
        ))}
      </div>

      {/* Print-only sheet — flattens every slip into a single 2×4 grid (8 cells
          per A4). Cell 1 of a slip shows ผู้เบิก/วัตถุประสงค์ for the box label;
          remaining cells show รหัส/ชื่อ/หมวดหมู่/จำนวน per item. A blank cell is
          inserted between slips so the cut boundary is unambiguous. */}
      <div className={styles.printSheet} aria-hidden>
        <div className={styles.printGrid}>
          {printCells.map((cell) => {
            if (cell.type === 'blank') {
              return (
                <div
                  key={cell.key}
                  className={`${styles.printCell} ${styles.printCellBlank}`}
                />
              );
            }
            if (cell.type === 'header') {
              return (
                <div
                  key={cell.key}
                  className={`${styles.printCell} ${styles.printCellHeader}`}
                >
                  <div className={styles.printCellHeaderTag}>
                    ใบปะหน้า #{cell.slipIdx + 1}
                  </div>
                  <div className={styles.printCellHeaderLabel}>ผู้เบิก</div>
                  <div className={styles.printCellHeaderName}>
                    {cell.requester || '-'}
                  </div>
                  <div className={styles.printCellHeaderLabel}>
                    วัตถุประสงค์
                  </div>
                  <div className={styles.printCellHeaderPurpose}>
                    {cell.purpose || '-'}
                  </div>
                </div>
              );
            }
            const it = cell.item;
            return (
              <div key={cell.key} className={styles.printCell}>
                <div className={styles.printCellTopRow}>
                  <span className={styles.printCellSlipBadge}>
                    ชุดที่ {cell.slipIdx + 1}
                  </span>
                  <span className={styles.printCellIdx}>
                    #{cell.idx + 1}/{cell.total}
                  </span>
                </div>
                <div className={styles.printCellSlipInfo}>
                  <div className={styles.printCellSlipInfoRow}>
                    <span className={styles.printCellSlipInfoLabel}>ผู้เบิก</span>
                    <span className={styles.printCellSlipInfoValue}>
                      {cell.requester || '-'}
                    </span>
                  </div>
                  <div className={styles.printCellSlipInfoRow}>
                    <span className={styles.printCellSlipInfoLabel}>
                      วัตถุประสงค์
                    </span>
                    <span className={styles.printCellSlipInfoValue}>
                      {cell.purpose || '-'}
                    </span>
                  </div>
                </div>
                <div className={styles.printCellBody}>
                  {it.selected?.category && (
                    <div className={styles.printCellCategory}>
                      {it.selected.category}
                    </div>
                  )}
                  <div
                    className={styles.printCellItemName}
                    style={{
                      fontSize: coverItemNameFontSize(
                        it.selected?.name || '',
                      ),
                    }}
                  >
                    {it.selected?.name || '-'}
                  </div>
                </div>
                <div className={styles.printCellQty}>
                  × {it.quantity || 0}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`${styles.actions} no-print`}>
        <button type="button" onClick={addSlip} className={styles.btnAddSlip}>
          + เพิ่มใบเบิกอีก 1 ชุด
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className={styles.btnPrint}
          disabled={!allValid}
        >
          🖨 พิมพ์ใบปะหน้า
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!allValid || submitting}
          className={styles.btnSubmit}
        >
          {submitting
            ? '⏳ กำลังบันทึก...'
            : allValid
            ? `✓ ยืนยันเบิกภายใน (${slips.length} ใบ)`
            : 'กรอกข้อมูลให้ครบก่อน'}
        </button>
      </div>
    </div>
  );
}

function coverItemNameFontSize(name: string): string {
  const len = Array.from(name.trim()).length;
  if (len > 54) return '0.72rem';
  if (len > 42) return '0.82rem';
  if (len > 30) return '0.92rem';
  return '1.05rem';
}
