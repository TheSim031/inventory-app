'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { broadcastAuthChanged, isAuthStatus } from '@/lib/authClient';

export type UploadedImage = {
  fileId: string;
  url: string;
  name?: string;
};

/**
 * Image staged in the browser but not yet uploaded. Holds the raw File so
 * we can compress/upload it later (on form submit) and a blob preview URL
 * so the thumbnail renders without a round-trip to the server.
 */
export type LocalImage = {
  uid: string;
  file: File;
  previewUrl: string;
};

const ACCEPT_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const MAX_UPLOAD_FILES_PER_BATCH = 30;
const MAX_UPLOAD_RAW_BYTES_PER_BATCH = 180 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 45_000;

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((payload.length * 3) / 4);
}

function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    window.clearTimeout(timeout),
  );
}

/**
 * Resize/compress a raw image File into a base64 JPEG/PNG data URL no larger
 * than ~1500px on the long edge. Cuts upload size dramatically when users
 * snap 12MP photos from a phone camera. Throws if the file is implausibly
 * huge (would crash the canvas).
 */
async function compressImage(
  file: File,
): Promise<{ base64: string; mimeType: string }> {
  const maxSide = 1280;
  // Hard cap on raw pixel count so a malicious / mistaken 40k×40k image
  // doesn't OOM the tab inside drawImage().
  const MAX_PIXELS = 80_000_000; // ~80MP, plenty for any phone/DSLR

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('โหลดรูปไม่ได้'));
    el.src = dataUrl;
  });

  if (img.width * img.height > MAX_PIXELS) {
    throw new Error('รูปใหญ่เกินไป (เกิน 80 ล้านพิกเซล)');
  }

  const longest = Math.max(img.width, img.height);
  const scale = longest > maxSide ? maxSide / longest : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  if (scale === 1 && file.type !== 'image/png' && file.size < 1_200_000) {
    return { base64: dataUrl, mimeType: 'image/jpeg' };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { base64: dataUrl, mimeType: file.type || 'image/jpeg' };
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const outMime = 'image/jpeg';
    const qualities = [0.82, 0.74, 0.66, 0.58];
    let out = canvas.toDataURL(outMime, qualities[0]);
    for (const quality of qualities.slice(1)) {
      if (dataUrlBytes(out) <= 1_500_000) break;
      out = canvas.toDataURL(outMime, quality);
    }
    return { base64: out, mimeType: outMime };
  } catch (err) {
    throw new Error(
      err instanceof Error ? `บีบอัดรูปไม่สำเร็จ: ${err.message}` : 'บีบอัดรูปไม่สำเร็จ',
    );
  }
}

export type UploadProgress = {
  total: number;
  done: number;
  failures: { file: string; error: string }[];
};

/**
 * Upload every staged LocalImage to /api/uploads, returning the resulting
 * Drive references. Errors per-file are collected — the caller can decide
 * whether a partial success is acceptable.
 *
 * Sequential rather than parallel so we don't blast Drive with N concurrent
 * uploads (its per-user rate limit will start rejecting).
 */
export async function uploadLocalImages(
  local: LocalImage[],
  onProgress?: (p: UploadProgress) => void,
): Promise<{ uploaded: UploadedImage[]; failures: UploadProgress['failures'] }> {
  const uploaded: UploadedImage[] = [];
  const failures: UploadProgress['failures'] = [];
  const rawBytes = local.reduce((sum, img) => sum + img.file.size, 0);
  if (local.length > MAX_UPLOAD_FILES_PER_BATCH) {
    return {
      uploaded,
      failures: [
        {
          file: 'ทั้งหมด',
          error: `แนบได้ครั้งละไม่เกิน ${MAX_UPLOAD_FILES_PER_BATCH} รูป — ตอนนี้เลือก ${local.length} รูป`,
        },
      ],
    };
  }
  if (rawBytes > MAX_UPLOAD_RAW_BYTES_PER_BATCH) {
    return {
      uploaded,
      failures: [
        {
          file: 'ทั้งหมด',
          error: 'ขนาดรูปก่อนบีบอัดรวมกันเกิน 180MB — กรุณาลดจำนวนรูปแล้วลองใหม่',
        },
      ],
    };
  }
  let done = 0;
  for (const l of local) {
    try {
      const { base64, mimeType } = await compressImage(l.file);
      const res = await fetchWithTimeout(
        '/api/uploads',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64, mimeType, filename: l.file.name }),
        },
        UPLOAD_TIMEOUT_MS,
      );
      const data = (await res.json().catch(() => ({}))) as
        | UploadedImage
        | { error?: string };
      if (!res.ok || !('fileId' in data)) {
        if (isAuthStatus(res.status)) broadcastAuthChanged('denied');
        failures.push({
          file: l.file.name,
          error: ('error' in data && data.error) || `อัปโหลดล้มเหลว (${res.status})`,
        });
      } else {
        uploaded.push(data);
      }
    } catch (err) {
      failures.push({
        file: l.file.name,
        error:
          err instanceof DOMException && err.name === 'AbortError'
            ? 'อัปโหลดช้าเกิน 45 วินาที — ตรวจเน็ตแล้วลองใหม่'
            : err instanceof Error
            ? err.message
            : 'อัปโหลดล้มเหลว',
      });
    }
    done += 1;
    onProgress?.({ total: local.length, done, failures });
  }
  return { uploaded, failures };
}

