'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { broadcastAuthChanged, fetchJson } from '@/lib/authClient';

const fetcher = <T,>(url: string) => fetchJson<T>(url);

type MeResponse = {
  isCreator: boolean;
};

/**
 * The "pharadon thatdua" credit at the bottom-left corner is also a
 * secret login button. Clicking it pops up a password modal that
 * grants the creator/super-admin session, which unlocks every menu
 * plus the user-management admin pages.
 */
export function CreatorCredit() {
  const router = useRouter();
  const { data: me, mutate } = useSWR<MeResponse>('/api/auth/me', fetcher);
  const [showModal, setShowModal] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isCreator = !!me?.isCreator;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setShowModal(false);
        setPassword('');
        await mutate();
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'รหัสไม่ถูกต้อง');
      }
    } catch {
      setError('เชื่อมต่อระบบไม่ได้');
    }
    setSubmitting(false);
  };

  const handleClick = async () => {
    if (isCreator) {
      // Logged in as creator → clicking the badge logs out of creator mode
      if (!confirm('ออกจากโหมด Creator?')) return;
      await fetch('/api/auth/creator', { method: 'DELETE' });
      broadcastAuthChanged('logout');
      await mutate();
      router.refresh();
      return;
    }
    setShowModal(true);
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`creator-credit-btn${isCreator ? ' creator-credit-btn-active' : ''}`}
        aria-label={isCreator ? 'Creator mode active — click to log out' : 'Creator login'}
      >
        {isCreator ? '🔐 creator: pharadon' : 'pharadon thatdua'}
      </button>

      {showModal && (
        <div className="creator-modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="creator-modal" onClick={(e) => e.stopPropagation()}>
            <h3>🔐 Creator Access</h3>
            <p className="creator-modal-sub">
              ใส่รหัสผู้สร้างเพื่อเข้าโหมด admin
            </p>
            <form onSubmit={handleSubmit}>
              {error && <div className="creator-modal-error">{error}</div>}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="รหัสผ่าน"
                className="creator-modal-input"
                autoFocus
                required
              />
              <div className="creator-modal-actions">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="creator-modal-btn creator-modal-btn-cancel"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting || !password}
                  className="creator-modal-btn creator-modal-btn-submit"
                >
                  {submitting ? '⏳ ตรวจสอบ...' : 'เข้าสู่ระบบ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
