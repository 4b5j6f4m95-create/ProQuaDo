import { PERMISSIONS } from '../permissions-catalog';
import { SYSTEM_ROLES } from '../system-roles';

const VALID_CODES = new Set(PERMISSIONS.map((p) => p.code));

describe('system-roles.ts ↔ permissions-catalog.ts consistency', () => {
  for (const [roleCode, def] of Object.entries(SYSTEM_ROLES)) {
    it(`${roleCode}: every granted permission exists in the catalog`, () => {
      for (const permCode of def.permissions) {
        expect(VALID_CODES.has(permCode)).toBe(true);
      }
    });

    it(`${roleCode}: no duplicate permission grants`, () => {
      const unique = new Set(def.permissions);
      expect(unique.size).toBe(def.permissions.length);
    });
  }

  it('defines exactly the seven roles from docs/03 Nutzergruppen', () => {
    expect(Object.keys(SYSTEM_ROLES).sort()).toEqual(
      [
        'ADMIN',
        'AUDITOR',
        'INSPECTOR',
        'PRODUCTION_MANAGER',
        'PROJECT_LEAD',
        'QUALITY_MANAGER',
        'WORKER',
      ].sort(),
    );
  });
});

// Regression tests protecting specific business rules from
// docs/04_ROLES_PERMISSIONS_MATRIX.md against accidental future edits.
describe('business rule: ADMIN has no automatic fachliche Freigabe (Geschäftsgrundsatz 1)', () => {
  it.each(['document.approve', 'document.release', 'production_plan.release', 'ncr.disposition'])(
    'ADMIN does not have %s by default',
    (permission) => {
      expect(SYSTEM_ROLES.ADMIN.permissions).not.toContain(permission);
    },
  );
});

describe('business rule: WORKER cannot self-approve quality decisions', () => {
  it.each([
    'ncr.disposition',
    'production_hold.release',
    'document.release',
    'second_approval.decide',
  ])('WORKER does not have %s', (permission) => {
    expect(SYSTEM_ROLES.WORKER.permissions).not.toContain(permission);
  });
});

describe('business rule: only QUALITY_MANAGER and INSPECTOR decide second approvals by default', () => {
  it('exactly QUALITY_MANAGER and INSPECTOR hold second_approval.decide', () => {
    const holders = Object.entries(SYSTEM_ROLES)
      .filter(([, def]) =>
        (def.permissions as readonly string[]).includes('second_approval.decide'),
      )
      .map(([code]) => code)
      .sort();
    expect(holders).toEqual(['INSPECTOR', 'QUALITY_MANAGER']);
  });
});
