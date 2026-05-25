import { NextResponse, type NextRequest } from 'next/server';
import { uploadImageToBlob } from '@/lib/blob';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Allow up to ~8MB base64 payload — keeps Vercel happy and matches what the
// client-side compressor produces (max ~1500px JPEG ≈ 1-2 MB).
export const maxDuration = 30;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);

type UploadBody = {
  base64?: string;
  mimeType?: string;
  filename?: string;
};

export async function POST(request: NextRequest) {
  const denied = requireAuth(request);
  if (denied) return denied;

  let body: UploadBody;
  try {
    body = (await request.json()) as UploadBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { base64, mimeType, filename } = body;
  if (!base64 || !mimeType) {
    return NextResponse.json({ error: 'missing base64 or mimeType' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
    return NextResponse.json(
      { error: 'รองรับเฉพาะไฟล์ .jpg, .jpeg, .png' },
      { status: 400 },
    );
  }

  // Sanity-check encoded size (approx; base64 inflates by ~33%).
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > 12 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'ไฟล์ใหญ่เกิน 12MB — กรุณาย่อขนาดก่อน' },
      { status: 413 },
    );
  }

  let result;
  try {
    result = await uploadImageToBlob({ base64, mimeType, filename });
  } catch (err) {
    console.error('POST /api/uploads: uploadImageToBlob threw:', err);
    return NextResponse.json(
      {
        error:
          'อัปโหลดรูปล้มเหลวแบบไม่คาดคิด — ดู Vercel logs (POST /api/uploads)',
        reason: 'UNKNOWN',
      },
      { status: 500 },
    );
  }
  if (!result.ok) {
    const REASON_LABEL: Record<typeof result.reason, string> = {
      NOT_CONFIGURED:
        'Vercel Blob ยังไม่ได้ตั้งค่า — ต้องเปิด Blob store ใน Vercel dashboard',
      AUTH_DENIED: 'token Blob ไม่ถูกต้องหรือ store ถูกลบ',
      TOO_LARGE: 'ไฟล์ใหญ่เกิน plan ของ Blob',
      UNKNOWN: 'อัปโหลดรูปไม่สำเร็จ',
    };
    const label = REASON_LABEL[result.reason];
    const detail = result.detail ? ` — ${result.detail}` : '';
    const status = result.reason === 'NOT_CONFIGURED' ? 503 : 500;
    return NextResponse.json(
      { error: `${label}${detail}`, reason: result.reason },
      { status },
    );
  }
  return NextResponse.json(result.image, { status: 201 });
}
