'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import styles from './warehouse.module.css';

const fetcher = (url: string) => fetch(url).then(res => res.json());

/* ─── Domain types ─── */
type RequisitionItem = { item_name: string; quantity: number };
type RequisitionStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';
type Requisition = {
  id: string;
  created_at: string;
  requester_name: string;
  department: string;
  purpose: string;
  status: RequisitionStatus;
  items: RequisitionItem[];
};
type Item = {
  id: string;
  code: string;
  name: string;
  category: string;
  stock: number;
};

/* ─── Toast System ─── */
type ToastType = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; type: ToastType }

function ToastContainer({ toasts, remove }: { toasts: Toast[]; remove: (id: number) => void }) {
  return (
    <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => remove(t.id)} style={{
          padding: '12px 20px',
          borderRadius: 10,
          color: '#fff',
          fontWeight: 600,
          fontSize: 14,
          cursor: 'pointer',
          maxWidth: 360,
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          animation: 'slideIn 0.3s ease',
          background: t.type === 'success' ? 'linear-gradient(135deg,#22c55e,#16a34a)'
                     : t.type === 'error'   ? 'linear-gradient(135deg,#ef4444,#dc2626)'
                     :                        'linear-gradient(135deg,#3b82f6,#1d4ed8)',
        }}>
          {t.type === 'success' ? '✅ ' : t.type === 'error' ? '❌ ' : 'ℹ️ '}{t.message}
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  const remove = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, add, remove };
}

