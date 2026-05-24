'use client';
import { useCallback, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export function ToastContainer({
  toasts,
  remove,
}: {
  toasts: Toast[];
  remove: (id: number) => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => remove(t.id)}
          style={{
            padding: '12px 20px',
            borderRadius: 10,
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
            maxWidth: 360,
            letterSpacing: '0.02em',
            boxShadow: '0 6px 20px rgba(0,0,0,0.28)',
            animation: 'toast-slide-in 0.3s ease',
            background:
              t.type === 'success'
                ? 'linear-gradient(135deg,#16a34a,#15803d)'
                : t.type === 'error'
                ? 'linear-gradient(135deg,#dc2626,#991b1b)'
                : 'linear-gradient(135deg,#0a0a0a,#1f1f1f)',
          }}
        >
          {t.type === 'success' ? '✅ ' : t.type === 'error' ? '❌ ' : 'ℹ️ '}
          {t.message}
        </div>
      ))}
      <style>{`
        @keyframes toast-slide-in {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  const remove = useCallback(
    (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [],
  );
  return { toasts, add, remove };
}
