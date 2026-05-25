import { NextResponse, type NextRequest } from 'next/server';
import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { getGoogleAuth } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Drive diagnostic endpoint. Hit it from a browser while signed in as
 * Creator or Admin and you get back, in JSON:
 *
 *   - which env vars are present (booleans + lengths, never values)
 *   - whether `drive.about.get` works at all (scope sanity check)
 *   - what `drive.files.get` reports about GOOGLE_DRIVE_FOLDER_ID
 *     (proves the SA can see the folder, and whether it lives in a
 *     Shared Drive — critical for the storage-quota trap)
 *   - whether `drive.files.list(q=parents=<folder>)` works
 *   - the result of a tiny 1-byte real upload + cleanup
 *
 * Every step has its own try/catch and returns the *raw* googleapis
 * error object (message, code, status, errors[], response.data) so you
 * can see the actual Drive reason instead of the translated toast.
 */
function requireAdminOrCreator(request: NextRequest): boolean {
  const isCreator =
    request.cookies.get('creator_session')?.value === 'authenticated';
  const isAdmin = request.cookies.get('auth_session')?.value === 'authenticated';
  return isCreator || isAdmin;
}

function shapeError(err: unknown) {
  const e = err as {
    message?: string;
    code?: number | string;
    status?: number;
    response?: { status?: number; statusText?: string; data?: unknown };
    errors?: unknown;
  } | null;
  return {
    message: e?.message ?? String(err),
    code: e?.code,
    status: e?.status ?? e?.response?.status,
    statusText: e?.response?.statusText,
    apiErrors: e?.errors,
    responseData: e?.response?.data,
  };
}

function normalizeFolderIdEnv(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const idMatch = trimmed.match(/\?(?:.*&)?id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return trimmed;
}

export async function GET(request: NextRequest) {
  if (!requireAdminOrCreator(request)) {
    return NextResponse.json(
      { error: 'Admin or Creator session required' },
      { status: 403 },
    );
  }

  const rawFolderEnv = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
  const folderId = normalizeFolderIdEnv(rawFolderEnv);
  const privateKey = process.env.GOOGLE_PRIVATE_KEY || '';

  const env = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL_set: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_EMAIL_preview:
      (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').slice(0, 6) + '…',
    GOOGLE_PRIVATE_KEY_set: !!privateKey,
    GOOGLE_PRIVATE_KEY_length: privateKey.length,
    GOOGLE_PRIVATE_KEY_starts_pem: privateKey.includes('BEGIN PRIVATE KEY'),
    GOOGLE_PRIVATE_KEY_has_literal_backslash_n: privateKey.includes('\\n'),
    GOOGLE_PRIVATE_KEY_has_real_newlines: privateKey.includes('\n'),
    GOOGLE_DRIVE_FOLDER_ID_raw: rawFolderEnv.slice(0, 60) + (rawFolderEnv.length > 60 ? '…' : ''),
    GOOGLE_DRIVE_FOLDER_ID_normalized: folderId,
  };

  const auth = getGoogleAuth();
  if (!auth) {
    return NextResponse.json({
      ok: false,
      step: 'auth',
      reason: 'getGoogleAuth() returned null — env missing',
      env,
    });
  }

  const drive: drive_v3.Drive = google.drive({ version: 'v3', auth });
  const steps: Array<{ name: string; ok: boolean; data?: unknown; error?: unknown }> = [];

  // Step A — drive.about.get (proves auth+scope work at all).
  try {
    const about = await drive.about.get({ fields: 'user,storageQuota' });
    steps.push({
      name: 'about.get',
      ok: true,
      data: {
        user: about.data.user,
        storageQuota: about.data.storageQuota,
      },
    });
  } catch (err) {
    steps.push({ name: 'about.get', ok: false, error: shapeError(err) });
  }

  // Step B — folder.get on the configured GOOGLE_DRIVE_FOLDER_ID.
  if (!folderId) {
    steps.push({
      name: 'folder.get',
      ok: false,
      error: { message: 'GOOGLE_DRIVE_FOLDER_ID is empty' },
    });
  } else {
    try {
      const folder = await drive.files.get({
        fileId: folderId,
        fields:
          'id,name,mimeType,driveId,parents,owners(emailAddress),capabilities(canAddChildren,canEdit)',
        supportsAllDrives: true,
      });
      steps.push({
        name: 'folder.get',
        ok: true,
        data: {
          ...folder.data,
          isSharedDrive: !!folder.data.driveId,
        },
      });
    } catch (err) {
      steps.push({ name: 'folder.get', ok: false, error: shapeError(err) });
    }
  }

  // Step C — files.list children of the folder.
  if (folderId) {
    try {
      const list = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id,name,mimeType,size,createdTime)',
        pageSize: 5,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      steps.push({
        name: 'files.list (children)',
        ok: true,
        data: { count: list.data.files?.length ?? 0, sample: list.data.files },
      });
    } catch (err) {
      steps.push({ name: 'files.list (children)', ok: false, error: shapeError(err) });
    }
  }

  // Step D — tiny real upload then immediate delete. This catches the
  // storageQuotaExceeded trap that only fires at upload time, not at
  // .get / .list time.
  if (folderId) {
    let uploadedId: string | undefined;
    try {
      const probe = await drive.files.create({
        requestBody: {
          name: `__drive_probe_${Date.now()}.txt`,
          parents: [folderId],
          mimeType: 'text/plain',
        },
        media: { mimeType: 'text/plain', body: Readable.from(Buffer.from('probe')) },
        fields: 'id,name,driveId,parents',
        supportsAllDrives: true,
      });
      uploadedId = probe.data.id ?? undefined;
      steps.push({
        name: 'files.create (probe upload)',
        ok: true,
        data: probe.data,
      });
    } catch (err) {
      steps.push({
        name: 'files.create (probe upload)',
        ok: false,
        error: shapeError(err),
      });
    }
    if (uploadedId) {
      try {
        await drive.files.delete({ fileId: uploadedId, supportsAllDrives: true });
        steps.push({ name: 'files.delete (probe cleanup)', ok: true });
      } catch (err) {
        steps.push({
          name: 'files.delete (probe cleanup)',
          ok: false,
          error: shapeError(err),
        });
      }
    }
  }

  const ok = steps.every((s) => s.ok);
  return NextResponse.json({ ok, env, steps });
}