export type ImagePickerProps = {
  label: string;
  images: LocalImage[];
  onChange: (next: LocalImage[]) => void;
  /** small variant for embedding inside item rows */
  compact?: boolean;
  disabled?: boolean;
};

let pickerUidCounter = 0;
function newUid(): string {
  pickerUidCounter += 1;
  return `li-${Date.now()}-${pickerUidCounter}`;
}

export function ImagePicker({
  label,
  images,
  onChange,
  compact,
  disabled,
}: ImagePickerProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const ownedUrls = useRef<Set<string>>(new Set());

  // Revoke any blob URLs this picker created when it unmounts so we don't
  // leak browser memory if the user navigates away without saving.
  useEffect(() => {
    const owned = ownedUrls.current;
    return () => {
      owned.forEach((u) => URL.revokeObjectURL(u));
      owned.clear();
    };
  }, []);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      const accepted: LocalImage[] = [];
      const rejected: string[] = [];
      for (const f of files) {
        if (!ACCEPT_MIME.has(f.type.toLowerCase())) {
          rejected.push(f.name);
          continue;
        }
        const previewUrl = URL.createObjectURL(f);
        ownedUrls.current.add(previewUrl);
        accepted.push({ uid: newUid(), file: f, previewUrl });
      }
      if (rejected.length > 0) {
        setError(
          `ไฟล์ไม่รองรับ (รับเฉพาะ .jpg, .jpeg, .png): ${rejected.join(', ')}`,
        );
      } else {
        setError(null);
      }
      if (accepted.length > 0) {
        onChange([...images, ...accepted]);
      }
    },
    [images, onChange],
  );

  const removeAt = (idx: number) => {
    const removed = images[idx];
    if (removed && ownedUrls.current.has(removed.previewUrl)) {
      URL.revokeObjectURL(removed.previewUrl);
      ownedUrls.current.delete(removed.previewUrl);
    }
    onChange(images.filter((_, i) => i !== idx));
  };

  return (
    <div className={`imgpicker${compact ? ' imgpicker-compact' : ''}`}>
      <div className="imgpicker-head">
        <span className="imgpicker-label">{label}</span>
        <span className="imgpicker-count">{images.length} รูป</span>
      </div>

      <div className="imgpicker-actions">
        <button
          type="button"
          className="imgpicker-btn imgpicker-btn-camera"
          onClick={() => cameraRef.current?.click()}
          disabled={disabled}
        >
          📷 ถ่ายรูป
        </button>
        <button
          type="button"
          className="imgpicker-btn imgpicker-btn-upload"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          📁 อัปโหลด
        </button>
      </div>

      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {error && <div className="imgpicker-error">{error}</div>}

      {images.length > 0 && (
        <div className="imgpicker-grid">
          {images.map((img, i) => (
            <div key={img.uid} className="imgpicker-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.previewUrl} alt={img.file.name} loading="lazy" />
              <button
                type="button"
                className="imgpicker-del"
                onClick={() => removeAt(i)}
                aria-label="ลบรูป"
                title="ลบรูป"
                disabled={disabled}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
