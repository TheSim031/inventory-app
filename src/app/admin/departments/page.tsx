'use client';
import { useState } from 'react';
import useSWR from 'swr';
import styles from './admin-departments.module.css';

export const dynamic = 'force-dynamic';

const fetcher = (url: string) =>
  fetch(url, { cache: 'no-store' }).then((r) => r.json());

type Department = { sheetRow: number; name: string };
type DepartmentsResponse = { departments: Department[]; error?: string };

export default function AdminDepartmentsPage() {
  const { data, mutate, isLoading } = useSWR<DepartmentsResponse>(
    '/api/admin/departments',
    fetcher,
  );
  const departments = data?.departments ?? [];

  const [editing, setEditing] = useState<Record<number, string>>({});
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (d: Department) => {
    setEditing((prev) => ({ ...prev, [d.sheetRow]: d.name }));
  };

  const cancelEdit = (sheetRow: number) => {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[sheetRow];
      return next;
    });
  };

  const saveEdit = async (sheetRow: number) => {
    const name = (editing[sheetRow] || '').trim();
    if (!name) {
      setError('กรุณาระบุชื่อแผนก');
      return;
    }
    setSavingRow(sheetRow);
    setError(null);
    try {
      const res = await fetch('/api/admin/departments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetRow, name }),
      });
      if (res.ok) {
        await mutate();
        cancelEdit(sheetRow);
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'แก้ไขไม่สำเร็จ');
      }
    } catch {
      setError('เชื่อมต่อระบบไม่ได้');
    }
    setSavingRow(null);
  };

  const addNew = async () => {
    const name = newName.trim();
    if (!name) {
      setError('กรุณาระบุชื่อแผนก');
      return;
    }
    setAddingNew(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setNewName('');
        await mutate();
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error || 'เพิ่มไม่สำเร็จ');
      }
    } catch {
      setError('เชื่อมต่อระบบไม่ได้');
    }
    setAddingNew(false);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>
          🏢 <span>แก้ไขแผนก</span>
        </h1>
        <p>เพิ่ม / แก้ไขรายชื่อแผนกที่ใช้งานในระบบ — รายการนี้จะปรากฏใน dropdown ของหน้าเบิกสินค้า</p>
      </header>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>+ เพิ่มแผนกใหม่</h2>
        <div className={styles.addRow}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="เช่น แผนกบัญชี"
            className={styles.input}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addNew();
            }}
          />
          <button
            type="button"
            onClick={addNew}
            disabled={addingNew || !newName.trim()}
            className={styles.btnAdd}
          >
            {addingNew ? '⏳ กำลังเพิ่ม...' : '+ เพิ่ม'}
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>
          รายการแผนกทั้งหมด ({departments.length})
        </h2>

        {isLoading ? (
          <p className={styles.empty}>กำลังโหลด...</p>
        ) : departments.length === 0 ? (
          <p className={styles.empty}>ยังไม่มีข้อมูลแผนก</p>
        ) : (
          <ul className={styles.list}>
            {departments.map((d) => {
              const isEditing = editing[d.sheetRow] != null;
              return (
                <li key={d.sheetRow} className={styles.row}>
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        value={editing[d.sheetRow]}
                        onChange={(e) =>
                          setEditing((prev) => ({
                            ...prev,
                            [d.sheetRow]: e.target.value,
                          }))
                        }
                        className={styles.input}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(d.sheetRow);
                          if (e.key === 'Escape') cancelEdit(d.sheetRow);
                        }}
                      />
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          onClick={() => saveEdit(d.sheetRow)}
                          disabled={savingRow === d.sheetRow}
                          className={styles.btnSave}
                        >
                          {savingRow === d.sheetRow ? '⏳' : '✓ บันทึก'}
                        </button>
                        <button
                          type="button"
                          onClick={() => cancelEdit(d.sheetRow)}
                          disabled={savingRow === d.sheetRow}
                          className={styles.btnCancel}
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className={styles.deptName}>{d.name}</span>
                      <button
                        type="button"
                        onClick={() => startEdit(d)}
                        className={styles.btnEdit}
                      >
                        แก้ไข
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
