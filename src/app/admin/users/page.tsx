'use client';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  USER_ROLES,
  ROLE_LABELS,
  isUserRole,
  type UserRole,
} from '@/lib/userRole';
import { getAllMenuIds, ROLE_MENU_IDS } from '@/lib/menu';
import { formatThaiDateTime } from '@/lib/dateTime';
import styles from './admin-users.module.css';

type CustomGroup = {
  id: string;
  name: string;
  icon: string;
  menuIds: string[];
  baseRole: string;
};

type CustomGroupsResponse = { groups: CustomGroup[] };

export const dynamic = 'force-dynamic';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((r) => r.json());

type AdminUser = {
  lineUserId: string;
  displayName: string;
  role: string;
  firstLogin: string;
  lastLogin: string;
  customMenus: string[];
  notes: string;
};

type UsersResponse = { users: AdminUser[]; error?: string };

export default function AdminUsersPage() {
  const { data, mutate, isLoading } = useSWR<UsersResponse>('/api/admin/users', fetcher);
  const { data: groupsData, mutate: mutateGroups } = useSWR<CustomGroupsResponse>(
    '/api/admin/groups',
    fetcher,
  );

  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editRole, setEditRole] = useState<string>('');
  const [editMenus, setEditMenus] = useState<string[]>([]);
  const [useCustomMenus, setUseCustomMenus] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "เพิ่มกลุ่มใหม่" modal state
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupIcon, setGroupIcon] = useState('👥');
  const [groupBaseRole, setGroupBaseRole] = useState<string>('ASSEMBLY');
  const [groupMenus, setGroupMenus] = useState<string[]>([]);
  const [groupSubmitting, setGroupSubmitting] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const users = useMemo(() => data?.users ?? [], [data?.users]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of users) {
      const k = u.role || 'UNSET';
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }, [users]);

  const openEditor = (u: AdminUser) => {
    setEditing(u);
    setEditRole(u.role);
    setEditMenus(u.customMenus.length ? u.customMenus : []);
    setUseCustomMenus(u.customMenus.length > 0);
    setError(null);
  };

  const closeEditor = () => {
    setEditing(null);
    setError(null);
  };

  const toggleMenu = (id: string) => {
    setEditMenus((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  const handleSave = async () => {
    if (!editing) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineUserId: editing.lineUserId,
          role: editRole,
          customMenus: useCustomMenus ? editMenus : [],
        }),
      });
      if (res.ok) {
        await mutate();
        closeEditor();
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'บันทึกไม่สำเร็จ');
      }
    } catch {
      setError('เชื่อมต่อระบบไม่ได้');
    }
    setSubmitting(false);
  };

  const openAddGroup = () => {
    setGroupName('');
    setGroupIcon('👥');
    setGroupBaseRole('ASSEMBLY');
    setGroupMenus([]);
    setGroupError(null);
    setGroupModalOpen(true);
  };

  const closeAddGroup = () => {
    if (groupSubmitting) return;
    setGroupModalOpen(false);
    setGroupError(null);
  };

  const toggleGroupMenu = (id: string) => {
    setGroupMenus((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  const submitGroup = async () => {
    const name = groupName.trim();
    if (!name) {
      setGroupError('กรุณาระบุชื่อกลุ่ม');
      return;
    }
    if (groupMenus.length === 0) {
      setGroupError('กรุณาเลือกเมนูที่กลุ่มนี้เข้าถึงได้อย่างน้อย 1 รายการ');
      return;
    }
    setGroupSubmitting(true);
    setGroupError(null);
    try {
      const res = await fetch('/api/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          icon: groupIcon,
          menuIds: groupMenus,
          baseRole: groupBaseRole,
        }),
      });
      if (res.ok) {
        await mutateGroups();
        setGroupModalOpen(false);
      } else {
        const j = await res.json().catch(() => ({}));
        setGroupError(j.error || 'สร้างกลุ่มไม่สำเร็จ');
      }
    } catch {
      setGroupError('เชื่อมต่อระบบไม่ได้');
    }
    setGroupSubmitting(false);
  };

  const allMenus = getAllMenuIds(false);
  const previewMenuIds = useCustomMenus
    ? editMenus
    : isUserRole(editRole)
    ? ROLE_MENU_IDS[editRole as UserRole]
    : [];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>
          👥 <span>ข้อมูลผู้ใช้งาน</span>
        </h1>
        <p>
          ประวัติผู้ใช้งานที่ login ผ่าน LINE — จัดการกลุ่ม / เมนูที่เข้าถึงได้รายคน
        </p>
      </header>

      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <strong>{users.length}</strong>
          <span>ผู้ใช้งานทั้งหมด</span>
        </div>
        {USER_ROLES.map((r) => (
          <div key={r} className={styles.summaryCard}>
            <strong>{roleCounts[r] || 0}</strong>
            <span>{ROLE_LABELS[r].th}</span>
          </div>
        ))}
        {roleCounts.UNSET ? (
          <div className={styles.summaryCard}>
            <strong>{roleCounts.UNSET}</strong>
            <span>ยังไม่เลือกกลุ่ม</span>
          </div>
        ) : null}
      </div>

      <section className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <h2>รายชื่อผู้ใช้งาน</h2>
          <button type="button" onClick={openAddGroup} className={styles.btnAddGroup}>
            + เพิ่มกลุ่มใหม่
          </button>
        </div>
        <div className={styles.tableWrap}>
          {isLoading ? (
            <div className={styles.emptyState}>กำลังโหลด...</div>
          ) : users.length === 0 ? (
            <div className={styles.emptyState}>
              ยังไม่มีผู้ใช้ในระบบ — รอให้มีคน login ผ่าน LINE ครั้งแรก
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ผู้ใช้</th>
                  <th>กลุ่ม</th>
                  <th>เมนูที่กำหนดเอง</th>
                  <th>เข้าใช้ล่าสุด</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.lineUserId}>
                    <td>
                      <div className={styles.userCell}>{u.displayName || '(no name)'}</div>
                      <div className={styles.userIdHint}>{u.lineUserId.slice(0, 12)}…</div>
                    </td>
                    <td>
                      {u.role ? (
                        <span className={styles.roleBadge} data-role={u.role}>
                          {isUserRole(u.role)
                            ? `${ROLE_LABELS[u.role as UserRole].icon} ${ROLE_LABELS[u.role as UserRole].th}`
                            : u.role}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          (ยังไม่เลือก)
                        </span>
                      )}
                    </td>
                    <td>
                      {u.customMenus.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          ใช้ค่า default ของกลุ่ม
                        </span>
                      ) : (
                        u.customMenus.map((m) => (
                          <span key={m} className={styles.tag}>
                            {m}
                          </span>
                        ))
                      )}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {u.lastLogin
                        ? formatThaiDateTime(u.lastLogin)
                        : '-'}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => openEditor(u)}
                        className={styles.btnRowEdit}
                      >
                        แก้ไข
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {groupsData?.groups && groupsData.groups.length > 0 && (
        <section className={styles.tableCard}>
          <div className={styles.tableHeader}>
            <h2>กลุ่มกำหนดเอง ({groupsData.groups.length})</h2>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>กลุ่ม</th>
                  <th>Base Role</th>
                  <th>เมนูที่อนุญาต</th>
                  <th>สร้างเมื่อ</th>
                </tr>
              </thead>
              <tbody>
                {groupsData.groups.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <div className={styles.userCell}>
                        <span style={{ marginRight: '0.4rem' }}>{g.icon || '👥'}</span>
                        {g.name}
                      </div>
                      <div className={styles.userIdHint}>{g.id}</div>
                    </td>
                    <td>
                      {isUserRole(g.baseRole)
                        ? `${ROLE_LABELS[g.baseRole as UserRole].icon} ${ROLE_LABELS[g.baseRole as UserRole].th}`
                        : g.baseRole || '-'}
                    </td>
                    <td>
                      {g.menuIds.map((m) => (
                        <span key={m} className={styles.tag}>
                          {m}
                        </span>
                      ))}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      —
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {groupModalOpen && (
        <div className={styles.drawerBackdrop} onClick={closeAddGroup}>
          <div
            className={styles.drawer}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>+ เพิ่มกลุ่มผู้ใช้งานใหม่</h3>
            <div className={styles.drawerSub}>
              ตั้งชื่อกลุ่มและเลือกเมนูที่ให้กลุ่มนี้เข้าถึงได้ — กลุ่มใหม่จะปรากฏใน
              dropdown ของหน้า /role-select ทันที
            </div>

            {groupError && <div className={styles.errorBanner}>{groupError}</div>}

            <div className={styles.field}>
              <label>ชื่อกลุ่ม *</label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="เช่น Marketing, ฝ่ายขาย, ผู้ตรวจ"
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <label>ไอคอน (อีโมจิ)</label>
              <input
                type="text"
                value={groupIcon}
                onChange={(e) => setGroupIcon(e.target.value)}
                placeholder="👥"
                maxLength={4}
                style={{ width: '6rem' }}
              />
            </div>

            <div className={styles.field}>
              <label>Base Role (สำหรับสิทธิ์ API)</label>
              <select
                value={groupBaseRole}
                onChange={(e) => setGroupBaseRole(e.target.value)}
              >
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r].icon} {ROLE_LABELS[r].th}
                  </option>
                ))}
              </select>
              <p className={styles.menuHint}>
                กลุ่มกำหนดเองจะใช้สิทธิ์ระดับ API ตาม base role นี้
              </p>
            </div>

            <div className={styles.field}>
              <label>เมนูที่อนุญาต *</label>
              <div className={styles.menuList}>
                {allMenus.map((m) => (
                  <label
                    key={m.id}
                    className={`${styles.menuRow}${m.parentLabel ? ' ' + styles.menuRowChild : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={groupMenus.includes(m.id)}
                      onChange={() => toggleGroupMenu(m.id)}
                    />
                    <span>
                      {m.parentLabel ? `↳ ${m.label}` : m.label}
                    </span>
                  </label>
                ))}
              </div>
              <p className={styles.menuHint}>
                เลือกแล้ว: {groupMenus.join(', ') || '(ยังไม่เลือก)'}
              </p>
            </div>

            <div className={styles.drawerActions}>
              <button
                type="button"
                onClick={closeAddGroup}
                disabled={groupSubmitting}
                className={styles.btnCancel}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={submitGroup}
                disabled={groupSubmitting}
                className={styles.btnSave}
              >
                {groupSubmitting ? '⏳ กำลังบันทึก...' : '✓ บันทึกกลุ่มใหม่'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className={styles.drawerBackdrop} onClick={closeEditor}>
          <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
            <h3>แก้ไข — {editing.displayName || '(no name)'}</h3>
            <div className={styles.drawerSub}>
              LINE User ID: <code>{editing.lineUserId}</code>
            </div>

            {error && <div className={styles.errorBanner}>{error}</div>}

            <div className={styles.field}>
              <label>กลุ่มประเภทผู้ใช้งาน</label>
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
              >
                <option value="">(ยังไม่เลือก)</option>
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r].icon} {ROLE_LABELS[r].th} ({ROLE_LABELS[r].en})
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label>
                เมนูที่เข้าถึงได้
              </label>
              <label
                className={styles.menuRow}
                style={{ marginBottom: '0.4rem', background: 'var(--bg-color)' }}
              >
                <input
                  type="checkbox"
                  checked={useCustomMenus}
                  onChange={(e) => setUseCustomMenus(e.target.checked)}
                />
                <span>
                  กำหนดเมนูเอง (override ค่า default ของกลุ่ม)
                </span>
              </label>

              {useCustomMenus && (
                <div className={styles.menuList}>
                  {allMenus.map((m) => (
                    <label
                      key={m.id}
                      className={`${styles.menuRow}${m.parentLabel ? ' ' + styles.menuRowChild : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={editMenus.includes(m.id)}
                        onChange={() => toggleMenu(m.id)}
                      />
                      <span>
                        {m.parentLabel ? `↳ ${m.label}` : m.label}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <p className={styles.menuHint}>
                {useCustomMenus
                  ? `เมนูที่กำหนดเอง: ${editMenus.join(', ') || '(ยังไม่เลือก)'}`
                  : `ใช้ default ของกลุ่ม "${
                      isUserRole(editRole)
                        ? ROLE_LABELS[editRole as UserRole].th
                        : '-'
                    }": ${previewMenuIds.join(', ') || '(ไม่มีเมนู)'}`}
              </p>
            </div>

            <div className={styles.drawerActions}>
              <button
                type="button"
                onClick={closeEditor}
                className={styles.btnCancel}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={submitting}
                className={styles.btnSave}
              >
                {submitting ? '⏳ กำลังบันทึก...' : '✓ บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
