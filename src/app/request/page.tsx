'use client';
import { useMemo, useRef, useState, useEffect } from 'react';
import useSWR from 'swr';
import styles from './request.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const DEPARTMENTS = [
  'แผนกประกอบ Basevalue',
  'แผนกประกอบใหญ่',
  'แผนกประกอบ Subtank',
  'แผนก CNC',
  'แผนกฟินิช - ชุบ - ขัดกระบอกเงา',
  'แผนกกลึง',
  'แผนกเชื่อม',
  'แผนกTracking',
  'อื่นๆ',
] as const;

type Item = {
  id: string;
  code: string;
  name: string;
  category: string;
  stock: number;
};

type CartEntry = { name: string; quantity: number; maxStock: number };

export default function RequestPage() {
  const { data: items, error } = useSWR<Item[]>('/api/items', fetcher, { refreshInterval: 5000 });

  const [cart, setCart] = useState<Record<string, CartEntry>>({});
  const [form, setForm] = useState({
    department: '',
    customDepartment: '',
    requester_name: '',
    purpose: '',
  });
  const [search, setSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Close suggestions when clicking outside
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
        [item.id]: { name: item.name, quantity: 1, maxStock: item.stock },
      };
    });
    setSearch('');
    setShowSuggestions(false);
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
    !!resolvedDepartment;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    const cartItems = Object.entries(cart).map(([id, entry]) => ({
      item_id: id,
      item_name: entry.name,
      quantity: entry.quantity,
    }));

    try {
      const res = await fetch('/api/requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_name: form.requester_name.trim(),
          department: resolvedDepartment,
          purpose: form.purpose.trim(),
          items: cartItems,
        }),
      });
      if (res.ok) {
        setSuccess(true);
        setCart({});
        setForm({ department: '', customDepartment: '', requester_name: '', purpose: '' });
      } else {
        alert('เกิดข้อผิดพลาดในการส่งคำขอเบิก');
      }
    } catch (err) {
      console.error(err);
      alert('เกิดข้อผิดพลาด');
    }
    setSubmitting(false);
  };

  if (error) return <div className={styles.container}>Failed to load items</div>;
  if (!items) return <div className={styles.container}>Loading...</div>;

  if (success) {
    return (
      <div className={styles.container}>
        <div className={styles.successCard}>
          <div className={styles.iconWrapper}>✅</div>
          <h2>ส่งคำขอเบิกเรียบร้อย!</h2>
          <p>ระบบได้ส่งแจ้งเตือนไปยังคลังสินค้าแล้ว โปรดรอการจัดเตรียมพัสดุ</p>
          <button className={styles.btnPrimary} onClick={() => setSuccess(false)}>
            เบิกพัสดุเพิ่มเติม
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>เบิกจ่ายพัสดุออนไลน์</h1>
        <p>สะดวกรวดเร็ว อัปเดตแบบเรียลไทม์</p>
      </header>

      <form onSubmit={handleSubmit} className={styles.formSection}>
        <div className={styles.card}>
          <h3>ข้อมูลผู้เบิก</h3>
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
              {DEPARTMENTS.map((d) => (
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
            <label>ค้นหารายการสินค้า</label>
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
                    <span>{entry.quantity}</span>
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
    </div>
  );
}
