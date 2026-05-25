import { put, del } from '@vercel/blob';

/**
 * Image storage backend.
 *
 * History: we used Google Drive (Service Account uploads into a shared
 * folder), but Service Accounts have zero storage quota of their own
 * and a folder in a human's My Drive can't grant them quota. The fix
 * Google recommends — Shared Drives — requires paid Workspace. So this
 * app now writes images to Vercel Blob (free tier 500MB, public access,
 * unique URLs) and keeps Drive only as a legacy READ/DELETE path for
 * records uploaded before this switch.
 *
 * Stored shape is unchanged ({ fileId, url, name }) so call sites and
 * the Google Sheet schema stay valid:
 *   - `fileId` is the blob **pathname** (use with `del()`), or the
 *     original Drive file id for legacy rows
 *   - `url` is a public CDN URL (Blob) or `drive.google.com/uc?id=...`
 *     (legacy); both render in <img src=...> without auth
 *   - `name` is the original filename
 */

export type UploadedImage = {
  fileId: string;
  url: string;
  name: string;
};

export type BlobFailureReason =
  | 'NOT_CONFIGURED'  // BLOB_READ_WRITE_TOKEN env missing
  | 'AUTH_DENIED'     // token invalid / store deleted
  | 'TOO_LARGE'       // exceeds plan limit
  | 'UNKNOWN';

export type BlobUploadResult =
  | { ok: true; image: UploadedImage }
  | { ok: false; reason: BlobFailureReason; detail?: string };

function logBlobError(stage: string, error: unknown): void {
  const e = error as {
    message?: string;
    name?: string;
    status?: number;
    statusText?: string;
    code?: string | number;
    stack?: string;
  } | null;
  console.error(`Vercel Blob Error (${stage}):`, {
    name: e?.name,
    message: e?.message,
    code: e?.code,
    status: e?.status,
    statusText: e?.statusText,
  });
  if (e?.stack) console.error(`Vercel Blob Error stack (${stage}):`, e.stack);
}

function classifyBlobError(error: unknown): {
  reason: BlobFailureReason;
  detail?: string;
} {
  const e = error as { message?: string; status?: number; name?: string } | null;
  const msg = (e?.message || String(error || '')).toLowerCase();
  if (msg.includes('blob_read_write_token') || msg.includes('no token')) {
    return {
      reason: 'NOT_CONFIGURED',
      detail:
        'BLOB_READ_WRITE_TOKEN ไม่ได้ตั้ง — เปิด Blob store ใน Vercel dashboard ' +
        '(Storage → Create → Blob) แล้ว Connect ให้ project นี้',
    };
  }
  if (e?.status === 401 || e?.status === 403 || msg.includes('unauthorized') || msg.includes('forbidden')) {
    return {
      reason: 'AUTH_DENIED',
      detail: 'BLOB_READ_WRITE_TOKEN ไม่ถูกต้องหรือ Blob store ถูกลบ — ตรวจค่าใน Vercel env',
    };
  }
  if (e?.status === 413 || msg.includes('too large') || msg.includes('payload')) {
    return { reason: 'TOO_LARGE', detail: 'ไฟล์ใหญ่เกิน plan ของ Vercel Blob' };
  }
  return { reason: 'UNKNOWN', detail: e?.message || String(error) };
}

function extFor(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m === 'image/png') return 'png';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  return 'bin';
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * Upload a base64-encoded image (data URL or raw) to Vercel Blob.
 *
 * The resulting URL is public ("access: public"), so the existing
 * `<img src=blob.url>` pattern works without further auth wiring.
 *
 * Pathname layout: `inspections/<yyyy>/<mm>/<timestamp>-<rand>.<ext>`.
 * Vercel Blob also appends its own random suffix so two callers writing
 * the same pathname don't collide — we keep our own random fragment too
 * because the returned pathname is what we store as `fileId` for delete.
 */
export async function uploadImageToBlob(args: {
  base64: string;
  mimeType: string;
  filename?: string;
}): Promise<BlobUploadResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      ok: false,
      reason: 'NOT_CONFIGURED',
      detail:
        'BLOB_READ_WRITE_TOKEN ไม่ได้ตั้งใน Vercel — ไปที่ Storage → Create → Blob ' +
        'แล้วกด Connect Project',
    };
  }

  const commaIdx = args.base64.indexOf(',');
  const rawBase64 = commaIdx >= 0 ? args.base64.slice(commaIdx + 1) : args.base64;
  const buffer = Buffer.from(rawBase64, 'base64');

  const ext = extFor(args.mimeType);
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');

  const baseName = args.filename
    ? safeName(args.filename).replace(/\.[a-z0-9]+$/i, '')
    : `img-${stamp}-${rand}`;
  const pathname = `inspections/${yyyy}/${mm}/${baseName}-${stamp}-${rand}.${ext}`;

  try {
    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType: args.mimeType,
      // Defensive: even though our pathname embeds a timestamp + rand,
      // ask Vercel to add its own suffix so re-uploads with the same
      // input never silently overwrite.
      addRandomSuffix: false,
    });
    return {
      ok: true,
      image: {
        fileId: blob.pathname,
        url: blob.url,
        name: args.filename ? safeName(args.filename) : `${baseName}.${ext}`,
      },
    };
  } catch (error) {
    logBlobError('put', error);
    return { ok: false, ...classifyBlobError(error) };
  }
}

/**
 * Delete by blob URL OR by pathname. The Vercel SDK accepts either, so
 * call sites that only have a `fileId` (= pathname) can pass it directly.
 */
export async function deleteBlob(urlOrPathname: string): Promise<boolean> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
  try {
    await del(urlOrPathname);
    return true;
  } catch (error) {
    logBlobError('del', error);
    return false;
  }
}

/**
 * URL-shape detector — tells the cleanup path whether a stored image
 * was uploaded via the new Blob backend or the legacy Drive backend so
 * the right delete API is used. Falls back to "Blob" for ambiguous
 * inputs because new uploads vastly outnumber legacy ones now.
 */
export function isBlobUrl(urlOrId: string): boolean {
  if (!urlOrId) return false;
  if (urlOrId.includes('blob.vercel-storage.com')) return true;
  if (urlOrId.includes('drive.google.com')) return false;
  // Pathname heuristic: blob fileIds have a `/`, Drive fileIds don't.
  return urlOrId.includes('/');
}
