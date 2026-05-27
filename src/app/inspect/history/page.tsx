'use client';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { MonthlyCleanupBanner } from '@/components/MonthlyCleanupBanner';
import { ToastContainer, useToast } from '@/components/Toast';
import { formatThaiDateTime } from '@/lib/dateTime';
import styles from './history.module.css';

export const dynamic = 'force-dynamic';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((r) => r.json());

type Img = { fileId: string; url: string; name?: string };
type InspectionItem = { code: string; name: string; quantity: number };
type Inspection = {
  id: string;
  receivedAt: string;
  company: string;
  poRef: string;
  items: InspectionItem[];
  warehouseImages: { bill: Img[]; po: Img[]; items: Img[] };
  qcImages: Record<string, Img[]>;
  status: 'PENDING' | 'COMPLETED';
  inspector: string;
  inspectedAt: string;
};

type Me = {
  isAuthenticated: boolean;
  isCreator: boolean;
  role: string | null;
};

// Server requires this exact phrase in the DELETE body to guard against
// accidental wipes (defence-in-depth alongside the UI confirm modal).
const CONFIRM_PHRASE = 'DELETE_INSPECTION_HISTORY';

export default function InspectHistoryPage() {
  const { data, isLoading, mutate } = useSWR<Inspection[]>(
    '/api/inspections?status=COMPLETED',
    fetcher,
    { refreshInterval: 15000 },
  );
  const { data: me } = useSWR<Me>('/api/auth/me', fetcher);
  const { toasts, add: addToast, remove: removeToast } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const list = useMemo(() => data ?? [], [data]);
  const detail = useMemo(
    () => list.find((r) => r.id === selectedId) ?? null,
    [list, selectedId],
  );

  // Only warehouse (and the creator who bypasses every role) sees the inline
  // cleanup UI. Other authorised roles (PURCHASING/EXECUTIVE/QC) see the
  // same list read-only — no checkboxes, no delete button, no toolbar.
  const canDelete = !!me?.isCreator || me?.role === 'WAREHOUSE';

  if (detail) {
    return <Detail inspection={detail} onBack={() => setSelectedId(null)} />;
  }

  const allChecked = list.length > 0 && selected.size === list.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(list.map((r) => r.id)));
  };

  const doDelete = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/inspections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selected),
          confirm: CONFIRM_PHRASE,
        }),
      });
      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast(responseData.error || 'ลบไม่สำเร็จ', 'error');
      } else {
        const deleted = responseData.deleted ?? 0;
        const driveFailed = responseData.driveFailed ?? 0;
        const driveDeleted = responseData.driveDeleted ?? 0;
        if (driveFailed > 0) {
          addToast(
            `ลบประวัติแล้ว ${deleted} รายการ แต่ลบไฟล์ Drive ไม่ครบ: สำเร็จ ${driveDeleted}, ไม่สำเร็จ ${driveFailed} — อาจมีไฟล์ค้างใน Drive`,
            'error',
          );
        } else {
          addToast(
            `✅ ลบประวัติตรวจสอบเรียบร้อย ${deleted} รายการ และลบไฟล์ Drive แล้ว ${driveDeleted} ไฟล์`,
            'success',
          );
        }
        setSelected(new Set());
        mutate();
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
    setDeleting(false);
    setConfirmOpen(false);
  };

  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} remove={removeToast} />

      <header className={styles.header}>
        <h1>
          📋 <span>ประวัติตรวจสอบ</span>
        </h1>
        <p>
          รายการที่ QC ตรวจสอบเสร็จเรียบร้อยแล้ว — กดเพื่อดูรายละเอียดหรือพิมพ์
          {canDelete && (
            <>
              {' · '}
              <strong>คลังสามารถเลือกประวัติเก่าเพื่อลบได้จาก toolbar ด้านล่าง</strong>
            </>
          )}
        </p>
      </header>

      <MonthlyCleanupBanner pendingCount={list.length} />

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>
          ✅ รายการที่ตรวจสอบแล้ว
          <span className={styles.countPill}>{list.length}</span>
        </h2>

        {canDelete && list.length > 0 && (
          <div className={styles.cleanupToolbar}>
            <label className={styles.selectAllLabel}>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
              />
              <span>เลือกทั้งหมด ({list.length})</span>
            </label>
            <div className={styles.toolbarRight}>
              <span className={styles.selectedCount}>
                เลือกแล้ว <strong>{selected.size}</strong>
              </span>
              <button
                type="button"
                className={styles.btnDelete}
                disabled={selected.size === 0 || deleting}
                onClick={() => setConfirmOpen(true)}
              >
                🗑 ลบที่เลือก ({selected.size})
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className={styles.empty}>กำลังโหลด...</p>
        ) : list.length === 0 ? (
          <p className={styles.empty}>ยังไม่มีประวัติการตรวจสอบ</p>
        ) : (
          <div className={styles.list}>
            {list.map((row) => {
              const isSel = selected.has(row.id);
              return (
                <div
                  key={row.id}
                  className={`${styles.row} ${
                    canDelete && isSel ? styles.rowSel : ''
                  }`}
                >
                  {canDelete && (
                    <label
                      className={styles.rowCheckbox}
                      aria-label="เลือกรายการนี้เพื่อลบ"
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(row.id)}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={styles.rowBody}
                  >
                    <div className={styles.rowInfo}>
                      <div className={styles.rowHead}>
                        <span className={styles.poRef}>{row.poRef}</span>
                        <span className={styles.rowDate}>
                          {row.inspectedAt
                            ? formatThaiDateTime(row.inspectedAt)
                            : ''}
                        </span>
                      </div>
                      <div className={styles.company}>{row.company}</div>
                      <div className={styles.meta}>
                        ผู้ตรวจ: <strong>{row.inspector || '-'}</strong>
                        {' · '}
                        รายการ: <strong>{row.items.length}</strong>
                      </div>
                    </div>
                    <div className={styles.cta}>▶ ดูรายละเอียด</div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {confirmOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div
              className="modal-title"
              style={{ color: 'var(--danger-color)' }}
            >
              ⚠ ยืนยันการลบประวัติตรวจสอบ
            </div>
            <div className="modal-body">
              คุณกำลังจะลบ <strong>{selected.size}</strong> รายการจากประวัติตรวจสอบ
              <br />
              <br />
              <div className={styles.warningBox}>
                <strong>⚠ จะลบแค่ประวัติตรวจสอบเท่านั้น — ข้อมูลอื่นจะไม่ถูกแตะต้อง</strong>
                <ul>
                  <li>ข้อมูลสต็อก/ประวัติเข้า-ออก จะไม่ถูกแตะต้อง</li>
                  <li>รูปที่อัปโหลดบน Drive จะถูกลบไปด้วย</li>
                  <li>การกระทำนี้ <u>ไม่สามารถย้อนกลับได้</u></li>
                </ul>
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn-no"
                onClick={() => setConfirmOpen(false)}
                disabled={deleting}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="modal-btn modal-btn-yes"
                onClick={doDelete}
                disabled={deleting}
                style={{ background: 'var(--danger-color)' }}
              >
                {deleting ? '⏳ กำลังลบ...' : `ลบ ${selected.size} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className={`${styles.lightboxBackdrop} no-print`}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        type="button"
        className={styles.lightboxClose}
        onClick={onClose}
        aria-label="ปิดรูปภาพ"
      >
        ✕
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.lightboxImg}
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function Detail({
  inspection,
  onBack,
}: {
  inspection: Inspection;
  onBack: () => void;
}) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  return (
    <div className={styles.container}>
      <div className={`${styles.toolbar} no-print`}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          ← กลับรายการ
        </button>
        <button
          type="button"
          className={styles.printBtn}
          onClick={() => window.print()}
        >
          🖨 พิมพ์
        </button>
      </div>

      <div className={styles.printDoc}>
        <header className={styles.printHeader}>
          <h1>📋 ใบตรวจสอบสินค้า (QC)</h1>
          <div className={styles.printId}>{inspection.id}</div>
        </header>

        <section className={styles.printSection}>
          <table className={styles.metaTable}>
            <tbody>
              <tr>
                <th>บริษัทที่จัดส่ง</th>
                <td>{inspection.company}</td>
              </tr>
              <tr>
                <th>รหัส PO/PX</th>
                <td>{inspection.poRef}</td>
              </tr>
              <tr>
                <th>วันที่รับเข้า</th>
                <td>
                  {inspection.receivedAt
                    ? formatThaiDateTime(inspection.receivedAt)
                    : '-'}
                </td>
              </tr>
              <tr>
                <th>ผู้ตรวจสอบ</th>
                <td>{inspection.inspector || '-'}</td>
              </tr>
              <tr>
                <th>วันที่ตรวจสอบ</th>
                <td>
                  {inspection.inspectedAt
                    ? formatThaiDateTime(inspection.inspectedAt)
                    : '-'}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className={styles.printSection}>
          <h2 className={styles.sectionTitle}>📦 รายการสินค้า</h2>
          <table className={styles.itemsTable}>
            <thead>
              <tr>
                <th>#</th>
                <th>รหัส</th>
                <th>ชื่อรายการ</th>
                <th>จำนวน</th>
                <th>รูปตรวจสอบ</th>
              </tr>
            </thead>
            <tbody>
              {inspection.items.map((it, i) => {
                const imgs = inspection.qcImages[it.code] ?? [];
                return (
                  <tr key={it.code + i}>
                    <td>{i + 1}</td>
                    <td>
                      <code>{it.code}</code>
                    </td>
                    <td>{it.name}</td>
                    <td>{it.quantity}</td>
                    <td>
                      <div className={styles.imgRow}>
                        {imgs.length === 0 ? (
                          <span className={styles.noImg}>— ไม่มี —</span>
                        ) : (
                          imgs.map((img) => (
                            <button
                              key={img.fileId}
                              type="button"
                              className={styles.imgThumbBtn}
                              onClick={() =>
                                setLightbox({ src: img.url, alt: img.name || it.name })
                              }
                              aria-label="ดูรูปขนาดเต็ม"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.url} alt={img.name || ''} loading="lazy" />
                            </button>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className={styles.printSection}>
          <h2 className={styles.sectionTitle}>🗂 รูปจากคลัง</h2>
          <RefBlock
            title="🧾 บิล"
            images={inspection.warehouseImages.bill}
            onOpen={(src, alt) => setLightbox({ src, alt })}
          />
          <RefBlock
            title="📄 PO / PX"
            images={inspection.warehouseImages.po}
            onOpen={(src, alt) => setLightbox({ src, alt })}
          />
          <RefBlock
            title="📦 ตัวของ"
            images={inspection.warehouseImages.items}
            onOpen={(src, alt) => setLightbox({ src, alt })}
          />
        </section>
      </div>

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function RefBlock({
  title,
  images,
  onOpen,
}: {
  title: string;
  images: Img[];
  onOpen: (src: string, alt: string) => void;
}) {
  return (
    <div className={styles.refBlock}>
      <div className={styles.refTitle}>
        {title} <span className={styles.refCount}>({images.length})</span>
      </div>
      {images.length === 0 ? (
        <span className={styles.noImg}>— ไม่มี —</span>
      ) : (
        <div className={styles.imgRow}>
          {images.map((img) => (
            <button
              key={img.fileId}
              type="button"
              className={styles.imgThumbBtn}
              onClick={() => onOpen(img.url, img.name || title)}
              aria-label="ดูรูปขนาดเต็ม"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.name || ''} loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
