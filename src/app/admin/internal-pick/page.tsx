'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { ToastContainer, useToast } from '@/components/Toast';
import { fetchJson } from '@/lib/authClient';
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
          <section key={slip.uid} className={`${styles.slipCard} internal-slip-print`}>
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

            {/* Print-only header */}
            <div className={styles.printSlipHead}>
              <h2>ใบเบิกสินค้าภายใน #{slipIdx + 1}</h2>
              <div>บริษัท ไพโอเนียร์ เอ็นจิเนียริ่ง อินเตอร์เนชั่นแนล จำกัด</div>
            </div>

            <div className={styles.fieldRow}>
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
                <div className={styles.printField}>
                  <strong>ผู้เบิก:</strong> {slip.requester || '-'}
                </div>
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
                <div className={styles.printField}>
                  <strong>วัตถุประสงค์:</strong> {slip.purpose || '-'}
                </div>
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

            {/* Print-only items table */}
            <table className={styles.printItemsTable}>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th>รหัส</th>
                  <th>ชื่อรายการ</th>
                  <th style={{ width: '80px', textAlign: 'right' }}>จำนวน</th>
                </tr>
              </thead>
              <tbody>
                {slip.items.map((it, i) => (
                  <tr key={it.uid}>
                    <td>{i + 1}</td>
                    <td>{it.selected?.code || '-'}</td>
                    <td>{it.selected?.name || '-'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>
                      {it.quantity || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={styles.printSignBlock}>
              <div>
                <div className={styles.printSignLine}>ลายเซ็นผู้เบิก / วันที่</div>
              </div>
              <div>
                <div className={styles.printSignLine}>ลายเซ็นผู้จ่าย / วันที่</div>
              </div>
            </div>
          </section>
        ))}
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
