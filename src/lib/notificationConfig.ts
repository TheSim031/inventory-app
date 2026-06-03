/**
 * Notification permission model — the single source of truth for "who is
 * allowed to receive which LINE notification".
 *
 * Layers, highest priority first:
 *   1. Per-user override  (ตั้งค่าแจ้งเตือน-รายบุคคล) — force-on / force-off a
 *      single notification type for one LINE user.
 *   2. Group default      (ตั้งค่าแจ้งเตือน-กลุ่ม)    — on/off per (type × role),
 *      stored only when it deviates from the code default below.
 *   3. Code default        (NOTIFICATION_TYPES.defaultGroups) — reproduces the
 *      original hard-coded routing so a fresh spreadsheet behaves identically.
 *
 * Every LINE send funnels through resolveNotificationRecipients (broadcasts)
 * or isUserAllowed (personal pushes) so the gate can never be bypassed.
 */
import {
  readNotifGroupConfig,
  readNotifUserOverrides,
  readUsersSheet,
} from './googleSheets';
import { isUserRole, USER_ROLES, type UserRole } from './userRole';

export type NotificationDelivery = 'broadcast' | 'personal';

export const NOTIFICATION_KEYS = [
  'REQ_SUBMITTED',
  'IN_RECORDED',
  'OUT_RECORDED',
  'OUT_CONFIRM',
  'PICK_COMPLETE',
  'REQ_REJECTED',
  'INSPECT_NEW_WAREHOUSE',
  'INSPECT_NEW_QC',
  'QC_COMPLETE',
  'LOW_STOCK_DAILY',
  'LOW_STOCK_URGENT',
  'MONTHLY_CLEANUP',
] as const;

export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

export type NotificationTypeDef = {
  key: NotificationKey;
  label: string;
  description: string;
  /** broadcast = sent to every allowed group member; personal = single push. */
  delivery: NotificationDelivery;
  /** Roles that receive this notification by default (the legacy routing). */
  defaultGroups: UserRole[];
};

const ALL_ROLES: UserRole[] = [...USER_ROLES];

/**
 * Catalog of every notification the system emits, scanned from the existing
 * LINE dispatch code. Order here drives the order rows appear in the admin UI.
 */
export const NOTIFICATION_TYPES: NotificationTypeDef[] = [
  {
    key: 'REQ_SUBMITTED',
    label: 'ใบเบิกใหม่รอจัดของ',
    description: 'แจ้งคลังเมื่อมีการส่งใบเบิกสินค้าใหม่เข้ามารอจัดของ',
    delivery: 'broadcast',
    defaultGroups: ['WAREHOUSE'],
  },
  {
    key: 'IN_RECORDED',
    label: 'บันทึกการรับเข้า',
    description: 'แจ้งคลังเมื่อมีการบันทึกรับของเข้าคลัง',
    delivery: 'broadcast',
    defaultGroups: ['WAREHOUSE'],
  },
  {
    key: 'OUT_RECORDED',
    label: 'บันทึกการเบิกออก (แจ้งคลัง)',
    description: 'แจ้งคลังเมื่อมีการเบิกสินค้าออกจากระบบ',
    delivery: 'broadcast',
    defaultGroups: ['WAREHOUSE'],
  },
  {
    key: 'OUT_CONFIRM',
    label: 'ยืนยันคำขอเบิก (แจ้งผู้เบิก)',
    description: 'ส่งข้อความยืนยันกลับไปยังผู้เบิกหลังบันทึกการเบิก',
    delivery: 'personal',
    defaultGroups: ALL_ROLES,
  },
  {
    key: 'PICK_COMPLETE',
    label: 'จัดของเสร็จแล้ว (แจ้งผู้ขอ)',
    description: 'แจ้งผู้ขอเบิกเมื่อคลังจัดของตามใบเบิกเสร็จ',
    delivery: 'personal',
    defaultGroups: ALL_ROLES,
  },
  {
    key: 'REQ_REJECTED',
    label: 'ใบเบิกถูกปฏิเสธ (แจ้งผู้ขอ)',
    description: 'แจ้งผู้ขอเบิกเมื่อใบเบิกถูกปฏิเสธ',
    delivery: 'personal',
    defaultGroups: ALL_ROLES,
  },
  {
    key: 'INSPECT_NEW_WAREHOUSE',
    label: 'รับของใหม่ — แจ้งคลังตรวจสอบ',
    description: 'แจ้งคลังเมื่อมีของใหม่เข้ามารอตรวจสอบ (พร้อมรูปแนบ)',
    delivery: 'broadcast',
    defaultGroups: ['WAREHOUSE'],
  },
  {
    key: 'INSPECT_NEW_QC',
    label: 'ให้มาตรวจของ (แจ้ง QC)',
    description: 'แจ้งฝ่าย QC เมื่อมีของใหม่ที่ต้องตรวจสอบ',
    delivery: 'broadcast',
    defaultGroups: ['QC'],
  },
  {
    key: 'QC_COMPLETE',
    label: 'QC ตรวจสอบเสร็จ (แจ้งผู้บริหาร)',
    description: 'แจ้งผู้บริหารเมื่อ QC ตรวจสอบของเสร็จเรียบร้อย',
    delivery: 'broadcast',
    defaultGroups: ['EXECUTIVE'],
  },
  {
    key: 'LOW_STOCK_DAILY',
    label: 'สรุปสต็อกต่ำประจำวัน (แจ้งจัดซื้อ)',
    description: 'สรุปรายการสต็อกต่ำกว่าเกณฑ์ส่งให้ฝ่ายจัดซื้อทุกเช้า',
    delivery: 'broadcast',
    defaultGroups: ['PURCHASING'],
  },
  {
    key: 'LOW_STOCK_URGENT',
    label: 'สินค้าหมดคลังด่วน (แจ้งจัดซื้อ)',
    description: 'แจ้งฝ่ายจัดซื้อทันทีเมื่อมีสินค้ายอดคงเหลือเหลือ 0',
    delivery: 'broadcast',
    defaultGroups: ['PURCHASING'],
  },
  {
    key: 'MONTHLY_CLEANUP',
    label: 'เตือนลบประวัติตรวจสอบ (แจ้งคลัง)',
    description: 'เตือนคลังให้ลบประวัติตรวจสอบเพื่อรักษาพื้นที่จัดเก็บต้นเดือน',
    delivery: 'broadcast',
    defaultGroups: ['WAREHOUSE'],
  },
];

