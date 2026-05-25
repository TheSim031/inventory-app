'use client';
import Link from 'next/link';
import { useCallback, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import { getBangkokDayOfMonth, getBangkokMonthKey } from '@/lib/dateTime';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((r) => r.json());

type MeResponse = {
  isAuthenticated: boolean;
  isCreator: boolean;
  role: string | null;
};

/**
 * Banner that appears on the 1st of every month, reminding warehouse users
 * to clean up the inspection-history sheet. Dismissals are stored in
 * localStorage per-month so it stays hidden until the next month-roll.
 */
export function MonthlyCleanupBanner({ pendingCount }: { pendingCount?: number }) {
  const { data: me } = useSWR<MeResponse>('/api/auth/me', fetcher);
  // Same key shape on every render path so dismissals persist correctly.
  const key = `cleanup-banner-dismissed-${getBangkokMonthKey()}`;

  const subscribe = useCallback((cb: () => void) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('storage', cb);
    return () => window.removeEventListener('storage', cb);
  }, []);
  const getSnapshot = useCallback(
    () => {
      if (typeof window === 'undefined') return true;
      try {
        return window.localStorage.getItem(key) === '1';
      } catch {
        // Firefox strict/private configurations can throw SecurityError
        // when localStorage access is blocked.
        return false;
      }
    },
    [key],
  );
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, () => false);

  if (!me?.isAuthenticated) return null;
  // Show to warehouse role (and the creator, who sees everything).
  const eligible = me.isCreator || me.role === 'WAREHOUSE';
  if (!eligible) return null;

  const isFirstOfMonth = getBangkokDayOfMonth() === 1;
  if (!isFirstOfMonth) return null;
  if (dismissed) return null;
  if (typeof pendingCount === 'number' && pendingCount === 0) return null;

  return (
    <div className="cleanup-banner" role="status">
      <div className="cleanup-banner-icon">🗓</div>
      <div className="cleanup-banner-body">
        <div className="cleanup-banner-title">
          วันที่ 1 ของเดือนแล้ว — ถึงเวลาลบประวัติตรวจสอบ
        </div>
        <div className="cleanup-banner-desc">
          กรุณาเข้าไปคัดเลือกประวัติตรวจสอบที่ไม่จำเป็นเพื่อรักษาพื้นที่จัดเก็บข้อมูล
          {typeof pendingCount === 'number' && (
            <>
              {' '}— ตอนนี้มีทั้งหมด <strong>{pendingCount}</strong> รายการ
            </>
          )}
        </div>
      </div>
      <div className="cleanup-banner-actions">
        <Link href="/inspect/history" className="cleanup-banner-go">
          จัดการประวัติตรวจสอบ →
        </Link>
        <button
          type="button"
          className="cleanup-banner-dismiss"
          onClick={() => {
            if (typeof window !== 'undefined') {
              try {
                window.localStorage.setItem(key, '1');
                // Force re-read so useSyncExternalStore picks it up.
                window.dispatchEvent(new StorageEvent('storage', { key }));
              } catch {
                // Ignore when storage is blocked; banner will continue to show.
              }
            }
          }}
          aria-label="ปิดการแจ้งเตือน"
        >
          ×
        </button>
      </div>
    </div>
  );
}
