import { allow, deny } from '../decision';

describe('decision helpers', () => {
  it('allow() returns an unconditionally allowed decision', () => {
    expect(allow()).toEqual({ allowed: true });
  });

  it('deny() attaches the reason code and a default German message', () => {
    const decision = deny('PERMISSION_DENIED');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PERMISSION_DENIED');
    expect(decision.message).toMatch(/Berechtigung/);
  });

  it('deny() allows overriding the default message', () => {
    const decision = deny('NOT_QUALIFIED', 'Custom message');
    expect(decision.message).toBe('Custom message');
  });

  it.each([
    'PERMISSION_DENIED',
    'NOT_QUALIFIED',
    'CROSS_TENANT_ACCESS_DENIED',
    'UNAUTHENTICATED',
  ] as const)('deny(%s) always produces a non-empty message', (reason) => {
    const decision = deny(reason);
    expect(decision.message).toBeTruthy();
  });
});
