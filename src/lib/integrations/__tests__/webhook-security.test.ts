import { signWebhookPayload, verifyWebhookSignature } from '../webhook-signature';
import { checkWebhookUrl, isPrivateAddress } from '../safe-url';

describe('Webhook-Signatur', () => {
  const secret = 'shared-secret';
  const body = JSON.stringify({ eventType: 'work_step.completed' });
  const timestamp = '1786000000';

  it('verifies what it signed', () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, timestamp, body, signature)).toBe(true);
  });

  it('rejects a different secret, body or timestamp', () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature('anderes-geheimnis', timestamp, body, signature)).toBe(false);
    expect(verifyWebhookSignature(secret, timestamp, body + ' ', signature)).toBe(false);
    // The timestamp is INSIDE the signed material — a signature over the body
    // alone could be replayed forever.
    expect(verifyWebhookSignature(secret, '1786000001', body, signature)).toBe(false);
  });

  it('is not fooled by a truncated signature', () => {
    const signature = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature(secret, timestamp, body, signature.slice(0, -2))).toBe(false);
  });
});

describe('isPrivateAddress', () => {
  // The list that matters: these are the addresses an SSRF wants to reach.
  it.each([
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'unspecified'],
    ['10.1.2.3', 'privat'],
    ['172.16.0.1', 'privat'],
    ['172.31.255.254', 'privat'],
    ['192.168.1.1', 'privat'],
    ['169.254.169.254', 'Cloud-Metadaten'],
    ['100.64.0.1', 'CGNAT'],
    ['::1', 'loopback v6'],
    ['fe80::1', 'link-local v6'],
    ['fd00::1', 'unique local v6'],
    ['::ffff:127.0.0.1', 'v4-mapped loopback'],
  ])('refuses %s (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([['93.184.216.34'], ['8.8.8.8'], ['2606:2800:220:1:248:1893:25c8:1946']])(
    'allows the public address %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it('refuses anything that is not an address at all', () => {
    // Failing closed: the caller resolved something unexpected.
    expect(isPrivateAddress('nicht-einmal-eine-adresse')).toBe(true);
  });
});

describe('checkWebhookUrl', () => {
  it('refuses a literal loopback address without any DNS lookup', async () => {
    await expect(checkWebhookUrl('http://127.0.0.1:9999/hook')).resolves.toMatchObject({
      ok: false,
      reason: 'PRIVATE_ADDRESS',
    });
  });

  it('refuses the cloud metadata address', async () => {
    await expect(
      checkWebhookUrl('http://169.254.169.254/latest/meta-data/'),
    ).resolves.toMatchObject({ ok: false, reason: 'PRIVATE_ADDRESS' });
  });

  it('refuses a name that resolves to loopback, however it is spelled', async () => {
    // The reason the check inspects the ADDRESS and not the hostname: a
    // string blocklist of "localhost" catches nothing.
    await expect(checkWebhookUrl('http://localhost:3000/hook')).resolves.toMatchObject({
      ok: false,
      reason: 'PRIVATE_ADDRESS',
    });
  });

  it('refuses schemes that are not http(s)', async () => {
    await expect(checkWebhookUrl('file:///etc/passwd')).resolves.toMatchObject({
      ok: false,
      reason: 'UNSUPPORTED_SCHEME',
    });
  });

  it('requires https in production', async () => {
    await expect(
      checkWebhookUrl('http://example.com/hook', { requireHttps: true }),
    ).resolves.toMatchObject({ ok: false, reason: 'INSECURE_SCHEME_IN_PRODUCTION' });
  });

  it('refuses a host that does not resolve', async () => {
    await expect(checkWebhookUrl('https://kein-solcher-host.invalid/hook')).resolves.toMatchObject({
      ok: false,
      reason: 'UNRESOLVABLE_HOST',
    });
  });
});
