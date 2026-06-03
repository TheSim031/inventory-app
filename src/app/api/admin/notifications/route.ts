import { NextResponse, type NextRequest } from 'next/server';
import {
  readUsersSheet,
  readNotifUserOverrides,
  replaceNotifGroupConfig,
  replaceNotifUserOverrides,
  type NotifGroupConfigRow,
  type NotifUserOverrideRow,
} from '@/lib/googleSheets';
import {
  buildEffectiveGroupMatrix,
  isNotificationKey,
  loadNotificationConfig,
  NOTIFICATION_TYPES,
} from '@/lib/notificationConfig';
import { getSessionContext } from '@/lib/auth';
import { USER_ROLES } from '@/lib/userRole';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireAdminOrCreator(request: NextRequest): boolean {
  const isCreator =
    request.cookies.get('creator_session')?.value === 'authenticated';
  const isAdmin = request.cookies.get('auth_session')?.value === 'authenticated';
  return isCreator || isAdmin;
}

function authorOf(request: NextRequest): string {
  const ctx = getSessionContext(request);
  return ctx.displayName || (ctx.isCreator ? 'creator' : 'admin');
}

/**
 * Load everything the "การแก้ไขการแจ้งเตือน" screen needs in one round trip:
 * the type catalog, the effective group matrix, the recorded users, and the
 * raw per-user overrides.
 */
export async function GET(request: NextRequest) {
  if (!requireAdminOrCreator(request)) {
    return NextResponse.json(
      { error: 'Admin or Creator session required' },
      { status: 403 },
    );
  }
  try {
    const [users, overrides, config] = await Promise.all([
      readUsersSheet(),
      readNotifUserOverrides(),
      loadNotificationConfig(),
    ]);
    if (users === null || overrides === null) {
      return NextResponse.json(
        { error: 'อ่านข้อมูลการตั้งค่าไม่สำเร็จ' },
        { status: 500 },
      );
    }
    return NextResponse.json({
      types: NOTIFICATION_TYPES,
      roles: USER_ROLES,
      groupMatrix: buildEffectiveGroupMatrix(config),
      users: users.map((u) => ({
        lineUserId: u.lineUserId,
        displayName: u.displayName,
        role: u.role,
      })),
      userOverrides: overrides.map((o) => ({
        lineUserId: o.lineUserId,
        key: o.key,
        enabled: o.enabled,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/notifications failed:', err);
    return NextResponse.json({ error: 'อ่านข้อมูลไม่สำเร็จ' }, { status: 500 });
  }
}

type PutBody = {
  groupMatrix?: Record<string, Record<string, boolean>>;
};

/**
 * Save the group-level matrix. Only cells that differ from the code default
 * are persisted (so "reset" = remove the deviation), mirroring the limit-stock
 * threshold tab.
 */
export async function PUT(request: NextRequest) {
  if (!requireAdminOrCreator(request)) {
    return NextResponse.json(
      { error: 'Admin or Creator session required' },
      { status: 403 },
    );
  }

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const matrix = body.groupMatrix;
  if (!matrix || typeof matrix !== 'object') {
    return NextResponse.json({ error: 'groupMatrix required' }, { status: 400 });
  }

  const deviations: NotifGroupConfigRow[] = [];
  for (const type of NOTIFICATION_TYPES) {
    const row = matrix[type.key] ?? {};
    for (const role of USER_ROLES) {
      const desired = row[role];
      if (typeof desired !== 'boolean') continue; // missing → leave at default
      const isDefault = type.defaultGroups.includes(role);
      if (desired !== isDefault) {
        deviations.push({ key: type.key, role, enabled: desired });
      }
    }
  }

  const ok = await replaceNotifGroupConfig({
    rows: deviations,
    updatedBy: authorOf(request),
  });
  if (!ok) {
    return NextResponse.json(
      { error: 'บันทึกการตั้งค่ากลุ่มไม่สำเร็จ' },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true, deviations: deviations.length });
}

type PostBody = {
  lineUserId?: string;
  displayName?: string;
  /** key → true (force-on) / false (force-off). Absent key = follow group. */
  overrides?: Record<string, boolean>;
};

/**
 * Save one user's per-type overrides. Other users' overrides are preserved:
 * we read the whole tab, drop this user's rows, splice in the new set, and
 * rewrite the merged result.
 */
export async function POST(request: NextRequest) {
  if (!requireAdminOrCreator(request)) {
    return NextResponse.json(
      { error: 'Admin or Creator session required' },
      { status: 403 },
    );
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const lineUserId = (body.lineUserId || '').trim();
  if (!lineUserId) {
    return NextResponse.json({ error: 'lineUserId required' }, { status: 400 });
  }
  const overrides = body.overrides;
  if (!overrides || typeof overrides !== 'object') {
    return NextResponse.json({ error: 'overrides required' }, { status: 400 });
  }

  // Resolve a display name: prefer the supplied one, else look it up.
  let displayName = (body.displayName || '').trim();
  const users = await readUsersSheet();
  if (users === null) {
    return NextResponse.json(
      { error: 'อ่านตารางผู้ใช้งานไม่ได้' },
      { status: 500 },
    );
  }
  if (!users.some((u) => u.lineUserId === lineUserId)) {
    return NextResponse.json({ error: 'ไม่พบผู้ใช้รายนี้' }, { status: 404 });
  }
  if (!displayName) {
    displayName =
      users.find((u) => u.lineUserId === lineUserId)?.displayName || '';
  }

  const existing = await readNotifUserOverrides();
  if (existing === null) {
    return NextResponse.json(
      { error: 'อ่านการตั้งค่ารายบุคคลไม่ได้' },
      { status: 500 },
    );
  }

  const merged: NotifUserOverrideRow[] = existing.filter(
    (o) => o.lineUserId !== lineUserId,
  );
  for (const [key, enabled] of Object.entries(overrides)) {
    if (!isNotificationKey(key) || typeof enabled !== 'boolean') continue;
    merged.push({ lineUserId, displayName, key, enabled });
  }

  const ok = await replaceNotifUserOverrides({
    rows: merged,
    updatedBy: authorOf(request),
  });
  if (!ok) {
    return NextResponse.json(
      { error: 'บันทึกการตั้งค่ารายบุคคลไม่สำเร็จ' },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true });
}
