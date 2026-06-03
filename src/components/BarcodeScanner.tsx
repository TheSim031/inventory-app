'use client';
import { useEffect, useRef, useState } from 'react';
import styles from './BarcodeScanner.module.css';

/**
 * Camera barcode / QR scanner modal.
 *
 * Uses the native `BarcodeDetector` API (Chrome / Android WebView / Edge) so
 * we ship zero scanning dependencies. On browsers without it (notably iOS
 * Safari) we fall back to a manual code-entry field, so the feature degrades
 * gracefully instead of breaking. `onDetect` fires once with the decoded
 * string; the caller decides what to do with it and is expected to close.
 */

// Minimal shape of the experimental BarcodeDetector API (not in TS lib yet).
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

const FORMATS = [
  'qr_code',
  'code_128',
  'code_39',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'itf',
  'codabar',
];

export function BarcodeScanner({
  onDetect,
  onClose,
  title = 'สแกนบาร์โค้ด / QR',
}: {
  onDetect: (value: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  // Capability is known at mount — this modal only ever renders client-side
  // (behind a button), so a lazy initializer avoids a setState-in-effect.
  const [supported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector;
    return !!(Ctor && navigator.mediaDevices?.getUserMedia);
  });
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  // Show manual entry when scanning isn't possible or the camera failed.
  const useFallback = !supported || error !== null;

  useEffect(() => {
    if (!supported) return;
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
      .BarcodeDetector!;

    let cancelled = false;
    const detector = new Ctor({ formats: FORMATS });

    const stop = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const tick = async () => {
      const video = videoRef.current;
      if (cancelled || doneRef.current || !video || video.readyState < 2) {
        if (!cancelled) rafRef.current = requestAnimationFrame(tick);
        return;
      }
      try {
        const codes = await detector.detect(video);
        const hit = codes.find((c) => c.rawValue?.trim());
        if (hit && !doneRef.current) {
          doneRef.current = true;
          stop();
          onDetect(hit.rawValue.trim());
          return;
        }
      } catch {
        // transient decode errors are expected between frames — keep going
      }
      if (!cancelled) rafRef.current = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setError('เปิดกล้องไม่สำเร็จ — โปรดอนุญาตการใช้กล้อง หรือกรอกรหัสด้วยตนเอง');
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [onDetect, supported]);

  const submitManual = () => {
    const v = manual.trim();
    if (v) onDetect(v);
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.title}>📷 {title}</span>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="ปิด"
          >
            ✕
          </button>
        </div>

        {useFallback ? (
          <div className={styles.fallback}>
            <p className={styles.fallbackMsg}>
              {error ||
                'อุปกรณ์/เบราว์เซอร์นี้ไม่รองรับการสแกนด้วยกล้อง — กรอกรหัสสินค้าด้วยตนเองได้'}
            </p>
            <div className={styles.manualRow}>
              <input
                type="text"
                className={styles.manualInput}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitManual();
                }}
                placeholder="กรอกรหัสสินค้า / บาร์โค้ด"
                autoFocus
              />
              <button
                type="button"
                className={styles.manualBtn}
                onClick={submitManual}
                disabled={!manual.trim()}
              >
                ใช้รหัสนี้
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.viewport}>
            <video ref={videoRef} className={styles.video} playsInline muted />
            <div className={styles.reticle} />
            <p className={styles.hint}>
              เล็งกล้องไปที่บาร์โค้ดหรือ QR — ระบบจะอ่านอัตโนมัติ
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
