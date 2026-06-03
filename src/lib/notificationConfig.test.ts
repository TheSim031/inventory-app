import { describe, it, expect, vi } from 'vitest';

// Mock the Sheets layer so importing notificationConfig doesn't pull in
// googleapis or hit the network — we only test the pure permission logic.
vi.mock('./googleSheets', () => ({
  readNotifGroupConfig: vi.fn(),
  readNotifUserOverrides: vi.fn(),
  readUsersSheet: vi.fn(),
}));

import {
  isNotificationKey,
  isGroupEnabled,
  buildEffectiveGroupMatrix,
  NOTIFICATION_TYPES,
  type NotificationConfig,
} from './notificationConfig';

const emptyConfig = (): NotificationConfig => ({
  group: new Map(),
  user: new Map(),
});

describe('isNotificationKey', () => {
  it('accepts known keys and rejects unknown ones', () => {
    expect(isNotificationKey('REQ_SUBMITTED')).toBe(true);
    expect(isNotificationKey('NOPE')).toBe(false);
    expect(isNotificationKey(123)).toBe(false);
  });
});

describe('isGroupEnabled', () => {
  it('uses the code default when there is no deviation', () => {
    const cfg = emptyConfig();
    // REQ_SUBMITTED defaults to WAREHOUSE only.
    expect(isGroupEnabled(cfg, 'REQ_SUBMITTED', 'WAREHOUSE')).toBe(true);
    expect(isGroupEnabled(cfg, 'REQ_SUBMITTED', 'QC')).toBe(false);
  });

  it('honours a stored deviation over the default', () => {
    const cfg = emptyConfig();
    cfg.group.set('REQ_SUBMITTED', new Map([['QC', true], ['WAREHOUSE', false]]));
    expect(isGroupEnabled(cfg, 'REQ_SUBMITTED', 'QC')).toBe(true);
    expect(isGroupEnabled(cfg, 'REQ_SUBMITTED', 'WAREHOUSE')).toBe(false);
  });

  it('returns false for an unknown notification key', () => {
    expect(isGroupEnabled(emptyConfig(), 'UNKNOWN', 'WAREHOUSE')).toBe(false);
  });
});

describe('buildEffectiveGroupMatrix', () => {
  it('reproduces the code defaults for an empty config', () => {
    const matrix = buildEffectiveGroupMatrix(emptyConfig());
    for (const t of NOTIFICATION_TYPES) {
      for (const role of Object.keys(matrix[t.key])) {
        expect(matrix[t.key][role]).toBe(
          t.defaultGroups.includes(role as never),
        );
      }
    }
  });
});
