'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getVisibleMenuIds, MENU_ITEMS, type MenuItem } from '@/lib/menu';
import type { UserRole } from '@/lib/userRole';
import styles from './home.module.css';

type Props = {
  role: UserRole | null;
  isCreator: boolean;
  customMenus: string[] | null;
  displayName: string;
  roleLabel: string;
  roleIcon: string;
};

/**
 * Two-layer category menu.
 *
 * Layer 1 — main category cards (sport-themed white/red/black tiles).
 * Layer 2 — slide panel that lists the sub-items of the picked category.
 *
 * Visibility is computed from the user's role + creator flag + per-user
 * override (same logic as MainNav, so the two stay consistent).
 */
export default function HomeMenu({
  role,
  isCreator,
  customMenus,
  displayName,
  roleLabel,
  roleIcon,
}: Props) {
  const visibleIds = useMemo(
    () => new Set(getVisibleMenuIds({ role, isCreator, customMenus })),
    [role, isCreator, customMenus],
  );

  // Only render top-level items whose parent OR at least one child is
  // visible. Leaves (no children) only appear if the leaf itself is visible.
  const cards = useMemo(() => {
    return MENU_ITEMS.filter((item) => {
      if (item.creatorOnly && !isCreator) return false;
      if (item.children?.length) {
        if (visibleIds.has(item.id)) return true;
        return item.children.some(
          (c) => visibleIds.has(c.id) && (!c.creatorOnly || isCreator),
        );
      }
      return visibleIds.has(item.id);
    });
  }, [visibleIds, isCreator]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(
    () => cards.find((c) => c.id === activeId) || null,
    [cards, activeId],
  );

  // Close the slide panel on Escape so keyboard users aren't trapped.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const visibleChildren = (item: MenuItem) =>
    (item.children || []).filter(
      (c) => visibleIds.has(c.id) && (!c.creatorOnly || isCreator),
    );

  const handleCardClick = (item: MenuItem) => {
    const kids = visibleChildren(item);
    // Leaf card → navigate directly. Parent with children → open slide.
    if (kids.length === 0 && item.href) {
      // Allow <Link> wrapping to handle the navigation. No-op here.
      return;
    }
    setActiveId(item.id);
  };

  return (
    <div className={styles.wrap}>
      <header className={styles.hero}>
        <div className={styles.heroStripes} aria-hidden />
        <div className={styles.heroBody}>
          <div className={styles.greet}>
            🟢 สวัสดีคุณ {displayName}
          </div>
          <h1 className={styles.title}>
            PIONEER <span>STOCK</span>
          </h1>
          <div className={styles.roleBadge}>
            <span>{roleIcon}</span>
            <span>กลุ่ม</span>
            <strong>{roleLabel}</strong>
          </div>
          <p className={styles.subtitle}>
            เลือกหมวดหมู่หลักด้านล่างเพื่อเข้าสู่เมนูย่อยของระบบ
          </p>
        </div>
      </header>

      {cards.length === 0 ? (
        <div className={styles.emptyCard}>
          <div className={styles.emptyIcon}>🚫</div>
          <h2>ยังไม่มีเมนูที่เปิดให้กลุ่มของคุณ</h2>
          <p>
            กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์การเข้าถึงเมนู
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {cards.map((item) => {
            const kids = visibleChildren(item);
            const isLeaf = kids.length === 0 && item.href;

            if (isLeaf) {
              return (
                <Link
                  key={item.id}
                  href={item.href!}
                  className={`${styles.card} ${styles.cardLeaf}`}
                >
                  <div className={styles.cardIcon}>{item.icon}</div>
                  <div className={styles.cardLabel}>{item.label}</div>
                  <div className={styles.cardHint}>เข้าสู่หน้า →</div>
                </Link>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleCardClick(item)}
                className={styles.card}
                aria-haspopup="true"
                aria-expanded={activeId === item.id}
              >
                <div className={styles.cardIcon}>{item.icon}</div>
                <div className={styles.cardLabel}>{item.label}</div>
                <div className={styles.cardHint}>
                  {kids.length} เมนู — แตะเพื่อเปิด ▸
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Sub-category slide panel */}
      {active && (
        <div
          className={styles.slideBackdrop}
          onClick={() => setActiveId(null)}
          role="presentation"
        >
          <div
            className={styles.slidePanel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`เมนูย่อยของ ${active.label}`}
          >
            <div className={styles.slideHead}>
              <div className={styles.slideHeadLeft}>
                <span className={styles.slideHeadIcon}>{active.icon}</span>
                <div>
                  <div className={styles.slideHeadKicker}>หมวดหมู่</div>
                  <div className={styles.slideHeadTitle}>{active.label}</div>
                </div>
              </div>
              <button
                type="button"
                className={styles.slideClose}
                onClick={() => setActiveId(null)}
                aria-label="ปิด"
              >
                ✕
              </button>
            </div>

            <div className={styles.slideBody}>
              {visibleChildren(active).map((c) => (
                <Link
                  key={c.id}
                  href={c.href || '#'}
                  className={styles.subItem}
                  onClick={() => setActiveId(null)}
                >
                  <span className={styles.subItemIcon}>{c.icon}</span>
                  <span className={styles.subItemLabel}>{c.label}</span>
                  <span className={styles.subItemArrow}>→</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
