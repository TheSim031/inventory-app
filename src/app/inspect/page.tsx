'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ToastContainer, useToast } from '@/components/Toast';
import {
  ImagePicker,
  uploadLocalImages,
  type LocalImage,
  type UploadedImage,
} from '@/components/ImagePicker';
import styles from './inspect.module.css';

export const dynamic = 'force-dynamic';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((r) => r.json());

type InspectionItem = { code: string; name: string; quantity: number };
type Images = { fileId: string; url: string; name?: string };
type Inspection = {
  id: string;
  receivedAt: string;
  company: string;
  poRef: string;
  items: InspectionItem[];
  warehouseImages: { bill: Images[]; po: Images[]; items: Images[] };
  status: 'PENDING' | 'COMPLETED';
};

export default function InspectPage() {
  const { data, mutate, isLoading } = useSWR<Inspection[]>(
    '/api/inspections?status=PENDING',
    fetcher,
    { refreshInterval: 10000 },
  );

  const { toasts, add: addToast, remove: removeToast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pending = useMemo(() => data ?? [], [data]);
  const selected = useMemo(
    () => pending.find((r) => r.id === selectedId) ?? null,
    [pending, selectedId],
  );

  if (selected) {
    return (
      <InspectDetail
        inspection={selected}
        onBack={() => setSelectedId(null)}
        onCompleted={() => {
          setSelectedId(null);
          mutate();
          addToast('✅ ตรวจสอบเสร็จเรียบร้อย', 'success');
        }}
        addToast={addToast}
      />
    );
  }

  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} remove={removeToast} />
      <header className={styles.header}>
        <h1>
          🔍 <span>ตรวจสอบสินค้า (QC)</span>
        </h1>
        <p>เลือกรายการที่คลังส่งมาเพื่อตรวจสอบและแนบรูปต่อรายการ</p>
      </header>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>
          📋 รายการรอตรวจสอบ
          <span className={styles.countPill}>{pending.length}</span>
        </h2>

        {isLoading ? (
          <p className={styles.empty}>กำลังโหลด...</p>
        ) : pending.length === 0 ? (
          <p className={styles.empty}>ไม่มีรายการรอตรวจสอบในขณะนี้ 🎉</p>
        ) : (
          <div className={styles.list}>
            {pending.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedId(row.id)}
                className={styles.row}
              >
                <div className={styles.rowInfo}>
                  <div className={styles.rowHead}>
                    <span className={styles.poRef}>{row.poRef}</span>
                    <span className={styles.rowDate}>
                      {row.receivedAt
                        ? new Date(row.receivedAt).toLocaleString('th-TH')
                        : ''}
                    </span>
                  </div>
                  <div className={styles.company}>{row.company}</div>
                  <ul className={styles.itemsPreview}>
                    {row.items.map((it, i) => (
                      <li key={i}>
                        <code>{it.code}</code> {it.name}
                        <span className={styles.qty}>×{it.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={styles.cta}>▶ เปิดเพื่อตรวจ</div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function InspectDetail({
  inspection,
  onBack,
  onCompleted,
  addToast,
}: {
  inspection: Inspection;
  onBack: () => void;
  onCompleted: () => void;
  addToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  // Per-item images (staged in browser, uploaded at submit). Keyed by code.
  const [qcImages, setQcImages] = useState<Record<string, LocalImage[]>>({});
  const [inspector, setInspector] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const allItemsCovered = inspection.items.every(
    (it) => (qcImages[it.code]?.length ?? 0) > 0,
  );
  // Per Phase 4 spec: the submit button is gated ONLY by "every item has ≥1
  // image". The inspector field stays in the form for traceability — when
  // blank, the API falls back to the session displayName (see /api/inspections
  // PATCH handler) so completion is never blocked by a missing name.
  const canSubmit = !submitting && allItemsCovered;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Upload all per-item images first, then send the references to the
      // server. Preserve the per-code grouping so the API can store them.
      const codes = inspection.items.map((it) => it.code);
      const flatLocals: LocalImage[] = [];
      const groupSizes: number[] = [];
      for (const code of codes) {
        const list = qcImages[code] ?? [];
        flatLocals.push(...list);
        groupSizes.push(list.length);
      }
      setUploadProgress({ done: 0, total: flatLocals.length });

      const { uploaded, failures } = await uploadLocalImages(flatLocals, (p) =>
        setUploadProgress({ done: p.done, total: p.total }),
      );
      if (failures.length > 0) {
        const failPreview = failures
          .slice(0, 3)
          .map((f) => `${f.file}: ${f.error}`)
          .join(' | ');
        addToast(
          `อัปโหลด ${failures.length}/${flatLocals.length} รูปไม่สำเร็จ (${failPreview}${failures.length > 3 ? ' | ...' : ''})`,
          'error',
        );
        setSubmitting(false);
        setUploadProgress(null);
        return;
      }

      // Reassemble: { code: uploadedImages[] }
      const qcUploaded: Record<string, UploadedImage[]> = {};
      let cursor = 0;
      for (let i = 0; i < codes.length; i++) {
        qcUploaded[codes[i]] = uploaded.slice(cursor, cursor + groupSizes[i]);
        cursor += groupSizes[i];
      }

      const res = await fetch('/api/inspections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: inspection.id,
          qcImages: qcUploaded,
          inspector: inspector.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast(data.error || 'ยืนยันตรวจสอบไม่สำเร็จ', 'error');
        setSubmitting(false);
        setUploadProgress(null);
        return;
      }
      onCompleted();
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
    setSubmitting(false);
    setUploadProgress(null);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          ← กลับรายการ
        </button>
        <h1>
          🔍 <span>ตรวจสอบ: {inspection.poRef}</span>
        </h1>
        <p>
          จากบริษัท: <strong>{inspection.company}</strong>
          {' · '}
          รับเข้า:{' '}
          {inspection.receivedAt
            ? new Date(inspection.receivedAt).toLocaleString('th-TH')
            : '-'}
        </p>
      </header>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>📦 รายการสินค้า ({inspection.items.length})</h2>

        <div className={styles.itemsCheck}>
          {inspection.items.map((it) => (
            <div key={it.code} className={styles.itemCheckRow}>
              <div className={styles.itemCheckHead}>
                <div>
                  <code className={styles.code}>{it.code}</code>
                  <span className={styles.itemName}>{it.name}</span>
                  <span className={styles.qtyTag}>× {it.quantity}</span>
                </div>
                <span
                  className={
                    (qcImages[it.code]?.length ?? 0) > 0
                      ? styles.statusOk
                      : styles.statusPending
                  }
                >
                  {(qcImages[it.code]?.length ?? 0) > 0 ? '✓ แนบแล้ว' : '⚠ ต้องแนบรูป'}
                </span>
              </div>
              <ImagePicker
                compact
                label="รูปตรวจสอบ"
                images={qcImages[it.code] ?? []}
                onChange={(next) =>
                  setQcImages((prev) => ({ ...prev, [it.code]: next }))
                }
              />
            </div>
          ))}
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>🗂 รูปจากคลัง (อ้างอิง)</h2>
        <WarehouseImageBlock title="🧾 บิล" images={inspection.warehouseImages.bill} />
        <WarehouseImageBlock title="📄 PO / PX" images={inspection.warehouseImages.po} />
        <WarehouseImageBlock title="📦 ตัวของ" images={inspection.warehouseImages.items} />
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>✍️ ผู้ตรวจสอบ</h2>
        <div className={styles.inputGroup}>
          <label>ชื่อผู้ตรวจ *</label>
          <input
            type="text"
            value={inspector}
            onChange={(e) => setInspector(e.target.value)}
            placeholder="เช่น นาย QC สมชาย"
          />
        </div>

        <button
          type="button"
          className={styles.btnSubmit}
          disabled={!canSubmit}
          onClick={submit}
        >
          {submitting
            ? uploadProgress
              ? `⏳ อัปโหลดรูป ${uploadProgress.done}/${uploadProgress.total}...`
              : '⏳ กำลังบันทึก...'
            : allItemsCovered
            ? '✅ ยืนยันการตรวจสอบทั้งหมด'
            : '⚠ ต้องแนบรูปครบทุกรายการก่อน'}
        </button>
      </section>
    </div>
  );
}

function WarehouseImageBlock({
  title,
  images,
}: {
  title: string;
  images: { fileId: string; url: string; name?: string }[];
}) {
  return (
    <div className={styles.refBlock}>
      <div className={styles.refHead}>
        <span>{title}</span>
        <span className={styles.refCount}>{images.length} รูป</span>
      </div>
      {images.length === 0 ? (
        <p className={styles.refEmpty}>— ไม่มีรูป —</p>
      ) : (
        <div className={styles.refGrid}>
          {images.map((img) => (
            <a key={img.fileId} href={img.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.name || ''} loading="lazy" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
