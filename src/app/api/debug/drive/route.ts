import { NextResponse, type NextRequest } from 'next/server';
import { put, del, list, head } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Image-storage diagnostic. Originally a Google Drive probe — kept at
 * the /api/debug/drive path so existing bookmarks still work — but the
 * app moved to Vercel Blob (Drive couldn't be used: Service Accounts
 * have no storage quota and the project's free Gmail can't host a
 * Shared Drive). This now reports Blob health:
 *
 *   - which env vars are present (BLOB_READ_WRITE_TOKEN booleans/length)
 *   - whether `list()` works on the store (auth sanity check)
 *   - whether a tiny real `put()` + `head()` + `del()` round-trip works
 *
 * Each step has its own try/catch and returns the raw error shape so
 * the next failure is diagnosable from this JSON alone.
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
    name?: string;
    code?: number | string;
    status?: number;
    statusText?: string;
  } | null;
  return {
    name: e?.name,
    message: e?.message ?? String(err),
    code: e?.code,
    status: e?.status,
    statusText: e?.statusText,
  };
}

export async function GET(request: NextRequest) {
  if (!requireAdminOrCreator(request)) {
    return NextResponse.json(
      { error: 'Admin or Creator session required' },
      { status: 403 },
    );
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN || '';
  const env = {
    BLOB_READ_WRITE_TOKEN_set: !!token,
    BLOB_READ_WRITE_TOKEN_length: token.length,
    BLOB_READ_WRITE_TOKEN_starts_with: token.slice(0, 18),
    backend: 'vercel-blob',
  };

  if (!token) {
    return NextResponse.json({
      ok: false,
      step: 'env',
      reason: 'BLOB_READ_WRITE_TOKEN not set — enable a Blob store in Vercel dashboard',
      hint:
        'Vercel dashboard → Storage tab → Create Database → Blob → Connect Project. ' +
        'Vercel will inject BLOB_READ_WRITE_TOKEN automatically into every env.',
      env,
    });
  }

  const steps: Array<{ name: string; ok: boolean; data?: unknown; error?: unknown }> = [];

  // A — list() : proves auth + store exist.
  try {
    const r = await list({ limit: 3 });
    steps.push({
      name: 'list (first 3)',
      ok: true,
      data: {
        count: r.blobs.length,
        sample: r.blobs.map((b) => ({
          pathname: b.pathname,
          size: b.size,
          uploadedAt: b.uploadedAt,
        })),
        hasMore: r.hasMore,
      },
    });
  } catch (err) {
    steps.push({ name: 'list (first 3)', ok: false, error: shapeError(err) });
  }

  // B — tiny real put + head + del round-trip.
  const probePath = `__probe/diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  let probeUrl: string | undefined;

  try {
    const r = await put(probePath, Buffer.from('blob-probe'), {
      access: 'public',
      contentType: 'text/plain',
      addRandomSuffix: false,
    });
    probeUrl = r.url;
    steps.push({
      name: 'put (probe)',
      ok: true,
      data: { url: r.url, pathname: r.pathname, contentType: r.contentType },
    });
  } catch (err) {
    steps.push({ name: 'put (probe)', ok: false, error: shapeError(err) });
  }

  if (probeUrl) {
    try {
      const meta = await head(probeUrl);
      steps.push({
        name: 'head (probe)',
        ok: true,
        data: {
          size: meta.size,
          contentType: meta.contentType,
          uploadedAt: meta.uploadedAt,
        },
      });
    } catch (err) {
      steps.push({ name: 'head (probe)', ok: false, error: shapeError(err) });
    }

    try {
      await del(probeUrl);
      steps.push({ name: 'del (probe cleanup)', ok: true });
    } catch (err) {
      steps.push({ name: 'del (probe cleanup)', ok: false, error: shapeError(err) });
    }
  }

  const ok = steps.every((s) => s.ok);
  return NextResponse.json({ ok, env, steps });
}
