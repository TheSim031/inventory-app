'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { formatThaiDateTime } from '@/lib/dateTime';
import { downloadCsv, csvDateStamp } from '@/lib/csv';
import styles from './admin-audit.module.css';

export const dynamic = 'force-dynamic';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((r) => r.json());

type AuditRow = {
  timestamp: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  detail: string;
};

type LoadResponse = { rows?: AuditRow[]; error?: string };

const ACTION_LABELS: Record<string, string> = {
  IN_RECORDED: '📥 รับเข้า',
  OUT_RECORDED: '📤 เบิกออก',
  REQ_SUBMITTED: '📝 ส่งใบเบิก',
  PICK_COMPLETE: '✅ จัดของเสร็จ',
  REQ_REJECTED: '🚫 ปฏิเสธใบเบิก',
  THRESHOLD_UPDATE: '🎚 แก้เกณฑ์สต็อก',
  NOTIF_GROUP_UPDATE: '🔔 แจ้งเตือน (กลุ่ม)',
  NOTIF_USER_UPDATE: '🔔 แจ้งเตือน (บุคคล)',
  INSPECT_DELETE: '🗑 ลบประวัติตรวจสอบ',
};

const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;

export default function AdminAuditPage() {
  const { data, isLoading, mutate } = useSWR<LoadResponse>(
    '/api/admin/audit',
    fetcher,
    { refreshInterval: 30000 },
  );

  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);

  const actionsPresent = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.action) set.add(r.action);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (action && r.action !== action) return false;
      if (!q) return true;
      const hay = [r.actor, r.role, r.action, r.target, r.detail]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search, action]);

  const handleExport = () => {
    if (filtered.length === 0) return;
    downloadCsv(
      `audit-log-${csvDateStamp()}.csv`,
      ['เวลา', 'ผู้ใช้', 'กลุ่ม', 'การกระทำ', 'เป้าหมาย', 'รายละเอียด'],
      filtered.map((r) => [
        r.timestamp ? formatThaiDateTime(r.timestamp) : '',
        r.actor,
        r.role,
        actionLabel(r.action),
        r.target,
        r.detail,
      ]),
    );
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>
          🧾 <span>บันทึกการใช้งาน</span>
        </h1>
        <p>
          ประวัติการกระทำสำคัญในระบบ — ใครทำอะไร เมื่อไหร่ (เก็บแบบเพิ่มต่อท้าย
          ไม่กระทบข้อมูลสต็อก)
        </p>
      </header>

      {data?.error ? (
        <div className={styles.errorBanner}>{data.error}</div>
      ) : (
        <section className={styles.card}>
          <div className={styles.toolbar}>
            <input
              type="text"
              className={styles.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 ค้นหา: ผู้ใช้ / เป้าหมาย / รายละเอียด"
            />
            <select
              className={styles.select}
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">ทุกการกระทำ</option>
              {actionsPresent.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
            <div className={styles.spacer} />
            <button
              type="button"
              className={styles.exportBtn}
              onClick={handleExport}
              disabled={filtered.length === 0}
            >
              ⬇ ส่งออก CSV ({filtered.length})
            </button>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={() => mutate()}
              title="รีเฟรช"
            >
              ↻
            </button>
          </div>

          {isLoading ? (
            <p className={styles.empty}>กำลังโหลด...</p>
          ) : rows.length === 0 ? (
            <p className={styles.empty}>ยังไม่มีบันทึกการใช้งาน</p>
          ) : filtered.length === 0 ? (
            <p className={styles.empty}>ไม่พบรายการที่ตรงกับเงื่อนไข</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>ผู้ใช้</th>
                    <th>กลุ่ม</th>
                    <th>การกระทำ</th>
                    <th>เป้าหมาย</th>
                    <th>รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i}>
                      <td className={styles.timeCell}>
                        {r.timestamp ? formatThaiDateTime(r.timestamp) : '-'}
                      </td>
                      <td>{r.actor || '-'}</td>
                      <td>{r.role || '-'}</td>
                      <td>
                        <span className={styles.actionTag}>
                          {actionLabel(r.action)}
                        </span>
                      </td>
                      <td className={styles.targetCell}>{r.target || '-'}</td>
                      <td className={styles.detailCell}>{r.detail || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.hint}>
            แสดงสูงสุด 500 รายการล่าสุด · รีเฟรชอัตโนมัติทุก 30 วินาที
          </p>
        </section>
      )}
    </div>
  );
}
