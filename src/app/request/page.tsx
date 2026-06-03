'use client';
import { useMemo, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  broadcastAuthChanged,
  fetchJson,
  isAuthStatus,
  readErrorMessage,
  type ApiError,
} from '@/lib/authClient';
import { bangkokTodayISO } from '@/lib/dateTime';
import { BarcodeScanner } from '@/components/BarcodeScanner';
import styles from './request.module.css';

export const dynamic = 'force-dynamic';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

const FALLBACK_DEPARTMENTS = [
  'แผนกประกอบ Basevalue',
  'แผนกประกอบใหญ่',
  'แผนกประกอบ Subtank',
  'แผนก CNC',
  'แผนกฟินิช - ชุบ - ขัดกระบอกเงา',
  'แผนกกลึง',
  'แผนกเชื่อม',
  'แผนกTracking',
  'อื่นๆ',
];

type DepartmentsResponse = {
  departments: { sheetRow: number; name: string }[];
};

type Item = {
  id: string;
  code: string;
  name: string;
  category: string;
  stock: number;
};

type CartEntry = { code: string; name: string; quantity: number; maxStock: number };

type MeResponse = {
  user: { userId: string; displayName: string; pictureUrl?: string } | null;
  lineLoginEnabled: boolean;
  oaBasicId: string;
};

const FRIEND_ACK_KEY = 'pioneer-oa-friend-added';
const DRAFT_KEY = 'inventory-request-draft-v1';

type RequestForm = {
  department: string;
  customDepartment: string;
  requester_name: string;
  purpose: string;
  requestedDate: string; // YYYY-MM-DD (Bangkok); defaults to today
};

const emptyForm: RequestForm = {
  department: '',
  customDepartment: '',
  requester_name: '',
  purpose: '',
  requestedDate: '',
};

function readRequestDraft(): { cart: Record<string, CartEntry>; form: RequestForm } {
  if (typeof window === 'undefined') return { cart: {}, form: emptyForm };
  const raw = window.localStorage.getItem(DRAFT_KEY);
  if (!raw) return { cart: {}, form: emptyForm };
  try {
    const draft = JSON.parse(raw) as {
      cart?: Record<string, CartEntry>;
      form?: RequestForm;
    };
    return {
      cart: draft.cart && typeof draft.cart === 'object' ? draft.cart : {},
      form: draft.form && typeof draft.form === 'object' ? draft.form : emptyForm,
    };
  } catch {
    window.localStorage.removeItem(DRAFT_KEY);
    return { cart: {}, form: emptyForm };
  }
}

