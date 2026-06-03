import { describe, it, expect } from 'vitest';
import {
  getVisibleMenuIds,
  getAllMenuIds,
  ROLE_MENU_IDS,
} from './menu';

describe('getVisibleMenuIds', () => {
  it('returns every menu id for the creator', () => {
    const ids = getVisibleMenuIds({ role: null, isCreator: true });
    expect(ids).toContain('dashboard');
    expect(ids).toContain('admin-audit');
    expect(ids).toContain('admin-notifications');
  });

  it('treats admin (staff) like the creator', () => {
    const creator = getVisibleMenuIds({ role: null, isCreator: true });
    const admin = getVisibleMenuIds({ role: null, isCreator: false, isAdmin: true });
    expect(admin.sort()).toEqual(creator.sort());
  });

  it('falls back to the role default when not a power user', () => {
    const ids = getVisibleMenuIds({ role: 'WAREHOUSE', isCreator: false });
    expect(ids).toEqual(ROLE_MENU_IDS.WAREHOUSE);
    expect(ids).not.toContain('admin-audit');
  });

  it('custom menus override the role default', () => {
    const ids = getVisibleMenuIds({
      role: 'WAREHOUSE',
      isCreator: false,
      customMenus: ['dashboard', 'request'],
    });
    expect(ids).toEqual(['dashboard', 'request']);
  });

  it('returns nothing for an unauthenticated user with no role', () => {
    expect(getVisibleMenuIds({ role: null, isCreator: false })).toEqual([]);
  });

  it('ASSEMBLY cannot see the dashboard or limit-stock', () => {
    expect(ROLE_MENU_IDS.ASSEMBLY).not.toContain('dashboard');
    expect(ROLE_MENU_IDS.ASSEMBLY).not.toContain('limit-stock');
  });
});

describe('getAllMenuIds', () => {
  it('omits creator-only items by default', () => {
    const ids = getAllMenuIds().map((m) => m.id);
    expect(ids).toContain('dashboard');
    expect(ids).not.toContain('admin');
    expect(ids).not.toContain('admin-audit');
  });

  it('includes creator-only items when asked', () => {
    const ids = getAllMenuIds(true).map((m) => m.id);
    expect(ids).toContain('admin-audit');
  });
});
