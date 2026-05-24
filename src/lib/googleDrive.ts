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

async function getOrCreateRootFolder(
  drive: drive_v3.Drive,
): Promise<string | null> {
  if (cachedRootFolderId) return cachedRootFolderId;
  // Allow overriding via env when the service account is given access to a
  // pre-shared folder (recommended for Shared Drives).
  const envId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (envId && envId.trim()) {
    cachedRootFolderId = envId.trim();
    return cachedRootFolderId;
  }

  try {
    const safeName = ROOT_FOLDER_NAME.replace(/'/g, "\\'");
    const search = await drive.files.list({
      q: `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name)',
      spaces: 'drive',
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
    });
    if (created.data.id) {
      cachedRootFolderId = created.data.id;
      return created.data.id;
    }
    return null;
  } catch (error) {
    console.error('Google Drive Error (getOrCreateRootFolder):', error);
    return null;
  }
}

export type UploadedImage = {
  fileId: string;
  url: string; // direct-view URL (works in <img src=...>)
  name: string;
};

/**
 * Upload a base64-encoded image (data URL or raw) to the app's Drive folder.
 * Sets public-link permission so the returned URL is viewable in <img>.
 * Returns null if Drive isn't configured.
 */
export async function uploadImageToDrive(args: {
  base64: string;
  mimeType: string;
  filename?: string;
}): Promise<UploadedImage | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  const folderId = await getOrCreateRootFolder(drive);
  if (!folderId) return null;

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

  try {
    const created = await drive.files.create({
      requestBody: { name, parents: [folderId], mimeType: args.mimeType },
      media: { mimeType: args.mimeType, body: Readable.from(buffer) },
      fields: 'id,name',
    });
    const fileId = created.data.id;
    if (!fileId) return null;

    // Make link-viewable so <img src=...> works without auth. If sharing
    // fails (Workspace policy / quota) the file is useless to us — delete
    // it so we don't leave half-public artifacts behind, and signal failure
    // to the caller so the UI can show a real error instead of a broken
    // image later.
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    } catch (permErr) {
      console.error(
        'Google Drive: permission grant failed — rolling back upload',
        permErr,
      );
      try {
        await drive.files.delete({ fileId });
      } catch (delErr) {
        console.error('Google Drive: rollback delete also failed', delErr);
      }
      return null;
    }

    return {
      fileId,
      url: `https://drive.google.com/uc?id=${fileId}`,
      name: created.data.name || name,
    };
  } catch (error) {
    console.error('Google Drive Error (uploadImageToDrive):', error);
    return null;
  }
}

export async function deleteDriveFile(fileId: string): Promise<boolean> {
  const drive = getDriveClient();
  if (!drive) return false;
  try {
    await drive.files.delete({ fileId });
    return true;
  } catch (error) {
    console.error('Google Drive Error (deleteDriveFile):', error);
    return false;
  }
}
