'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * Resize/compress a raw image File into a base64 JPEG/PNG data URL no larger
 * than ~1500px on the long edge. Cuts upload size dramatically when users
 * snap 12MP photos from a phone camera. Throws if the file is implausibly
 * huge (would crash the canvas).
 */
async function compressImage(
  file: File,
): Promise<{ base64: string; mimeType: string }> {
  const isPng = file.type === 'image/png';
  const maxSide = 1500;
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

  if (scale === 1 && !isPng && file.size < 1_500_000) {
    return { base64: dataUrl, mimeType: 'image/jpeg' };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { base64: dataUrl, mimeType: file.type || 'image/jpeg' };
    ctx.drawImage(img, 0, 0, w, h);

    const outMime = isPng ? 'image/png' : 'image/jpeg';
    const quality = isPng ? undefined : 0.85;
    const out = canvas.toDataURL(outMime, quality);
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
  let done = 0;
  for (const l of local) {
    try {
      const { base64, mimeType } = await compressImage(l.file);
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mimeType, filename: l.file.name }),
      });
      const data = (await res.json().catch(() => ({}))) as
        | UploadedImage
        | { error?: string };
      if (!res.ok || !('fileId' in data)) {
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
        error: err instanceof Error ? err.message : 'อัปโหลดล้มเหลว',
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
