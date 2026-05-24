import { NextResponse, type NextRequest } from 'next/server';
import {
  readInspectionsSheet,
  appendInspectionRow,
  completeInspectionRow,
  deleteInspectionRows,
  type InspectionImages,
  type InspectionImage,
  type InspectionItem,
  type InspectionQcImagesByCode,
} from '@/lib/googleSheets';
import { deleteDriveFile } from '@/lib/googleDrive';
import { sendLineToRoles } from '@/lib/lineNotify';
import { requireAuth, requireRoles, getSessionContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type CreateBody = {
  company?: string;
  poRef?: string;
  items?: InspectionItem[];
  warehouseImages?: Partial<InspectionImages>;
};

type CompleteBody = {
  id?: string;
  qcImages?: InspectionQcImagesByCode;
  inspector?: string;
};

function sanitizeImageArray(raw: unknown): InspectionImage[] {
  if (!Array.isArray(raw)) return [];
  const out: InspectionImage[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const r = it as { fileId?: unknown; url?: unknown; name?: unknown };
    if (typeof r.fileId !== 'string' || typeof r.url !== 'string') continue;
    out.push({
      fileId: r.fileId,
      url: r.url,
      name: typeof r.name === 'string' ? r.name : undefined,
    });
  }
  return out;
}

function sanitizeWarehouseImages(raw: Partial<InspectionImages> | undefined): InspectionImages {
  return {
    bill: sanitizeImageArray(raw?.bill),
    po: sanitizeImageArray(raw?.po),
    items: sanitizeImageArray(raw?.items),
  };
}

function sanitizeQcImages(raw: InspectionQcImagesByCode | undefined): InspectionQcImagesByCode {
  if (!raw || typeof raw !== 'object') return {};
  const out: InspectionQcImagesByCode = {};
  for (const [code, list] of Object.entries(raw)) {
    const arr = sanitizeImageArray(list);
    if (arr.length > 0) out[code] = arr;
  }
  return out;
}

export async function GET(request: NextRequest) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status'); // 'PENDING' | 'COMPLETED' | null
  const rows = await readInspectionsSheet();
  if (!rows) return NextResponse.json([]);
  const filtered =
    statusFilter === 'PENDING' || statusFilter === 'COMPLETED'
      ? rows.filter((r) => r.status === statusFilter)
      : rows;
  // Newest first.
  return NextResponse.json([...filtered].reverse());
}

