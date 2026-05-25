#!/usr/bin/env node
// scripts/test-drive.mjs
//
// Standalone Google Drive probe. Reads the same env vars the app uses
// (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_DRIVE_FOLDER_ID)
// and walks through every Drive call the upload flow makes — printing the
// RAW googleapis error object at each step on failure.
//
// Usage (local):
//   1. Make sure .env.local has the production-equivalent values.
//   2. node --env-file=.env.local scripts/test-drive.mjs
//
// Or one-shot via Vercel:
//   vercel env pull .env.production.local
//   node --env-file=.env.production.local scripts/test-drive.mjs
//
// Reads only — only side effect is a temp 5-byte file written into the
// configured folder and immediately deleted as part of the probe.

import { google } from 'googleapis';
import { Readable } from 'node:stream';

function normalizeFolderIdEnv(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const idMatch = trimmed.match(/\?(?:.*&)?id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return trimmed;
}

function dumpError(stage, err) {
  console.error(`\n  ✗ ${stage} FAILED`);
  console.error('  ── error.message :', err?.message);
  console.error('  ── error.code    :', err?.code);
  console.error('  ── status        :', err?.status ?? err?.response?.status);
  console.error('  ── statusText    :', err?.response?.statusText);
  console.error('  ── apiErrors     :', JSON.stringify(err?.errors, null, 2));
  console.error('  ── responseData  :', JSON.stringify(err?.response?.data, null, 2));
  // Raw object for anything I forgot to surface above.
  console.error('  ── RAW (keys)    :', Object.keys(err || {}));
}

async function main() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const privateKey = rawKey.replace(/\\n/g, '\n');
  const rawFolder = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
  const folderId = normalizeFolderIdEnv(rawFolder);

  console.log('── ENV ─────────────────────────────────────────');
  console.log('  GOOGLE_SERVICE_ACCOUNT_EMAIL :', clientEmail ? clientEmail.slice(0, 6) + '…@…' : '(EMPTY)');
  console.log('  GOOGLE_PRIVATE_KEY length    :', rawKey.length);
  console.log('  GOOGLE_PRIVATE_KEY has \\n    :', rawKey.includes('\\n'));
  console.log('  GOOGLE_PRIVATE_KEY pem head  :', privateKey.startsWith('-----BEGIN'));
  console.log('  GOOGLE_DRIVE_FOLDER_ID raw   :', rawFolder.slice(0, 50));
  console.log('  GOOGLE_DRIVE_FOLDER_ID norm  :', folderId);

  if (!clientEmail || !privateKey) {
    console.error('\n✗ FATAL: GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env missing');
    process.exit(1);
  }
  if (!folderId) {
    console.error('\n✗ FATAL: GOOGLE_DRIVE_FOLDER_ID env missing');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  const drive = google.drive({ version: 'v3', auth });

  let allOk = true;

  // A — about.get : proves auth + scope work at all.
  console.log('\n── A · drive.about.get ─────────────────────────');
  try {
    const r = await drive.about.get({ fields: 'user,storageQuota' });
    console.log('  ✓ user           :', r.data.user?.emailAddress);
    console.log('  ✓ user.displayName:', r.data.user?.displayName);
    console.log('  ✓ storageQuota   :', r.data.storageQuota);
  } catch (err) {
    allOk = false;
    dumpError('about.get', err);
  }

  // B — folder.get : proves the SA can SEE the configured folder, and
  // tells us whether it's in a Shared Drive (driveId is set) — the
  // single most common reason uploads later fail with storageQuotaExceeded.
  console.log('\n── B · drive.files.get(folder) ─────────────────');
  try {
    const r = await drive.files.get({
      fileId: folderId,
      fields:
        'id,name,mimeType,driveId,parents,owners(emailAddress),capabilities(canAddChildren,canEdit)',
      supportsAllDrives: true,
    });
    console.log('  ✓ name             :', r.data.name);
    console.log('  ✓ mimeType         :', r.data.mimeType);
    console.log('  ✓ owners           :', (r.data.owners || []).map((o) => o.emailAddress).join(', ') || '(none — Shared Drive)');
    console.log('  ✓ driveId          :', r.data.driveId || '(none — in My Drive)');
    console.log('  ✓ isSharedDrive    :', !!r.data.driveId);
    console.log('  ✓ canAddChildren   :', r.data.capabilities?.canAddChildren);
    if (!r.data.driveId) {
      console.log(
        '\n  ⚠  HEADS-UP: folder lives in My Drive, not a Shared Drive.\n' +
        '     Service accounts have NO storage quota — uploads will fail with\n' +
        '     "storageQuotaExceeded". Move the folder to a Shared Drive and\n' +
        '     share that Shared Drive with the SA email as Content Manager+.',
      );
    }
  } catch (err) {
    allOk = false;
    dumpError('files.get(folder)', err);
  }

  // C — files.list children of the folder.
  console.log('\n── C · drive.files.list(parent = folder) ───────');
  try {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,createdTime)',
      pageSize: 5,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    console.log('  ✓ children count :', r.data.files?.length ?? 0);
    (r.data.files || []).forEach((f) =>
      console.log('    ·', f.name, f.id, f.mimeType, f.createdTime),
    );
  } catch (err) {
    allOk = false;
    dumpError('files.list', err);
  }

  // D — tiny real upload + delete (this is what triggers
  // storageQuotaExceeded if the folder is in My Drive).
  console.log('\n── D · drive.files.create (probe upload) ───────');
  let probeId;
  try {
    const r = await drive.files.create({
      requestBody: {
        name: `__drive_probe_${Date.now()}.txt`,
        parents: [folderId],
        mimeType: 'text/plain',
      },
      media: { mimeType: 'text/plain', body: Readable.from(Buffer.from('probe')) },
      fields: 'id,name,driveId,parents',
      supportsAllDrives: true,
    });
    probeId = r.data.id;
    console.log('  ✓ uploaded id    :', r.data.id);
    console.log('  ✓ uploaded name  :', r.data.name);
    console.log('  ✓ parents        :', r.data.parents);
    console.log('  ✓ driveId        :', r.data.driveId || '(none)');
  } catch (err) {
    allOk = false;
    dumpError('files.create (probe upload)', err);
  }
  if (probeId) {
    try {
      await drive.files.delete({ fileId: probeId, supportsAllDrives: true });
      console.log('  ✓ cleaned up probe file');
    } catch (err) {
      allOk = false;
      dumpError('files.delete (cleanup)', err);
    }
  }

  console.log('\n────────────────────────────────────────────────');
  console.log(allOk ? '✓ ALL CHECKS PASSED' : '✗ AT LEAST ONE STEP FAILED — see error dumps above');
  process.exit(allOk ? 0 : 2);
}

main().catch((err) => {
  console.error('\n✗ UNEXPECTED', err);
  process.exit(1);
});