/* ─── Main Page ─── */
export default function WarehousePage() {
  const { data: requisitions, error, mutate } = useSWR<Requisition[]>('/api/requisitions', fetcher, { refreshInterval: 5000 });
  const [processing, setProcessing] = useState<string | null>(null);
  const router = useRouter();
  const { toasts, add: addToast, remove: removeToast } = useToast();

  // Tab
  const [activeTab, setActiveTab] = useState<'requisitions' | 'items'>('requisitions');

  // Add Item State
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', code: '', category: '', stock: 0 });
  const [addingItem, setAddingItem] = useState(false);

  // Items mutate ref (passed from ItemsTable)
  const [itemsMutate, setItemsMutate] = useState<(() => void) | null>(null);

  // File Upload Refs
  const excelRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  const handleComplete = async (req: Requisition) => {
    if (!confirm(`ยืนยันการจัดเตรียมพัสดุสำหรับใบเบิก #${req.id} ?`)) return;
    setProcessing(req.id);
    try {
      const res = await fetch(`/api/requisitions/${req.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED', items: req.items })
      });
      const result = await res.json();
      if (res.ok) {
        mutate();
        itemsMutate?.();
        addToast(`ยืนยันใบเบิก #${req.id} สำเร็จ — ตัดสต๊อกแล้ว`, 'success');
        generatePickListAndLabel(req);
      } else {
        addToast(result.error || 'เกิดข้อผิดพลาด', 'error');
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการตัดสต๊อก', 'error');
    }
    setProcessing(null);
  };

  const handleReject = async (req: Requisition) => {
    if (!confirm(`ต้องการยกเลิกใบเบิก #${req.id} หรือไม่?`)) return;
    setProcessing(req.id);
    try {
      await fetch(`/api/requisitions/${req.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REJECTED' })
      });
      mutate();
      addToast(`ยกเลิกใบเบิก #${req.id} แล้ว`, 'info');
    } catch {
      addToast('เกิดข้อผิดพลาด', 'error');
    }
    setProcessing(null);
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name.trim() || !newItem.code.trim()) {
      addToast('กรุณากรอกรหัสสินค้าและชื่อสินค้า', 'error');
      return;
    }
    setAddingItem(true);
    try {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem)
      });
      if (res.ok) {
        addToast(`เพิ่มสินค้า "${newItem.name}" สำเร็จ!`, 'success');
        setShowAddItem(false);
        setNewItem({ name: '', code: '', category: '', stock: 0 });
        itemsMutate?.();
        setActiveTab('items');
      } else {
        const data = await res.json();
        addToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
    setAddingItem(false);
  };

  /* ─── Excel Upload ─── */
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws);

        if (data.length === 0) {
          addToast('ไม่พบข้อมูลในไฟล์ Excel', 'error');
          setUploading(false);
          return;
        }

        if (!confirm(`พบรายการสินค้า ${data.length} รายการ ต้องการอัปโหลดขึ้น Google Sheets หรือไม่?`)) {
          setUploading(false);
          return;
        }

        const rows = data as Array<Record<string, unknown>>;
        const items = rows.map((row) => {
          const s = (v: unknown): string => (v == null ? '' : String(v));
          return {
            code: s(row['รหัสสินค้า'] || row['Code'] || row['code'] || row['ID']),
            name: s(row['ชื่อสินค้า'] || row['Name'] || row['name']),
            category: s(row['ประเภท'] || row['Category'] || row['category']),
            stock: parseInt(s(row['คงเหลือ'] || row['สต๊อก'] || row['Stock'] || row['stock']) || '0', 10),
          };
        });

        const res = await fetch('/api/items/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items })
        });

        if (res.ok) {
          addToast(`อัปโหลดสินค้า ${items.length} รายการสำเร็จ!`, 'success');
          itemsMutate?.();
          setActiveTab('items');
        } else {
          const resData = await res.json();
          addToast(resData.error || 'อัปโหลดไม่สำเร็จ', 'error');
        }
      } catch (err) {
        console.error(err);
        addToast('รูปแบบไฟล์ไม่ถูกต้อง กรุณาตรวจสอบไฟล์ Excel', 'error');
      }
      setUploading(false);
      if (excelRef.current) excelRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  /* ─── PDF Upload ─── */
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    addToast('กำลังอ่านไฟล์ PDF...', 'info');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/items/upload-pdf', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();

      if (res.ok) {
        addToast(`อ่าน PDF สำเร็จ — เพิ่มสินค้า ${result.count} รายการเข้า Google Sheets แล้ว!`, 'success');
        itemsMutate?.();
        setActiveTab('items');
      } else {
        addToast(result.error || 'อ่านไฟล์ PDF ไม่สำเร็จ', 'error');
        if (result.rawText) {
          console.warn('PDF raw text (first 500 chars):', result.rawText);
          addToast('ดูข้อมูล debug ใน Console (F12) เพื่อตรวจสอบรูปแบบข้อความ', 'info');
        }
      }
    } catch {
      addToast('เกิดข้อผิดพลาดในการส่งไฟล์ PDF', 'error');
    }

    setUploading(false);
    if (pdfRef.current) pdfRef.current.value = '';
  };

  const generatePickListAndLabel = (req: Requisition) => {
    const docPick = new jsPDF();
    docPick.setFontSize(18);
    docPick.text(`Pick List - Requisition #${req.id}`, 14, 20);
    docPick.setFontSize(12);
    docPick.text(`Requester: ${req.requester_name}`, 14, 30);
    docPick.text(`Department: ${req.department}`, 14, 38);
    docPick.text(`Purpose: ${req.purpose}`, 14, 46);
    docPick.text(`Date: ${new Date(req.created_at).toLocaleString()}`, 14, 54);

    const tableData = req.items.map((item, index) => [
      index + 1,
      item.item_name,
      item.quantity,
    ]);

    autoTable(docPick, {
      startY: 60,
      head: [['#', 'Item Name', 'Quantity']],
      body: tableData,
    });

    docPick.save(`PickList_REQ${req.id}.pdf`);

    const docLabel = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [100, 150],
    });

    docLabel.setFontSize(16);
    docLabel.text('REQUISITION LABEL', 10, 15);
    docLabel.setFontSize(14);
    docLabel.text(`Req ID: #${req.id}`, 10, 30);
    docLabel.text(`Name: ${req.requester_name}`, 10, 40);
    docLabel.text(`Dept: ${req.department}`, 10, 50);
    docLabel.setFontSize(12);
    docLabel.text('Items:', 10, 65);
    let y = 75;
    req.items.forEach((item) => {
      docLabel.text(`- ${item.item_name} x${item.quantity}`, 15, y);
      y += 8;
    });

    docLabel.save(`Label_REQ${req.id}.pdf`);
  };

  if (error) return <div className={styles.container}>Failed to load requisitions</div>;
  if (!requisitions) return <div className={styles.container}>Loading...</div>;

  return (
    <div className={styles.container}>
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} remove={removeToast} />

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>

      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <h1>ระบบจัดการคลังสินค้า (Warehouse Dashboard)</h1>
            <p>ตรวจสอบและยืนยันการเบิกพัสดุ</p>
          </div>
          <button className={styles.btnLogout} onClick={handleLogout}>ออกจากระบบ</button>
        </div>

        <div className={styles.toolsBar}>
          <button className={styles.btnAdd} onClick={() => { setShowAddItem(true); }}>
            ➕ เพิ่มสินค้าด้วยตนเอง
          </button>

          {/* Hidden Excel input */}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            ref={excelRef}
            onChange={handleExcelUpload}
          />
          <button
            className={styles.btnUpload}
            onClick={() => excelRef.current?.click()}
            disabled={uploading}
          >
            📊 อัปโหลด Excel
          </button>

          {/* Hidden PDF input */}
          <input
            type="file"
            accept=".pdf"
            style={{ display: 'none' }}
            ref={pdfRef}
            onChange={handlePdfUpload}
          />
          <button
            className={styles.btnUpload}
            style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)' }}
            onClick={() => pdfRef.current?.click()}
            disabled={uploading}
          >
            📄 อัปโหลด PDF
          </button>

          {uploading && (
            <span style={{ color: '#a78bfa', fontWeight: 600, fontSize: 14 }}>
              ⏳ กำลังประมวลผล...
            </span>
          )}
        </div>
      </header>

      {/* Add Item Modal */}
      {showAddItem && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 style={{ marginBottom: 16, fontSize: 20 }}>➕ เพิ่มสินค้าด้วยตนเอง</h3>
            <form onSubmit={handleAddItem}>
              <div className={styles.inputGroup}>
                <label>รหัสสินค้า *</label>
                <input
                  required
                  type="text"
                  value={newItem.code}
                  onChange={e => setNewItem({ ...newItem, code: e.target.value })}
                  placeholder="เช่น ITM-001"
                  autoFocus
                />
              </div>
              <div className={styles.inputGroup}>
                <label>ชื่อสินค้า *</label>
                <input
                  required
                  type="text"
                  value={newItem.name}
                  onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                  placeholder="เช่น กระดาษ A4"
                />
              </div>
              <div className={styles.inputGroup}>
                <label>ประเภท</label>
                <input
                  type="text"
                  value={newItem.category}
                  onChange={e => setNewItem({ ...newItem, category: e.target.value })}
                  placeholder="เช่น อุปกรณ์สำนักงาน"
                />
              </div>
              <div className={styles.inputGroup}>
                <label>จำนวนคงเหลือเริ่มต้น *</label>
                <input
                  required
                  type="number"
                  min="0"
                  value={newItem.stock}
                  onChange={e => setNewItem({ ...newItem, stock: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
              <div className={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => { setShowAddItem(false); setNewItem({ name: '', code: '', category: '', stock: 0 }); }}
                  className={styles.btnCancel}
                >
                  ยกเลิก
                </button>
                <button type="submit" disabled={addingItem} className={styles.btnConfirm}>
                  {addingItem ? '⏳ กำลังบันทึก...' : '💾 บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${activeTab === 'requisitions' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('requisitions')}
        >
          📋 รายการใบเบิก
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'items' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('items')}
        >
          📦 ตารางสินค้าคงคลัง
        </button>
      </div>

      {activeTab === 'requisitions' && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>วันที่</th>
                <th>ผู้เบิก (แผนก)</th>
                <th>รายการพัสดุ</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {requisitions.map((req) => (
                <tr key={req.id}>
                  <td>#{req.id}</td>
                  <td>{new Date(req.created_at).toLocaleString()}</td>
                  <td>
                    <div className={styles.requesterName}>{req.requester_name}</div>
                    <div className={styles.department}>{req.department}</div>
                  </td>
                  <td>
                    <ul className={styles.itemList}>
                      {req.items.map((item, i) => (
                        <li key={i}>{item.item_name} <span className={styles.qty}>x{item.quantity}</span></li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    <span className={`${styles.statusBadge} ${styles[req.status.toLowerCase()]}`}>
                      {req.status}
                    </span>
                  </td>
                  <td>
                    {req.status === 'PENDING' && (
                      <div className={styles.actionButtons}>
                        <button
                          className={styles.btnApprove}
                          onClick={() => handleComplete(req)}
                          disabled={processing === req.id}
                        >
                          {processing === req.id ? 'กำลังประมวลผล...' : 'ยืนยัน & ตัดสต๊อก'}
                        </button>
                        <button
                          className={styles.btnReject}
                          onClick={() => handleReject(req)}
                          disabled={processing === req.id}
                        >
                          ยกเลิก
                        </button>
                      </div>
                    )}
                    {req.status === 'COMPLETED' && (
                      <button
                        className={styles.btnSecondary}
                        onClick={() => generatePickListAndLabel(req)}
                      >
                        พิมพ์ PDF
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {requisitions.length === 0 && (
                <tr>
                  <td colSpan={6} className={styles.emptyState}>ยังไม่มีรายการเบิกพัสดุ หรือยังไม่ได้ตั้งค่า Google Sheets</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'items' && (
        <ItemsTable onMutateReady={setItemsMutate} addToast={addToast} />
      )}
    </div>
  );
}

/* ─── Items Table ─── */
function ItemsTable({
  onMutateReady,
  addToast,
}: {
  onMutateReady: (fn: () => void) => void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}) {
  const { data: items, error, mutate } = useSWR<Item[]>('/api/items', fetcher, { refreshInterval: 10000 });

  // Expose mutate to parent
  useEffect(() => {
    onMutateReady(() => mutate());
  }, [mutate, onMutateReady]);

  if (error) {
    return (
      <div className={styles.emptyState} style={{ padding: 24 }}>
        ❌ โหลดข้อมูลสินค้าไม่ได้ — กรุณาตรวจสอบ:
        <ul style={{ textAlign: 'left', marginTop: 8, lineHeight: 2 }}>
          <li>ชื่อแท็บใน Google Sheets ต้องตรงกับ <code>GOOGLE_SHEET_ITEMS</code> ใน .env.local</li>
          <li>Service Account ต้องได้รับสิทธิ์ <strong>Editor</strong> ใน Google Sheet</li>
        </ul>
      </div>
    );
  }
  if (!items) return <div className={styles.emptyState}>⏳ กำลังโหลดข้อมูลสินค้า...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ color: '#94a3b8', fontSize: 14 }}>
          พบสินค้าทั้งหมด <strong style={{ color: '#e2e8f0' }}>{items.length}</strong> รายการ
        </span>
        <button
          onClick={() => { mutate(); addToast('รีเฟรชข้อมูลแล้ว', 'info'); }}
          style={{
            padding: '6px 16px',
            borderRadius: 8,
            border: '1px solid #4f46e5',
            background: 'transparent',
            color: '#818cf8',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          🔄 รีเฟรช
        </button>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>รหัสสินค้า</th>
              <th>ชื่อสินค้า</th>
              <th>ประเภท</th>
              <th>คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><code style={{ fontSize: 13 }}>{item.code}</code></td>
                <td>{item.name}</td>
                <td>{item.category || <span style={{ color: '#64748b' }}>—</span>}</td>
                <td>
                  <span className={item.stock > 0 ? styles.stockText : styles.outOfStock}>
                    {item.stock}
                  </span>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className={styles.emptyState}>
                  ยังไม่มีรายการสินค้า — ลองกด &quot;เพิ่มสินค้าด้วยตนเอง&quot; หรืออัปโหลด Excel/PDF
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