export async function POST(request: NextRequest) {
  const denied = requireRoles(request, ['WAREHOUSE']);
  if (denied) return denied;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const company = (body.company || '').trim();
  const poRef = (body.poRef || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!company) return NextResponse.json({ error: 'กรุณาระบุชื่อบริษัท' }, { status: 400 });
  if (!poRef) return NextResponse.json({ error: 'กรุณาระบุรหัส PO/PX' }, { status: 400 });
  if (items.length === 0) {
    return NextResponse.json({ error: 'ต้องมีรายการอย่างน้อย 1 รายการ' }, { status: 400 });
  }
  for (const it of items) {
    if (!it.code || !it.name || !Number.isFinite(it.quantity) || it.quantity <= 0) {
      return NextResponse.json(
        { error: `รายการไม่ถูกต้อง: ${JSON.stringify(it)}` },
        { status: 400 },
      );
    }
  }

  const id = `INS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const sanitizedItems = items.map((it) => ({
    code: String(it.code).trim(),
    name: String(it.name).trim(),
    quantity: Math.floor(it.quantity),
  }));
  const sanitizedWarehouseImages = sanitizeWarehouseImages(body.warehouseImages);

  const ok = await appendInspectionRow({
    id,
    receivedAt: new Date().toISOString(),
    company,
    poRef,
    items: sanitizedItems,
    warehouseImages: sanitizedWarehouseImages,
  });

  if (!ok) {
    return NextResponse.json({ error: 'บันทึกรายการตรวจสอบไม่สำเร็จ' }, { status: 500 });
  }

  // Notify warehouse (full details + all images) and QC (text only with
  // explicit "ให้มาตรวจของ" framing per Phase 3 spec).
  const itemsBlock = sanitizedItems
    .map((it) => `• ${it.name} (${it.code}) ×${it.quantity}`)
    .join('\n');
  const whText = `📦 รับของใหม่ — แจ้งตรวจสอบ\nบริษัท: ${company}\nPO/PX: ${poRef}\nรหัสตรวจสอบ: ${id}\n\nรายการ:\n${itemsBlock}`;
  const qcText = `🔍 ให้มาตรวจของ\nบริษัท: ${company}\nPO/PX: ${poRef}\nรหัสตรวจสอบ: ${id}\n\nรายการ:\n${itemsBlock}\n\n👉 กรุณาเข้าระบบเว็บเพื่อตรวจสอบ`;
  const allWhImages = [
    ...sanitizedWarehouseImages.bill,
    ...sanitizedWarehouseImages.po,
    ...sanitizedWarehouseImages.items,
  ].map((img) => img.url);

  // Fire-and-forget so notification failures don't block the response.
  (async () => {
    try {
      await sendLineToRoles(['WAREHOUSE'], `${whText}\n\n🗂 รูปแนบจากคลัง: ${allWhImages.length} รูป`, {
        images: allWhImages,
        maxImages: allWhImages.length,
      });
      await sendLineToRoles(['QC'], qcText, {
        textOnly: true,
      });
    } catch (err) {
      console.error('Notification dispatch error (inspections POST):', err);
    }
  })();

  return NextResponse.json({ id, status: 'PENDING' }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const denied = requireRoles(request, ['QC']);
  if (denied) return denied;

  let body: CompleteBody;
  try {
    body = (await request.json()) as CompleteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const id = (body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });

  const qcImages = sanitizeQcImages(body.qcImages);
  // Validate every item code in the row has ≥1 image attached.
  const rows = await readInspectionsSheet();
  const target = rows?.find((r) => r.id === id);
  if (!target) return NextResponse.json({ error: 'ไม่พบรายการตรวจสอบ' }, { status: 404 });
  if (target.status === 'COMPLETED') {
    return NextResponse.json({ error: 'รายการนี้ตรวจสอบเสร็จแล้ว' }, { status: 409 });
  }
  for (const it of target.items) {
    if (!qcImages[it.code] || qcImages[it.code].length === 0) {
      return NextResponse.json(
        { error: `กรุณาแนบรูปสำหรับ "${it.name}" (${it.code})` },
        { status: 400 },
      );
    }
  }

  const ctx = getSessionContext(request);
  const inspector = (body.inspector || ctx.displayName || '').trim();
  if (!inspector) {
    return NextResponse.json({ error: 'กรุณาระบุชื่อผู้ตรวจ' }, { status: 400 });
  }

  const ok = await completeInspectionRow({
    id,
    qcImages,
    inspector,
  });
  if (ok === 'NOT_FOUND') {
    return NextResponse.json({ error: 'ไม่พบรายการตรวจสอบ' }, { status: 404 });
  }
  if (ok === 'ALREADY_COMPLETED') {
    return NextResponse.json({ error: 'รายการนี้ตรวจสอบเสร็จแล้ว' }, { status: 409 });
  }
  if (ok !== 'UPDATED') {
    return NextResponse.json({ error: 'อัปเดตไม่สำเร็จ' }, { status: 500 });
  }

  // Notify Executive with full details + all images.
  const itemsBlock = target.items
    .map((it) => {
      const cnt = qcImages[it.code]?.length ?? 0;
      return `• ${it.name} (${it.code}) ×${it.quantity}  📸 ${cnt}`;
    })
    .join('\n');
  const text = `✅ QC ตรวจสอบเสร็จเรียบร้อย\nบริษัท: ${target.company}\nPO/PX: ${target.poRef}\nรหัสตรวจสอบ: ${target.id}\nผู้ตรวจ: ${inspector || '-'}\n\nรายการ:\n${itemsBlock}`;
  const allImages = [
    ...target.warehouseImages.bill,
    ...target.warehouseImages.po,
    ...target.warehouseImages.items,
    ...Object.values(qcImages).flat(),
  ].map((img) => img.url);

  (async () => {
    try {
      await sendLineToRoles(['EXECUTIVE'], `${text}\n\n🗂 รูปทั้งหมด: ${allImages.length} รูป`, {
        images: allImages,
        maxImages: allImages.length,
      });
    } catch (err) {
      console.error('Notification dispatch error (inspections PATCH):', err);
    }
  })();

  return NextResponse.json({ id, status: 'COMPLETED' });
}

type DeleteBody = {
  ids?: string[];
  /** safety: client must echo this exact phrase to confirm intent */
  confirm?: string;
};

const REQUIRED_DELETE_CONFIRM = 'DELETE_INSPECTION_HISTORY';

export async function DELETE(request: NextRequest) {
  const denied = requireRoles(request, ['WAREHOUSE']);
  if (denied) return denied;

  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.confirm !== REQUIRED_DELETE_CONFIRM) {
    return NextResponse.json(
      { error: 'ต้องยืนยันด้วยรหัสที่ถูกต้องเพื่อป้องกันการลบโดยไม่ตั้งใจ' },
      { status: 400 },
    );
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string' && x) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ไม่ได้เลือกรายการ' }, { status: 400 });
  }
  // Cap batch size so a runaway request can't try to delete 10k Drive files
  // in one shot (each file is one Drive API call → quota / timeout risk).
  const MAX_DELETE_PER_REQUEST = 200;
  if (ids.length > MAX_DELETE_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `ลบได้ครั้งละไม่เกิน ${MAX_DELETE_PER_REQUEST} รายการ — เลือก ${ids.length}`,
      },
      { status: 400 },
    );
  }

  // Refuse to delete PENDING (still being inspected) — only history rows.
  const rows = await readInspectionsSheet();
  if (!rows) return NextResponse.json({ error: 'อ่านข้อมูลไม่ได้' }, { status: 500 });

  const targets = rows.filter((r) => ids.includes(r.id));
  const pending = targets.filter((r) => r.status !== 'COMPLETED');
  if (pending.length > 0) {
    return NextResponse.json(
      {
        error: `ลบไม่ได้: มี ${pending.length} รายการที่ยังไม่ตรวจสอบ (สถานะ PENDING) — ลบได้เฉพาะประวัติที่ตรวจสอบเสร็จแล้ว`,
      },
      { status: 400 },
    );
  }

  // Collect Drive file IDs to clean up before nuking the sheet rows.
  const driveFileIds: string[] = [];
  for (const r of targets) {
    driveFileIds.push(
      ...r.warehouseImages.bill.map((i) => i.fileId),
      ...r.warehouseImages.po.map((i) => i.fileId),
      ...r.warehouseImages.items.map((i) => i.fileId),
      ...Object.values(r.qcImages).flat().map((i) => i.fileId),
    );
  }

  const deleted = await deleteInspectionRows(targets.map((r) => r.id));

  // Await Drive cleanup so serverless runtimes (e.g. Vercel) don't terminate
  // before background deletion finishes.
  const uniqueDriveIds = Array.from(new Set(driveFileIds));
  const cleanupResults = await Promise.allSettled(
    uniqueDriveIds.map((fileId) => deleteDriveFile(fileId)),
  );
  const driveDeleted = cleanupResults.filter((r) => r.status === 'fulfilled').length;
  const driveFailed = cleanupResults.length - driveDeleted;

  return NextResponse.json({
    deleted: deleted.length,
    ids: deleted,
    driveDeleted,
    driveFailed,
  });
}
