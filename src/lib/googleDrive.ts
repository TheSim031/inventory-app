import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { getGoogleAuth } from './googleSheets';

const ROOT_FOLDER_NAME =
  process.env.GOOGLE_DRIVE_FOLDER_NAME || 'inventory-app-uploads';

// Cached id of the root folder so we don't search for it every request.
let cachedRootFolderId: string | null = null;

function getDriveClient(): drive_v3.Drive | null {
  const auth = getGoogleAuth();
  if (!auth) return null;
  return google.drive({ version: 'v3', auth });
}

/** Accept the raw folder id, or a Drive folder URL — both are common
 *  things to paste into an env var. e.g.
 *    GOOGLE_DRIVE_FOLDER_ID=19D50c98SaPA3uEfh94qOer2pS0D8h1KF
 *    GOOGLE_DRIVE_FOLDER_ID=https://drive.google.com/drive/folders/19D50c98SaPA3uEfh94qOer2pS0D8h1KF?usp=drive_link
 */
function normalizeFolderIdEnv(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const idMatch = trimmed.match(/\?(?:.*&)?id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return trimmed;
}

async function getOrCreateRootFolder(
  drive: drive_v3.Drive,
): Promise<string | null> {
  if (cachedRootFolderId) return cachedRootFolderId;
  // Allow overriding via env when the service account is given access to a
  // pre-shared folder (recommended for Shared Drives).
  const envId = normalizeFolderIdEnv(process.env.GOOGLE_DRIVE_FOLDER_ID || '');
  if (envId) {
    cachedRootFolderId = envId;
    return cachedRootFolderId;
  }

  try {
    const safeName = ROOT_FOLDER_NAME.replace(/'/g, "\\'");
    const search = await drive.files.list({
      q: `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      spaces: 'drive',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const existing = search.data.files?.[0];
    if (existing?.id) {
      cachedRootFolderId = existing.id;
      return existing.id;
    }
    const created = await drive.files.create({
      requestBody: {
        name: ROOT_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
      supportsAllDrives: true,
    });
    if (created.data.id) {
      cachedRootFolderId = created.data.id;
      return created.data.id;
    }
    return null;
  } catch (error) {
    logDriveError('getOrCreateRootFolder', error);
    return null;
  }
}

export type UploadedImage = {
  fileId: string;
  url: string; // direct-view URL (works in <img src=...>)
  name: string;
};

export type DriveFailureReason =
  | 'NOT_CONFIGURED'        // service account env missing
  | 'API_DISABLED'          // Drive API not enabled in GCP project
  | 'AUTH_DENIED'           // 401/403 from Drive
  | 'PERMISSION_GRANT_FAIL' // file uploaded but couldn't be made link-viewable
  | 'UNKNOWN';

export type DriveUploadResult =
  | { ok: true; image: UploadedImage }
  | { ok: false; reason: DriveFailureReason; detail?: string };

const ENABLE_DRIVE_API_HINT =
  'เปิดใช้งาน Google Drive API ใน Google Cloud Console ของ project ที่ service account สังกัด แล้วรอ 1–2 นาที';

/**
 * Pull every diagnostic field googleapis tends to attach to a Drive error
 * and dump it to the server log. Without this you only ever see
 * `AUTH_DENIED — ...` in the Vercel UI and have to guess between
 * "wrong scope", "folder not shared", "API disabled", "bad key", etc.
 */
function logDriveError(stage: string, error: unknown): void {
  const e = error as {
    message?: string;
    code?: number | string;
    status?: number;
    response?: { status?: number; statusText?: string; data?: unknown };
    errors?: unknown;
    stack?: string;
  } | null;
  console.error(`Google Drive Error (${stage}):`, {
    message: e?.message,
    code: e?.code,
    status: e?.status ?? e?.response?.status,
    statusText: e?.response?.statusText,
    apiErrors: e?.errors,
    responseData: e?.response?.data,
  });
  if (e?.stack) console.error(`Google Drive Error stack (${stage}):`, e.stack);
}

function classifyDriveError(error: unknown): {
  reason: DriveFailureReason;
  detail?: string;
} {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : '';
  const lower = msg.toLowerCase();
  if (
    lower.includes('drive api has not been used') ||
    lower.includes('api drive.googleapis.com') ||
    lower.includes('it is disabled')
  ) {
    return { reason: 'API_DISABLED', detail: ENABLE_DRIVE_API_HINT };
  }
  // googleapis sets .code (and sometimes .response.status) on API errors.
  const code = (error as { code?: number | string; response?: { status?: number } } | null)
    ?.code;
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  // Insufficient scope often comes back as 403 with a body that includes
  // "insufficientPermissions" or "insufficient authentication scopes".
  if (
    lower.includes('insufficient') &&
    (lower.includes('scope') || lower.includes('permission'))
  ) {
    return {
      reason: 'AUTH_DENIED',
      detail:
        'OAuth scope ไม่พอ — ต้องใช้ https://www.googleapis.com/auth/drive (ขณะนี้แก้แล้วใน source — ต้อง redeploy)',
    };
  }
  if (code === 401 || code === 403 || status === 401 || status === 403) {
    return {
      reason: 'AUTH_DENIED',
      detail:
        'service account ไม่มีสิทธิ์ — ตรวจว่า (1) แชร์โฟลเดอร์ GOOGLE_DRIVE_FOLDER_ID ให้ ' +
        '<GOOGLE_SERVICE_ACCOUNT_EMAIL> เป็น Editor แล้ว และ (2) Drive API เปิดอยู่ใน GCP project เดียวกับ SA',
    };
  }
  if (code === 404 || status === 404) {
    return {
      reason: 'AUTH_DENIED',
      detail:
        'หาโฟลเดอร์ไม่เจอ — มักเกิดจาก service account ยังไม่ได้รับสิทธิ์โฟลเดอร์ ' +
        'GOOGLE_DRIVE_FOLDER_ID (Drive จะตอบ 404 แทน 403 เพื่อไม่เปิดเผยตัวตนไฟล์)',
    };
  }
  return { reason: 'UNKNOWN', detail: msg || undefined };
}

/**
 * Upload a base64-encoded image (data URL or raw) to the app's Drive folder.
 * Sets public-link permission so the returned URL is viewable in <img>.
 */
export async function uploadImageToDrive(args: {
  base64: string;
  mimeType: string;
  filename?: string;
}): Promise<DriveUploadResult> {
  const drive = getDriveClient();
  if (!drive) {
    return {
      ok: false,
      reason: 'NOT_CONFIGURED',
      detail: 'service account env ไม่ครบ',
    };
  }

  let folderId: string | null;
  try {
    folderId = await getOrCreateRootFolder(drive);
  } catch (error) {
    return { ok: false, ...classifyDriveError(error) };
  }
  if (!folderId) {
    // getOrCreateRootFolder swallowed the error and logged it. We can't see
    // the original cause from here, so report generically.
    return {
      ok: false,
      reason: 'UNKNOWN',
      detail: 'หา/สร้าง folder บน Drive ไม่ได้ — ดู Vercel logs สำหรับสาเหตุ',
    };
  }

  // Accept either a data URL ("data:image/jpeg;base64,...") or raw base64.
  const commaIdx = args.base64.indexOf(',');
  const rawBase64 = commaIdx >= 0 ? args.base64.slice(commaIdx + 1) : args.base64;
  const buffer = Buffer.from(rawBase64, 'base64');

  const ext = (() => {
    const m = args.mimeType.toLowerCase();
    if (m === 'image/png') return 'png';
    if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
    return 'bin';
  })();
  const name = (args.filename || `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`).replace(/[\\/:*?"<>|]/g, '_');

  let fileId: string | undefined;
  let createdName: string | undefined;
  try {
    const created = await drive.files.create({
      requestBody: { name, parents: [folderId], mimeType: args.mimeType },
      media: { mimeType: args.mimeType, body: Readable.from(buffer) },
      fields: 'id,name',
      supportsAllDrives: true,
    });
    fileId = created.data.id ?? undefined;
    createdName = created.data.name ?? undefined;
  } catch (error) {
    logDriveError('files.create', error);
    return { ok: false, ...classifyDriveError(error) };
  }
  if (!fileId) {
    return { ok: false, reason: 'UNKNOWN', detail: 'Drive ไม่ส่ง fileId กลับ' };
  }

  // Make link-viewable so <img src=...> works without auth. If sharing
  // fails (Workspace policy / quota) the file is useless to us — roll it
  // back so we don't leave half-public artifacts behind.
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true,
    });
  } catch (permErr) {
    logDriveError('permissions.create (rolling back upload)', permErr);
    try {
      await drive.files.delete({ fileId, supportsAllDrives: true });
    } catch (delErr) {
      logDriveError('files.delete (rollback)', delErr);
    }
    const classified = classifyDriveError(permErr);
    return {
      ok: false,
      reason: classified.reason === 'UNKNOWN' ? 'PERMISSION_GRANT_FAIL' : classified.reason,
      detail: classified.detail || 'ตั้งสิทธิ์ share ไฟล์ไม่สำเร็จ — ตรวจ Workspace sharing policy',
    };
  }

  return {
    ok: true,
    image: {
      fileId,
      url: `https://drive.google.com/uc?id=${fileId}`,
      name: createdName || name,
    },
  };
}

export async function deleteDriveFile(fileId: string): Promise<boolean> {
  const drive = getDriveClient();
  if (!drive) return false;
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
    return true;
  } catch (error) {
    logDriveError('deleteDriveFile', error);
    return false;
  }
}
