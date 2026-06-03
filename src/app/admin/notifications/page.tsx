'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { ROLE_LABELS, isUserRole, type UserRole } from '@/lib/userRole';
import styles from './admin-notifications.module.css';

export const dynamic = 'force-dynamic';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((r) => r.json());

type NotifType = {
  key: string;
  label: string;
  description: string;
  delivery: 'broadcast' | 'personal';
  defaultGroups: string[];
};

type NotifUser = { lineUserId: string; displayName: string; role: string };
type UserOverride = { lineUserId: string; key: string; enabled: boolean };

type LoadResponse = {
  types: NotifType[];
  roles: UserRole[];
  groupMatrix: Record<string, Record<string, boolean>>;
  users: NotifUser[];
  userOverrides: UserOverride[];
  error?: string;
};

type Tab = 'group' | 'user';
type UserSetting = 'default' | 'on' | 'off';

function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      className={`${styles.toggle}${on ? ' ' + styles.toggleOn : ''}`}
    >
      <span className={styles.toggleKnob} />
    </button>
  );
}

export default function AdminNotificationsPage() {
  const { data, mutate, isLoading } = useSWR<LoadResponse>(
    '/api/admin/notifications',
    fetcher,
  );

  const [tab, setTab] = useState<Tab>('group');

  // ── Group matrix local edit state ──
  const [matrix, setMatrix] = useState<Record<string, Record<string, boolean>>>(
    {},
  );
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupMsg, setGroupMsg] = useState<string | null>(null);
  const [groupErr, setGroupErr] = useState<string | null>(null);

  // ── Per-user override state ──
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<NotifUser | null>(null);
  const [userSettings, setUserSettings] = useState<Record<string, UserSetting>>(
    {},
  );
  const [savingUser, setSavingUser] = useState(false);
  const [userMsg, setUserMsg] = useState<string | null>(null);
  const [userErr, setUserErr] = useState<string | null>(null);

  const types = data?.types ?? [];
  const roles = data?.roles ?? [];

  // Seed the matrix edit copy the first time data arrives (or after a reload
  // when the local copy hasn't been touched).
  const effectiveMatrix = useMemo(() => {
    if (matrixDirty) return matrix;
    return data?.groupMatrix ?? {};
  }, [matrixDirty, matrix, data?.groupMatrix]);

  const toggleCell = (key: string, role: string) => {
    const base = matrixDirty ? matrix : data?.groupMatrix ?? {};
    const next: Record<string, Record<string, boolean>> = {};
    for (const t of types) {
      next[t.key] = { ...(base[t.key] ?? {}) };
    }
    next[key] = { ...(next[key] ?? {}) };
    next[key][role] = !next[key][role];
    setMatrix(next);
    setMatrixDirty(true);
    setGroupMsg(null);
  };

  const saveGroup = async () => {
    setSavingGroup(true);
    setGroupErr(null);
    setGroupMsg(null);
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupMatrix: effectiveMatrix }),
      });
      if (res.ok) {
        await mutate();
        setMatrixDirty(false);
        setGroupMsg('บันทึกสิทธิ์ระดับกลุ่มเรียบร้อยแล้ว');
      } else {
        const j = await res.json().catch(() => ({}));
        setGroupErr(j.error || 'บันทึกไม่สำเร็จ');
      }
    } catch {
      setGroupErr('เชื่อมต่อระบบไม่ได้');
    }
    setSavingGroup(false);
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.users ?? [];
    if (!q) return list;
    return list.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.lineUserId.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    );
  }, [search, data?.users]);

  const openUser = (u: NotifUser) => {
    const overrides = data?.userOverrides ?? [];
    const settings: Record<string, UserSetting> = {};
    for (const t of types) {
      const ov = overrides.find(
        (o) => o.lineUserId === u.lineUserId && o.key === t.key,
      );
      settings[t.key] = ov ? (ov.enabled ? 'on' : 'off') : 'default';
    }
    setSelectedUser(u);
    setUserSettings(settings);
    setUserMsg(null);
    setUserErr(null);
  };

  const setUserType = (key: string, setting: UserSetting) => {
    setUserSettings((prev) => ({ ...prev, [key]: setting }));
    setUserMsg(null);
  };

  const saveUser = async () => {
    if (!selectedUser) return;
    setSavingUser(true);
    setUserErr(null);
    setUserMsg(null);
    const overrides: Record<string, boolean> = {};
    for (const [key, setting] of Object.entries(userSettings)) {
      if (setting === 'on') overrides[key] = true;
      else if (setting === 'off') overrides[key] = false;
    }
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineUserId: selectedUser.lineUserId,
          displayName: selectedUser.displayName,
          overrides,
        }),
      });
      if (res.ok) {
        await mutate();
        setUserMsg('บันทึกสิทธิ์เฉพาะบุคคลเรียบร้อยแล้ว');
      } else {
        const j = await res.json().catch(() => ({}));
        setUserErr(j.error || 'บันทึกไม่สำเร็จ');
      }
    } catch {
      setUserErr('เชื่อมต่อระบบไม่ได้');
    }
    setSavingUser(false);
  };

  const roleLabel = (role: string) =>
    isUserRole(role)
      ? `${ROLE_LABELS[role as UserRole].icon} ${ROLE_LABELS[role as UserRole].th}`
      : role || '(ยังไม่เลือก)';

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>
          🔔 <span>การแก้ไขการแจ้งเตือน</span>
        </h1>
        <p>
          เปิด/ปิดสิทธิ์การรับแจ้งเตือน LINE ของแต่ละกลุ่ม
          และปรับแต่งเฉพาะรายบุคคลเป็นกรณีพิเศษ
        </p>
      </header>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tabBtn}${tab === 'group' ? ' ' + styles.tabBtnActive : ''}`}
          onClick={() => setTab('group')}
        >
          🗂 ระดับกลุ่ม
        </button>
        <button
          type="button"
          className={`${styles.tabBtn}${tab === 'user' ? ' ' + styles.tabBtnActive : ''}`}
          onClick={() => setTab('user')}
        >
          👤 รายบุคคล
        </button>
      </div>

      {isLoading ? (
        <div className={styles.emptyState}>กำลังโหลด...</div>
      ) : data?.error ? (
        <div className={styles.errorBanner}>{data.error}</div>
      ) : tab === 'group' ? (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>สิทธิ์รับแจ้งเตือนของแต่ละกลุ่ม</h2>
            <button
              type="button"
              onClick={saveGroup}
              disabled={savingGroup || !matrixDirty}
              className={styles.btnSave}
            >
              {savingGroup ? '⏳ กำลังบันทึก...' : '✓ บันทึก'}
            </button>
          </div>

          {groupErr && <div className={styles.errorBanner}>{groupErr}</div>}
          {groupMsg && <div className={styles.successBanner}>{groupMsg}</div>}

          <div className={styles.tableWrap}>
            <table className={styles.matrix}>
              <thead>
                <tr>
                  <th className={styles.typeCol}>ประเภทการแจ้งเตือน</th>
                  {roles.map((r) => (
                    <th key={r} className={styles.roleCol}>
                      <span className={styles.roleColInner}>{roleLabel(r)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t.key}>
                    <td className={styles.typeCol}>
                      <div className={styles.typeLabel}>
                        {t.label}
                        {t.delivery === 'personal' && (
                          <span className={styles.tagPersonal}>ส่วนตัว</span>
                        )}
                      </div>
                      <div className={styles.typeDesc}>{t.description}</div>
                    </td>
                    {roles.map((r) => (
                      <td key={r} className={styles.cell}>
                        <Toggle
                          on={!!effectiveMatrix[t.key]?.[r]}
                          onChange={() => toggleCell(t.key, r)}
                          disabled={savingGroup}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.hint}>
            สวิตช์สีแดง = กลุ่มนี้จะได้รับการแจ้งเตือนประเภทนั้น —
            ค่าที่ต่างจากค่าเริ่มต้นของระบบจะถูกบันทึกลงตารางระบบ (ไม่ยุ่งกับชีตสต็อก)
          </p>
        </section>
      ) : (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>ปรับแต่งสิทธิ์เฉพาะบุคคล</h2>
          </div>

          <div className={styles.field}>
            <input
              type="text"
              className={styles.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาผู้ใช้ตามชื่อ / กลุ่ม / LINE ID"
            />
          </div>

          <div className={styles.userPicker}>
            {filteredUsers.length === 0 ? (
              <div className={styles.emptyState}>ไม่พบผู้ใช้</div>
            ) : (
              filteredUsers.map((u) => (
                <button
                  type="button"
                  key={u.lineUserId}
                  onClick={() => openUser(u)}
                  className={`${styles.userRow}${
                    selectedUser?.lineUserId === u.lineUserId
                      ? ' ' + styles.userRowActive
                      : ''
                  }`}
                >
                  <span className={styles.userName}>
                    {u.displayName || '(no name)'}
                  </span>
                  <span className={styles.userRole}>{roleLabel(u.role)}</span>
                </button>
              ))
            )}
          </div>

          {selectedUser && (
            <div className={styles.userDetail}>
              <div className={styles.userDetailHead}>
                <div>
                  <div className={styles.userDetailName}>
                    {selectedUser.displayName || '(no name)'}
                  </div>
                  <div className={styles.userDetailSub}>
                    กลุ่ม: {roleLabel(selectedUser.role)} ·{' '}
                    <code>{selectedUser.lineUserId.slice(0, 14)}…</code>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={saveUser}
                  disabled={savingUser}
                  className={styles.btnSave}
                >
                  {savingUser ? '⏳ กำลังบันทึก...' : '✓ บันทึก'}
                </button>
              </div>

              {userErr && <div className={styles.errorBanner}>{userErr}</div>}
              {userMsg && <div className={styles.successBanner}>{userMsg}</div>}

              <div className={styles.overrideList}>
                {types.map((t) => {
                  const groupDefault = isUserRole(selectedUser.role)
                    ? !!effectiveMatrix[t.key]?.[selectedUser.role]
                    : null;
                  const setting = userSettings[t.key] ?? 'default';
                  return (
                    <div key={t.key} className={styles.overrideRow}>
                      <div className={styles.overrideInfo}>
                        <div className={styles.typeLabel}>{t.label}</div>
                        <div className={styles.typeDesc}>
                          ค่าตามกลุ่ม:{' '}
                          {groupDefault === null
                            ? '—'
                            : groupDefault
                              ? 'เปิด'
                              : 'ปิด'}
                        </div>
                      </div>
                      <div className={styles.segment}>
                        {(['default', 'on', 'off'] as UserSetting[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setUserType(t.key, s)}
                            className={`${styles.segBtn}${
                              setting === s ? ' ' + styles.segBtnActive : ''
                            }${s === 'on' ? ' ' + styles.segOn : ''}${
                              s === 'off' ? ' ' + styles.segOff : ''
                            }`}
                          >
                            {s === 'default'
                              ? 'ตามกลุ่ม'
                              : s === 'on'
                                ? 'เปิด'
                                : 'ปิด'}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className={styles.hint}>
                &quot;ตามกลุ่ม&quot; = ใช้ค่าของกลุ่มตามแท็บระดับกลุ่ม ·
                &quot;เปิด/ปิด&quot; = บังคับสิทธิ์เฉพาะผู้ใช้รายนี้
                ไม่ขึ้นกับกลุ่ม
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