const CATALOG_BY_KEY = new Map<string, NotificationTypeDef>(
  NOTIFICATION_TYPES.map((t) => [t.key, t]),
);

export function isNotificationKey(value: unknown): value is NotificationKey {
  return typeof value === 'string' && CATALOG_BY_KEY.has(value);
}

export type NotificationConfig = {
  /** key → role → enabled. Only deviations from defaults are present. */
  group: Map<string, Map<string, boolean>>;
  /** lineUserId → key → enabled. Explicit per-user overrides. */
  user: Map<string, Map<string, boolean>>;
};

export async function loadNotificationConfig(): Promise<NotificationConfig> {
  const [groupRows, userRows] = await Promise.all([
    readNotifGroupConfig(),
    readNotifUserOverrides(),
  ]);

  const group = new Map<string, Map<string, boolean>>();
  for (const r of groupRows ?? []) {
    if (!group.has(r.key)) group.set(r.key, new Map());
    group.get(r.key)!.set(r.role, r.enabled);
  }

  const user = new Map<string, Map<string, boolean>>();
  for (const r of userRows ?? []) {
    if (!user.has(r.lineUserId)) user.set(r.lineUserId, new Map());
    user.get(r.lineUserId)!.set(r.key, r.enabled);
  }

  return { group, user };
}

/** Effective on/off for a (type × role) pair, after applying group deviations. */
export function isGroupEnabled(
  config: NotificationConfig,
  key: string,
  role: string,
): boolean {
  const deviation = config.group.get(key)?.get(role);
  if (deviation !== undefined) return deviation;
  const def = CATALOG_BY_KEY.get(key);
  return def ? def.defaultGroups.includes(role as UserRole) : false;
}

/**
 * Effective on/off for one user (role known). Per-user override wins; otherwise
 * falls back to the group default for the user's role. An unknown / unset role
 * is treated as "not in any default group" → off for broadcasts.
 */
function isUserEnabledForBroadcast(
  config: NotificationConfig,
  key: string,
  lineUserId: string,
  role: string,
): boolean {
  const override = config.user.get(lineUserId)?.get(key);
  if (override !== undefined) return override;
  if (!isUserRole(role)) return false;
  return isGroupEnabled(config, key, role);
}

/**
 * Resolve the LINE userIds that should receive a broadcast of `key`. Scans
 * every recorded user and keeps those whose effective permission is on — so a
 * per-user override can both add a recipient outside the default groups and
 * remove one inside them.
 */
export async function resolveNotificationRecipients(
  key: string,
): Promise<{ ids: string[]; missingLineUserId: number }> {
  const [users, config] = await Promise.all([
    readUsersSheet(),
    loadNotificationConfig(),
  ]);
  if (!users) return { ids: [], missingLineUserId: 0 };

  const ids = new Set<string>();
  let missingLineUserId = 0;
  for (const u of users) {
    if (!isUserEnabledForBroadcast(config, key, u.lineUserId, u.role)) continue;
    if (!u.lineUserId) {
      missingLineUserId += 1;
      continue;
    }
    ids.add(u.lineUserId);
  }
  return { ids: Array.from(ids), missingLineUserId };
}

/**
 * Permission check for a personal push to a single LINE user. Per-user
 * override wins; otherwise the group default for that user's role applies.
 *
 * Fail-open when the user can't be found in the Users sheet: personal
 * confirmations (pick complete / rejected / your-request) should not be
 * silently dropped just because someone isn't tracked yet. An admin can still
 * force-off such a user with an explicit per-user override, which is honored
 * here before the lookup.
 */
export async function isUserAllowed(
  key: string,
  lineUserId: string,
): Promise<boolean> {
  if (!lineUserId) return false;
  const config = await loadNotificationConfig();

  const override = config.user.get(lineUserId)?.get(key);
  if (override !== undefined) return override;

  const users = await readUsersSheet();
  const row = users?.find((u) => u.lineUserId === lineUserId);
  if (!row || !isUserRole(row.role)) return true;
  return isGroupEnabled(config, key, row.role);
}

/** Full effective (type × role) matrix — used to seed the admin UI. */
export function buildEffectiveGroupMatrix(
  config: NotificationConfig,
): Record<string, Record<string, boolean>> {
  const matrix: Record<string, Record<string, boolean>> = {};
  for (const t of NOTIFICATION_TYPES) {
    matrix[t.key] = {};
    for (const role of USER_ROLES) {
      matrix[t.key][role] = isGroupEnabled(config, t.key, role);
    }
  }
  return matrix;
}
