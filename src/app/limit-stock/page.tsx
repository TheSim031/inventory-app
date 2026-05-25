'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ToastContainer, useToast } from '@/components/Toast';
import { broadcastAuthChanged, fetchJson, isAuthStatus, type ApiError } from '@/lib/authClient';
import type { LimitStockGetResponse, LimitStockItem } from '@/app/api/limit-stock/route';
import styles from './limit-stock.module.css';

export const dynamic = 'force-dynamic';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

type FilterMode = 'all' | 'below' | 'zero' | 'custom';

function statusOf(item: LimitStockItem): 'zero' | 'low' | 'ok' {
  if (item.stock <= 0) return 'zero';
  if (item.stock <= item.threshold) return 'low';
  return 'ok';
}

export default function LimitStockPage() {
  const { data, error, mutate, isLoading } = useSWR<LimitStockGetResponse>(
    '/api/limit-stock',
    fetcher,
    { refreshInterval: 15000 },
  );

  const { toasts, add: addToast, remove: removeToast } = useToast();

  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [saving, setSaving] = useState(false);

  const items = data?.items ?? [];
  const defaultThreshold = data?.defaultThreshold ?? 500;

  const stats = useMemo(() => {
    let zero = 0;
    let low = 0;
    for (const it of items) {
      const s = statusOf(it);
      if (s === 'zero') zero += 1;
      else if (s === 'low') low += 1;
    }
    return { total: items.length, zero, low };
  }, [items]);

  const dirtyCodes = useMemo(() => {
    const out: string[] = [];
    for (const it of items) {
      const draft = drafts[it.code];
      if (draft === undefined) continue;
      if (draft !== it.threshold) out.push(it.code);
    }
    return out;
  }, [drafts, items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (q) {
        const haystack = `${it.code} ${it.name} ${it.category}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filter === 'below') return statusOf(it) !== 'ok';
      if (filter === 'zero') return statusOf(it) === 'zero';
      if (filter === 'custom') return it.custom;
      return true;
    });
  }, [items, search, filter]);

  const apiStatus = (error as ApiError | undefined)?.status;
  const isUnauthorized = isAuthStatus(apiStatus);

  const handleThresholdChange = (code: string, raw: string) => {
    if (raw === '') {
      setDrafts((prev) => ({ ...prev, [code]: 0 }));
      return;
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return;
    setDrafts((prev) => ({ ...prev, [code]: Math.min(n, 9_999_999) }));
  };

  const handleResetAllDrafts = () => {
    setDrafts({});
  };

  const handleResetRow = (code: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  };

  const handleSave = async () => {
    if (dirtyCodes.length === 0) return;
    setSaving(true);
    try {
      const updates = dirtyCodes.map((code) => ({
        code,
        threshold: drafts[code] ?? defaultThreshold,
      }));
      const res = await fetch('/api/limit-stock', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isAuthStatus(res.status)) broadcastAuthChanged('denied');
        addToast(body.error || 'บันทึกเกณฑ์ไม่สำเร็จ', 'error');
        return;
      }
      addToast(
        `✅ บันทึกเกณฑ์เรียบร้อย — แก้ไข ${dirtyCodes.length} รายการ`,
        'success',
      );
      setDrafts({});
      await mutate();
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} remove={removeToast} />

      <header className={styles.header}>
        <h1>
          🚨 <span>LIMIT STOCK</span>
        </h1>
        <p>
          ตั้งเกณฑ์แจ้งเตือนสต็อกต่ำสำหรับฝ่ายจัดซื้อ — ค่าเริ่มต้น{' '}
          <strong>{defaultThreshold}</strong> ชิ้น ระบบจะส่ง LINE ทุกวัน{' '}
          <strong>09:00 น.</strong> และยิงด่วนเมื่อยอดเหลือเป็น 0
        </p>
      </header>

      {isUnauthorized && (
        <div className={styles.warnText}>
          🔒 Session หมดอายุหรือไม่มีสิทธิ์เข้าถึงหน้านี้ — โปรดเข้าสู่ระบบใหม่
        </div>
      )}

      <div className={styles.statsRow}>
        <div className={`${styles.statCard} ${styles.dark}`}>
          <span className={styles.statLabel}>รายการทั้งหมด</span>
          <span className={styles.statValue}>{stats.total}</span>
          <span className={styles.statSub}>ดึงจาก Sheet 1 — สต็อกสินค้า</span>
        </div>
        <div className={`${styles.statCard} ${styles.danger}`}>
          <span className={styles.statLabel}>หมดคลัง (0 ชิ้น)</span>
          <span className={styles.statValue}>{stats.zero}</span>
          <span className={styles.statSub}>ส่งแจ้งเตือนด่วนทันที</span>
        </div>
        <div className={`${styles.statCard} ${styles.warn}`}>
          <span className={styles.statLabel}>ต่ำกว่าเกณฑ์</span>
          <span className={styles.statValue}>{stats.low}</span>
          <span className={styles.statSub}>ส่ง LINE 09:00 น. ทุกวัน</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="ค้นหา รหัส / ชื่อ / ประเภท..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className={`${styles.filterButton}${filter === 'all' ? ' ' + styles.filterButtonActive : ''}`}
          onClick={() => setFilter('all')}
        >
          ทั้งหมด
        </button>
        <button
          type="button"
          className={`${styles.filterButton}${filter === 'below' ? ' ' + styles.filterButtonActive : ''}`}
          onClick={() => setFilter('below')}
        >
          ต่ำกว่าเกณฑ์ ({stats.zero + stats.low})
        </button>
        <button
          type="button"
          className={`${styles.filterButton}${filter === 'zero' ? ' ' + styles.filterButtonActive : ''}`}
          onClick={() => setFilter('zero')}
        >
          หมดคลัง ({stats.zero})
        </button>
        <button
          type="button"
          className={`${styles.filterButton}${filter === 'custom' ? ' ' + styles.filterButtonActive : ''}`}
          onClick={() => setFilter('custom')}
        >
          เกณฑ์ที่ตั้งเอง
        </button>

        <div className={styles.spacer} />

        <div className={styles.bulkActions}>
          {dirtyCodes.length > 0 && (
            <>
              <span className={styles.dirtyBadge}>
                {dirtyCodes.length} รายการรอบันทึก
              </span>
              <button
                type="button"
                className={styles.resetBtn}
                onClick={handleResetAllDrafts}
                disabled={saving}
              >
                ยกเลิก
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={saving || dirtyCodes.length === 0}
          >
            {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึกเกณฑ์ทั้งหมด'}
          </button>
        </div>
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อรายการ</th>
                <th>หมวดหมู่</th>
                <th style={{ textAlign: 'right' }}>คงเหลือ</th>
                <th>สถานะ</th>
                <th style={{ textAlign: 'right' }}>เกณฑ์ขั้นต่ำ</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    ⏳ กำลังโหลดสต็อก...
                  </td>
                </tr>
              )}
              {!isLoading && error && !isUnauthorized && (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    ❌ โหลดข้อมูลไม่สำเร็จ — ลองรีเฟรชอีกครั้ง
                  </td>
                </tr>
              )}
              {!isLoading && !error && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    ไม่พบรายการที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              )}
              {filteredItems.map((it) => {
                const status = statusOf(it);
                const draft = drafts[it.code];
                const currentValue =
                  draft !== undefined ? draft : it.threshold;
                const isDirty = draft !== undefined && draft !== it.threshold;
                const rowClass =
                  status === 'zero'
                    ? styles.rowZero
                    : status === 'low'
                    ? styles.rowLow
                    : '';
                return (
                  <tr key={it.code} className={rowClass}>
                    <td className={styles.codeCell} data-label="รหัส">{it.code}</td>
                    <td className={styles.nameCell} data-label="ชื่อรายการ">
                      {it.name}
                      {it.custom && !isDirty && (
                        <span className={styles.thresholdCustomTag}>
                          ตั้งเอง
                        </span>
                      )}
                    </td>
                    <td data-label="หมวดหมู่">
                      {it.category ? (
                        <span className={styles.categoryPill}>{it.category}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }} data-label="คงเหลือ">
                      <span
                        className={`${styles.stockCell}${
                          status === 'zero'
                            ? ' ' + styles.stockZero
                            : status === 'low'
                            ? ' ' + styles.stockLow
                            : ''
                        }`}
                      >
                        {it.stock.toLocaleString('th-TH')}
                      </span>
                    </td>
                    <td data-label="สถานะ">
                      <span
                        className={`${styles.statusBadge} ${
                          status === 'zero'
                            ? styles.zero
                            : status === 'low'
                            ? styles.low
                            : styles.ok
                        }`}
                      >
                        {status === 'zero'
                          ? 'หมดคลัง'
                          : status === 'low'
                          ? 'ต่ำกว่าเกณฑ์'
                          : 'ปกติ'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }} data-label="เกณฑ์ขั้นต่ำ">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={currentValue}
                        className={`${styles.thresholdInput}${
                          isDirty ? ' ' + styles.thresholdInputDirty : ''
                        }`}
                        onChange={(e) =>
                          handleThresholdChange(it.code, e.target.value)
                        }
                        onDoubleClick={() => handleResetRow(it.code)}
                        title="ดับเบิลคลิกเพื่อยกเลิกการเปลี่ยนแปลงของแถวนี้"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.legend}>
        <span>
          <span
            className={styles.legendDot}
            style={{ background: 'rgba(220, 38, 38, 0.55)' }}
          />
          สีแดง = หมดคลัง (0 ชิ้น) — ส่ง LINE ด่วนทันที
        </span>
        <span>
          <span
            className={styles.legendDot}
            style={{ background: 'rgba(245, 158, 11, 0.55)' }}
          />
          สีเหลือง = ต่ำกว่าเกณฑ์ — รวมในรายงาน 09:00 น.
        </span>
        <span>* การแก้ไขเกณฑ์จะถูกบันทึกในตารางคอนฟิกแยก ไม่กระทบ Sheet 1</span>
      </div>
    </div>
  );
}