export default function RequestPage() {
  const draft = useMemo(() => readRequestDraft(), []);
  const [cart, setCart] = useState<Record<string, CartEntry>>(() => draft.cart);
  const [form, setForm] = useState<RequestForm>(() => ({
    ...draft.form,
    // Default the date picker to today's Bangkok date when the user opens the
    // form. Drafts saved before this field existed have it blank.
    requestedDate: draft.form.requestedDate || bangkokTodayISO(),
  }));
  const [search, setSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [friendAcked, setFriendAcked] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.localStorage.getItem(FRIEND_ACK_KEY) === '1',
  );
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const draftReadyRef = useRef(false);

  const { data: meData, mutate: mutateMe } = useSWR<MeResponse>('/api/auth/me', fetcher, {
    onSuccess: (data) => {
      const name = data.user?.displayName;
      if (!name) return;
      setForm((prev) => (prev.requester_name ? prev : { ...prev, requester_name: name }));
    },
  });
  const { data: items, error } = useSWR<Item[]>('/api/items', fetcher, {
    refreshInterval: 5000,
  });
  const { data: deptData } = useSWR<DepartmentsResponse>(
    '/api/admin/departments',
    fetcher,
  );
  const departments = useMemo(() => {
    const fromSheet = deptData?.departments?.map((d) => d.name) ?? [];
    if (fromSheet.length === 0) return FALLBACK_DEPARTMENTS;
    // Always keep "อื่นๆ" as the last option so the custom-department textbox
    // still works for departments the admin hasn't added yet.
    const seen = new Set(fromSheet);
    const ordered = [...fromSheet];
    if (!seen.has('อื่นๆ')) ordered.push('อื่นๆ');
    return ordered;
  }, [deptData]);

  useEffect(() => {
    draftReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!draftReadyRef.current || typeof window === 'undefined') return;
    const hasDraft =
      Object.keys(cart).length > 0 ||
      form.department ||
      form.customDepartment ||
      form.requester_name ||
      form.purpose;
    if (!hasDraft) {
      window.localStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ cart, form }));
  }, [cart, form]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    if (!items || !search.trim()) return [];
    const q = search.trim().toLowerCase();
    return items
      .filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.code || '').toLowerCase().includes(q) ||
          (it.category || '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [items, search]);

  const addToCart = (item: Item) => {
    setCart((prev) => {
      const current = prev[item.id];
      if (current) {
        if (current.quantity >= item.stock) return prev;
        return { ...prev, [item.id]: { ...current, quantity: current.quantity + 1 } };
      }
      if (item.stock <= 0) return prev;
      return {
        ...prev,
        [item.id]: { code: item.code, name: item.name, quantity: 1, maxStock: item.stock },
      };
    });
    setSearch('');
    setShowSuggestions(false);
  };

  // Scanned barcode/QR → match an item by exact code (case-insensitive). On a
  // hit we drop it straight into the cart; otherwise we prefill the search box
  // so the user can see there was no match and adjust.
  const handleScan = (value: string) => {
    setScanOpen(false);
    const code = value.trim().toLowerCase();
    const match = (items ?? []).find(
      (it) => (it.code || '').trim().toLowerCase() === code,
    );
    if (match) {
      if (match.stock <= 0) {
        setScanMsg(`พบ "${match.name}" แต่สินค้าหมด (คงเหลือ 0)`);
        return;
      }
      addToCart(match);
      setScanMsg(`เพิ่ม "${match.name}" จากการสแกนแล้ว`);
    } else {
      setSearch(value.trim());
      setShowSuggestions(true);
      setScanMsg(`ไม่พบรหัส "${value.trim()}" — ลองค้นหาด้วยตนเอง`);
    }
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) => {
      const entry = prev[id];
      if (!entry) return prev;
      const next = entry.quantity + delta;
      if (next <= 0) {
        const rest = { ...prev };
        delete rest[id];
        return rest;
      }
      if (next > entry.maxStock) return prev;
      return { ...prev, [id]: { ...entry, quantity: next } };
    });
  };

  const setQuantity = (id: string, raw: string) => {
    setCart((prev) => {
      const entry = prev[id];
      if (!entry) return prev;
      if (raw === '') return { ...prev, [id]: { ...entry, quantity: 0 } };
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) return prev;
      const clamped = Math.min(n, entry.maxStock);
      return { ...prev, [id]: { ...entry, quantity: clamped } };
    });
  };

  const commitQuantity = (id: string) => {
    setCart((prev) => {
      const entry = prev[id];
      if (!entry) return prev;
      // On blur, drop a line whose quantity has been cleared/zeroed instead
      // of leaving an invalid 0-qty entry in the request.
      if (entry.quantity <= 0) {
        const rest = { ...prev };
        delete rest[id];
        return rest;
      }
      return prev;
    });
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => {
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
  };

  const totalItems = Object.values(cart).reduce((a, b) => a + b.quantity, 0);

  const resolvedDepartment =
    form.department === 'อื่นๆ' ? form.customDepartment.trim() : form.department;

  const canSubmit =
    totalItems > 0 &&
    !submitting &&
    !!form.requester_name.trim() &&
    !!form.purpose.trim() &&
    !!resolvedDepartment &&
    !!form.requestedDate;

  const openConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setShowConfirm(true);
  };

  const handleSubmit = async () => {
    setShowConfirm(false);
    if (!canSubmit) return;

    setSubmitting(true);
    const cartItems = Object.values(cart).map((entry) => ({
      code: entry.code,
      name: entry.name,
      quantity: entry.quantity,
    }));

    try {
      const res = await fetch('/api/requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester: form.requester_name.trim(),
          department: resolvedDepartment,
          purpose: form.purpose.trim(),
          items: cartItems,
          requestedDate: form.requestedDate,
        }),
      });
      if (res.ok) {
        setSuccess(true);
        setCart({});
        setForm({
          department: '',
          customDepartment: '',
          requester_name: meData?.user?.displayName || '',
          purpose: '',
          requestedDate: bangkokTodayISO(),
        });
        if (typeof window !== 'undefined') window.localStorage.removeItem(DRAFT_KEY);
      } else {
        const message = await readErrorMessage(res, 'เกิดข้อผิดพลาดในการส่งคำขอเบิก');
        if (isAuthStatus(res.status)) broadcastAuthChanged('denied');
        alert(
          isAuthStatus(res.status)
            ? `${message}\n\nระบบเก็บข้อมูลที่กรอกไว้ในเครื่องนี้แล้ว กรุณาเข้าสู่ระบบใหม่`
            : message,
        );
      }
    } catch (err) {
      console.error(err);
      const status = (err as ApiError).status;
      if (isAuthStatus(status)) broadcastAuthChanged('denied');
      alert(
        isAuthStatus(status)
          ? 'Session หมดอายุหรือสิทธิ์เปลี่ยนไป ระบบเก็บข้อมูลที่กรอกไว้แล้ว กรุณาเข้าสู่ระบบใหม่'
          : 'เกิดข้อผิดพลาด',
      );
    }
    setSubmitting(false);
  };

  const handleLineLogout = async () => {
    if (!confirm('ออกจากระบบ LINE?')) return;
    await fetch('/api/auth/line/logout', { method: 'POST' });
    mutateMe();
  };

  const ackFriendAdded = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FRIEND_ACK_KEY, '1');
    }
    setFriendAcked(true);
  };

  // ─── Gate: LINE Login required (if env is configured) ───
  if (meData && meData.lineLoginEnabled && !meData.user) {
    return (
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>← กลับหน้าหลัก</Link>
        <div className={styles.gateCard}>
          <div className={styles.gateIcon}>💬</div>
          <h2>เข้าสู่ระบบด้วย LINE</h2>
          <p>
            เพื่อให้เราแจ้งเตือนเมื่อพัสดุของคุณจัดเสร็จ — กรุณาเข้าสู่ระบบด้วย LINE ก่อน
          </p>
          <a
            href={`/api/auth/line?next=${encodeURIComponent('/request')}`}
            className={styles.btnLineLogin}
          >
            <span className={styles.lineIcon}>🟢</span> เข้าสู่ระบบด้วย LINE
          </a>
        </div>
      </div>
    );
  }

  // ─── First-time: prompt to add OA as friend ───
  if (
    meData?.lineLoginEnabled &&
    meData.user &&
    meData.oaBasicId &&
    !friendAcked
  ) {
    // Build add-friend URL from Basic ID. Strip the leading @ for the URL form.
    const idPart = meData.oaBasicId.replace(/^@/, '');
    const addFriendUrl = `https://line.me/R/ti/p/@${idPart}`;
    return (
      <div className={styles.container}>
        <div className={styles.gateCard}>
          <div className={styles.gateIcon}>🤝</div>
          <h2>เพิ่มเพื่อน LINE Official Account</h2>
          <p>
            สวัสดีคุณ <strong>{meData.user.displayName}</strong> — กรุณาเพิ่ม OA ของบริษัทเป็นเพื่อน
            เพื่อให้เราส่งแจ้งเตือนเมื่อพัสดุของคุณจัดเสร็จ
          </p>
          <a
            href={addFriendUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.btnLineLogin}
          >
            ➕ เพิ่มเพื่อน OA
          </a>
          <button
            type="button"
            onClick={ackFriendAdded}
            className={styles.btnGhost}
          >
            เพิ่มแล้ว — ดำเนินการต่อ
          </button>
        </div>
      </div>
    );
  }

  if (isAuthStatus((error as ApiError | undefined)?.status)) {
    return (
      <div className={styles.container}>
        Session หมดอายุหรือสิทธิ์เปลี่ยนไป ข้อมูลที่กรอกไว้ถูกเก็บเป็น draft แล้ว
      </div>
    );
  }
  if (error) return <div className={styles.container}>Failed to load items</div>;
  if (!items) return <div className={styles.container}>Loading...</div>;

  if (success) {
    return (
      <div className={styles.container}>
        <Link href="/" className={styles.backLink}>← กลับหน้าหลัก</Link>
        <div className={styles.successCard}>
          <div className={styles.iconWrapper}>✅</div>
          <h2>ส่งคำขอเบิกเรียบร้อย!</h2>
          <p>เราจะส่งแจ้งเตือนทาง LINE เมื่อเจ้าหน้าที่คลังจัดของเสร็จ</p>
          <button className={styles.btnPrimary} onClick={() => setSuccess(false)}>
            เบิกพัสดุเพิ่มเติม
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <Link href="/" className={styles.backLink}>← กลับหน้าหลัก</Link>
        {meData?.user && (
          <button
            type="button"
            onClick={handleLineLogout}
            className={styles.lineUserPill}
            title="คลิกเพื่อออกจากระบบ LINE"
          >
            🟢 {meData.user.displayName}
          </button>
        )}
      </div>
      <header className={styles.header}>
        <h1>เบิกจ่ายพัสดุออนไลน์</h1>
        <p>สะดวกรวดเร็ว อัปเดตแบบเรียลไทม์</p>
      </header>

      <form onSubmit={openConfirm} className={styles.formSection}>
        <div className={styles.card}>
          <h3>ข้อมูลผู้เบิก</h3>
          <div className={styles.inputGroup}>
            <label>วันที่เบิก</label>
            <input
              required
              type="date"
              value={form.requestedDate}
              onChange={(e) => setForm({ ...form, requestedDate: e.target.value })}
            />
          </div>
          <div className={styles.inputGroup}>
            <label>ชื่อผู้เบิก</label>
            <input
              required
              type="text"
              placeholder="นาย สมมติ รักดี"
              value={form.requester_name}
              onChange={(e) => setForm({ ...form, requester_name: e.target.value })}
            />
          </div>

          <div className={styles.inputGroup}>
            <label>แผนก / ฝ่าย</label>
            <select
              required
              value={form.department}
              onChange={(e) =>
                setForm({ ...form, department: e.target.value, customDepartment: '' })
              }
              className={styles.select}
            >
              <option value="" disabled>
                เลือกแผนก
              </option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {form.department === 'อื่นๆ' && (
            <div className={styles.inputGroup}>
              <label>ระบุชื่อแผนก</label>
              <input
                required
                type="text"
                placeholder="พิมพ์ชื่อแผนกของคุณ"
                value={form.customDepartment}
                onChange={(e) => setForm({ ...form, customDepartment: e.target.value })}
              />
            </div>
          )}

          <div className={styles.inputGroup}>
            <label>วัตถุประสงค์การเบิก</label>
            <textarea
              required
              placeholder="ใช้สำหรับงาน..."
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </div>
        </div>

        <div className={styles.card}>
          <h3>เลือกพัสดุ</h3>

          <div className={styles.inputGroup} ref={searchBoxRef}>
            <div className={styles.searchLabelRow}>
              <label>ค้นหารายการสินค้า</label>
              <button
                type="button"
                className={styles.scanBtn}
                onClick={() => {
                  setScanMsg(null);
                  setScanOpen(true);
                }}
                title="สแกนบาร์โค้ด / QR เพื่อเพิ่มสินค้า"
              >
                📷 สแกน
              </button>
            </div>
            {scanMsg && <div className={styles.scanMsg}>{scanMsg}</div>}
            <div className={styles.searchBox}>
              <input
                type="text"
                placeholder="พิมพ์ชื่อสินค้า / รหัส / ประเภท..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className={styles.suggestionList}>
                  {suggestions.map((it) => {
                    const inCart = cart[it.id]?.quantity ?? 0;
                    const disabled = it.stock <= 0 || inCart >= it.stock;
                    return (
                      <li
                        key={it.id}
                        className={`${styles.suggestionItem} ${disabled ? styles.suggestionDisabled : ''}`}
                        onClick={() => !disabled && addToCart(it)}
                      >
                        <div className={styles.suggestionMain}>
                          <span className={styles.suggestionName}>{it.name}</span>
                          {it.category && (
                            <span className={styles.suggestionCategory}>{it.category}</span>
                          )}
                        </div>
                        <span
                          className={
                            it.stock > 0 ? styles.stockText : styles.outOfStock
                          }
                        >
                          {it.stock > 0 ? `คงเหลือ ${it.stock}` : 'หมด'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {showSuggestions && search.trim() && suggestions.length === 0 && (
                <ul className={styles.suggestionList}>
                  <li className={styles.suggestionEmpty}>ไม่พบรายการที่ตรงกับ &quot;{search}&quot;</li>
                </ul>
              )}
            </div>
          </div>

          {scanOpen && (
            <BarcodeScanner
              title="สแกนเพื่อเพิ่มสินค้า"
              onDetect={handleScan}
              onClose={() => setScanOpen(false)}
            />
          )}

          {Object.keys(cart).length > 0 ? (
            <div className={styles.itemList}>
              {Object.entries(cart).map(([id, entry]) => (
                <div key={id} className={styles.itemRow}>
                  <div className={styles.itemInfo}>
                    <h4>{entry.name}</h4>
                    <span className={styles.stockText}>คงเหลือสูงสุด: {entry.maxStock}</span>
                  </div>
                  <div className={styles.quantityControl}>
                    <button type="button" onClick={() => updateQuantity(id, -1)}>
                      -
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={entry.maxStock}
                      value={entry.quantity}
                      onChange={(e) => setQuantity(id, e.target.value)}
                      onBlur={() => commitQuantity(id)}
                      onFocus={(e) => e.currentTarget.select()}
                      className={styles.quantityInput}
                      aria-label={`จำนวนของ ${entry.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => updateQuantity(id, 1)}
                      disabled={entry.quantity >= entry.maxStock}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeFromCart(id)}
                      aria-label="ลบรายการ"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.emptyCart}>
              ยังไม่ได้เลือกสินค้า — พิมพ์ค้นหาด้านบนเพื่อเพิ่มรายการ
            </p>
          )}
        </div>

        <button type="submit" className={styles.submitBtn} disabled={!canSubmit}>
          {submitting ? 'กำลังส่งคำขอ...' : `ยืนยันการเบิกพัสดุ (${totalItems} ชิ้น)`}
        </button>
      </form>

      {showConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-title">📋 ยืนยันการส่งใบเบิก</div>
            <div className="modal-body">
              คุณกำลังจะส่งใบเบิกพัสดุ <strong>{totalItems}</strong> ชิ้น
              ({Object.keys(cart).length} รายการ) — <strong>ยืนยันการส่งใบเบิกหรือไม่?</strong>
              <br />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                หลังกดยืนยันระบบจะส่งใบเบิกไปยังคลังสินค้าเพื่อจัดของให้คุณ
              </span>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn-no"
                onClick={() => setShowConfirm(false)}
                disabled={submitting}
              >
                ไม่ใช่
              </button>
              <button
                type="button"
                className="modal-btn modal-btn-yes"
                onClick={handleSubmit}
                disabled={submitting}
              >
                ใช่ ส่งใบเบิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
