'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { ToastContainer, useToast } from '@/components/Toast';
import {
  ImagePicker,
  uploadLocalImages,
  type LocalImage,
} from '@/components/ImagePicker';
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

type Row = {
  /** local UID so React can key + reorder safely */
  uid: string;
  selected: Item | null;
  search: string;
  showSuggestions: boolean;
  quantity: number | '';
};

const newRow = (): Row => ({
  uid: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  selected: null,
  search: '',
  showSuggestions: false,
  quantity: '',
});

export default function InPage() {
  const {
    data: items,
    error: itemsError,
    mutate: mutateItems,
  } = useSWR<Item[]>('/api/items', fetcher, { refreshInterval: 10000 });

  const { toasts, add: addToast, remove: removeToast } = useToast();

  const [company, setCompany] = useState('');
  const [poRef, setPoRef] = useState('');
  const [rows, setRows] = useState<Row[]>([newRow()]);

  const [billImages, setBillImages] = useState<LocalImage[]>([]);
  const [poImages, setPoImages] = useState<LocalImage[]>([]);
  const [goodsImages, setGoodsImages] = useState<LocalImage[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [showInspectModal, setShowInspectModal] = useState(false);

  const rowsContainerRef = useRef<HTMLDivElement>(null);

  // Close any open suggestion dropdowns when clicking elsewhere.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (rowsContainerRef.current && !rowsContainerRef.current.contains(e.target as Node)) {
        setRows((prev) => prev.map((r) => ({ ...r, showSuggestions: false })));
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const updateRow = (uid: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (uid: string) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.uid !== uid)));

  const suggestionsFor = (search: string) => {
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

  const allRowsValid = useMemo(
    () =>
      rows.length > 0 &&
      rows.every(
        (r) => r.selected && typeof r.quantity === 'number' && r.quantity > 0,
      ),
    [rows],
  );

  // Require at least one image per category — receiving without bill/PO/goods
  // proof is essentially useless for QC.
  const allImagesPresent =
    billImages.length > 0 && poImages.length > 0 && goodsImages.length > 0;

  const missingImageCategories: string[] = [];
  if (billImages.length === 0) missingImageCategories.push('บิล');
  if (poImages.length === 0) missingImageCategories.push('PO/PX');
  if (goodsImages.length === 0) missingImageCategories.push('ตัวของ');

  const canSubmit =
    !submitting &&
    !!company.trim() &&
    !!poRef.trim() &&
    allRowsValid &&
    allImagesPresent;

  const openConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setShowInspectModal(true);
  };

  const doSubmit = async (sendToInspect: boolean) => {
    setShowInspectModal(false);
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const itemsPayload = rows
        .filter((r) => r.selected && typeof r.quantity === 'number')
        .map((r) => ({
          code: r.selected!.code,
          name: r.selected!.name,
          quantity: r.quantity as number,
        }));

      // 1) Stock first — this is the source of truth for inventory.
      const historyRes = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'IN',
          recorder: company.trim(),
          poRef: poRef.trim(),
          items: itemsPayload,
        }),
      });
      const historyData = await historyRes.json().catch(() => ({}));
      if (!historyRes.ok) {
        addToast(historyData.error || 'บันทึกรับเข้าไม่สำเร็จ', 'error');
        setSubmitting(false);
        return;
      }

      if (sendToInspect) {
        // 2) Upload all images now (was deferred), then 3) POST inspection.
        // Doing it in this order means we never leave orphan Drive files
        // when the user abandons the form before submit.
        const allLocal = [...billImages, ...poImages, ...goodsImages];
        setUploadProgress({ done: 0, total: allLocal.length });
        const billCount = billImages.length;
        const poCount = poImages.length;

        const { uploaded, failures } = await uploadLocalImages(allLocal, (p) =>
          setUploadProgress({ done: p.done, total: p.total }),
        );

        if (failures.length > 0) {
          const failPreview = failures
            .slice(0, 3)
            .map((f) => `${f.file}: ${f.error}`)
            .join(' | ');
          addToast(
            `บันทึกสต็อกสำเร็จ แต่อัปโหลด ${failures.length}/${allLocal.length} รูปไม่สำเร็จ (${failPreview}${failures.length > 3 ? ' | ...' : ''}) — ลองส่งตรวจสอบใหม่`,
            'error',
          );
          setSubmitting(false);
          setUploadProgress(null);
          return;
        }

        const billUploaded = uploaded.slice(0, billCount);
        const poUploaded = uploaded.slice(billCount, billCount + poCount);
        const goodsUploaded = uploaded.slice(billCount + poCount);

        const inspectRes = await fetch('/api/inspections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: company.trim(),
            poRef: poRef.trim(),
            items: itemsPayload,
            warehouseImages: {
              bill: billUploaded,
              po: poUploaded,
              items: goodsUploaded,
            },
          }),
        });
        const inspectData = await inspectRes.json().catch(() => ({}));
        if (!inspectRes.ok) {
          addToast(
            `บันทึกสต็อกสำเร็จ แต่ส่งตรวจสอบไม่สำเร็จ: ${inspectData.error || ''}`,
            'error',
          );
          setSubmitting(false);
          setUploadProgress(null);
          return;
        }
        addToast('✅ บันทึกรับเข้าและส่งตรวจสอบเรียบร้อย', 'success');
      } else {
        addToast('✅ บันทึกรับเข้าเรียบร้อย', 'success');
      }

      // Reset form only on full success — otherwise user keeps their work.
      setCompany('');
      setPoRef('');
      setRows([newRow()]);
      setBillImages([]);
      setPoImages([]);
      setGoodsImages([]);
      mutateItems();
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
    setSubmitting(false);
    setUploadProgress(null);
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

      <form onSubmit={openConfirm} className={styles.card}>
        <h2 className={styles.sectionTitle}>📥 บันทึกการรับเข้า</h2>

        <div className={styles.inputGroup}>
          <label>ชื่อบริษัทที่จัดส่ง *</label>
          <input
            required
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="เช่น บริษัท ABC จำกัด"
          />
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

        <div className={styles.itemsHeader}>
          <span>รายการสินค้า ({rows.length})</span>
          <button type="button" onClick={addRow} className={styles.addRowBtn}>
            + เพิ่มรายการ
          </button>
        </div>

        <div ref={rowsContainerRef} className={styles.itemsList}>
          {rows.map((row, idx) => {
            const suggestions = suggestionsFor(row.search);
            return (
              <div key={row.uid} className={styles.itemRow}>
                <div className={styles.itemRowHead}>
                  <span className={styles.itemRowIndex}>#{idx + 1}</span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className={styles.itemRowRemove}
                      onClick={() => removeRow(row.uid)}
                      aria-label="ลบรายการ"
                    >
                      × ลบ
                    </button>
                  )}
                </div>

                <div className={styles.itemRowGrid}>
                  <div className={styles.inputGroup}>
                    <label>ชื่อรายการสินค้า *</label>
                    <div className={styles.searchBox}>
                      <input
                        required
                        type="text"
                        placeholder="พิมพ์ชื่อสินค้า / รหัส / ประเภท..."
                        value={row.search}
                        onChange={(e) =>
                          updateRow(row.uid, {
                            search: e.target.value,
                            selected: null,
                            showSuggestions: true,
                          })
                        }
                        onFocus={() => updateRow(row.uid, { showSuggestions: true })}
                        autoComplete="off"
                      />
                      {row.showSuggestions && suggestions.length > 0 && (
                        <ul className={styles.suggestionList}>
                          {suggestions.map((it) => (
                            <li
                              key={it.id}
                              className={styles.suggestionItem}
                              onClick={() =>
                                updateRow(row.uid, {
                                  selected: it,
                                  search: `${it.code} — ${it.name}`,
                                  showSuggestions: false,
                                })
                              }
                            >
                              <div className={styles.suggestionMain}>
                                <span className={styles.suggestionName}>
                                  <code>{it.code}</code> — {it.name}
                                </span>
                                {it.category && (
                                  <span className={styles.suggestionCategory}>
                                    {it.category}
                                  </span>
                                )}
                              </div>
                              <span className={styles.suggestionStock}>
                                คงเหลือ {it.stock}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {row.showSuggestions &&
                        row.search.trim() &&
                        suggestions.length === 0 &&
                        !row.selected && (
                          <ul className={styles.suggestionList}>
                            <li className={styles.suggestionEmpty}>
                              {itemsError
                                ? 'โหลดรายการสินค้าไม่ได้'
                                : `ไม่พบรายการที่ตรงกับ "${row.search}"`}
                            </li>
                          </ul>
                        )}
                    </div>
                    {row.selected && (
                      <p className={styles.selectedHint}>
                        ✓ <strong>{row.selected.name}</strong> ({row.selected.code})
                      </p>
                    )}
                  </div>

                  <div className={styles.inputGroup} style={{ maxWidth: 140 }}>
                    <label>จำนวน *</label>
                    <input
                      required
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateRow(row.uid, {
                          quantity: v === '' ? '' : Math.max(1, parseInt(v, 10) || 1),
                        });
                      }}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.imagesSection}>
          <h3 className={styles.sectionSubtitle}>📸 แนบรูปภาพ</h3>
          <div className={styles.imageGroup}>
            <ImagePicker label="🧾 บิล" images={billImages} onChange={setBillImages} />
          </div>
          <div className={styles.imageGroup}>
            <ImagePicker label="📄 PO / PX" images={poImages} onChange={setPoImages} />
          </div>
          <div className={styles.imageGroup}>
            <ImagePicker label="📦 ตัวของ" images={goodsImages} onChange={setGoodsImages} />
          </div>
        </div>

        {!allImagesPresent && (
          <p className={styles.warnText}>
            ⚠ ต้องแนบรูปอย่างน้อย 1 รูปทุกหมวด — ขาด:{' '}
            {missingImageCategories.join(', ')}
          </p>
        )}

        <button type="submit" className={styles.btnSubmit} disabled={!canSubmit}>
          {submitting
            ? uploadProgress
              ? `⏳ อัปโหลดรูป ${uploadProgress.done}/${uploadProgress.total}...`
              : '⏳ กำลังบันทึก...'
            : '💾 ยืนยันรับของ'}
        </button>
      </form>

      {showInspectModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-title">🔍 แจ้งตรวจสอบไหม?</div>
            <div className="modal-body">
              หลังจากยืนยันรับของ ต้องการส่งรายการนี้ไปให้ <strong>QC ตรวจสอบ</strong> ด้วยหรือไม่?
              <br />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                ถ้า &quot;ไม่&quot; — ระบบจะบันทึกรับเข้าสต็อกอย่างเดียว
              </span>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn-no"
                onClick={() => doSubmit(false)}
                disabled={submitting}
              >
                ไม่
              </button>
              <button
                type="button"
                className="modal-btn modal-btn-yes"
                onClick={() => doSubmit(true)}
                disabled={submitting}
              >
                ใช่ ส่งตรวจสอบ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
