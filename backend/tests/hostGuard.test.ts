import { describe, expect, it } from 'vitest';
import { isBlockedIp, normalizeIp, policyFromEnv, resolveAllowedHost, type HostPolicy } from '../src/services/introspection/hostGuard.js';

const open: HostPolicy = { allowPrivate: true, allowlist: null, allowedPorts: null };
const strict: HostPolicy = { allowPrivate: false, allowlist: null, allowedPorts: null };

describe('isBlockedIp', () => {
  it('always blocks cloud metadata and link-local', () => {
    expect(isBlockedIp('169.254.169.254', true)).toBe(true);
    expect(isBlockedIp('169.254.169.254', false)).toBe(true);
    expect(isBlockedIp('fe80::1', true)).toBe(true);
  });
  it('always blocks unspecified and multicast', () => {
    expect(isBlockedIp('0.0.0.0', true)).toBe(true);
    expect(isBlockedIp('::', true)).toBe(true);
    expect(isBlockedIp('224.0.0.1', true)).toBe(true);
  });
  it('blocks loopback and private ranges only when private is not allowed', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '172.31.255.1', '192.168.1.10', '100.64.0.1', '::1', 'fd00::1']) {
      expect(isBlockedIp(ip, false), ip).toBe(true);
      expect(isBlockedIp(ip, true), ip).toBe(false);
    }
  });
  it('allows public addresses', () => {
    expect(isBlockedIp('8.8.8.8', false)).toBe(false);
    expect(isBlockedIp('172.32.0.1', false)).toBe(false);
    expect(isBlockedIp('2606:4700:4700::1111', false)).toBe(false);
  });
  it('sees through IPv4-mapped IPv6', () => {
    expect(normalizeIp('::ffff:127.0.0.1').address).toBe('127.0.0.1');
    expect(isBlockedIp('::ffff:127.0.0.1', false)).toBe(true);
    expect(isBlockedIp('::ffff:7f00:1', false)).toBe(true);
    expect(isBlockedIp('::ffff:169.254.169.254', true)).toBe(true);
  });
});

describe('resolveAllowedHost', () => {
  const resolve = (map: Record<string, string[]>) => async (h: string) => (map[h.toLowerCase()] ?? []).map((address) => ({ address }));

  it('returns the pinned IP for an allowed host name', async () => {
    expect(await resolveAllowedHost('db.example.com', 5432, strict, resolve({ 'db.example.com': ['8.8.4.4'] }))).toBe('8.8.4.4');
  });
  it('blocks a name that resolves to a private IP (DNS pointing inwards)', async () => {
    await expect(resolveAllowedHost('evil.example.com', 5432, strict, resolve({ 'evil.example.com': ['10.0.0.5'] }))).rejects.toThrow(/not allowed/);
  });
  it('blocks if ANY resolved address is bad', async () => {
    await expect(resolveAllowedHost('mixed.example.com', 5432, strict, resolve({ 'mixed.example.com': ['8.8.8.8', '192.168.0.1'] }))).rejects.toThrow(/not allowed/);
  });
  it('blocks metadata IP even when private hosts are allowed', async () => {
    await expect(resolveAllowedHost('169.254.169.254', 5432, open)).rejects.toThrow(/not allowed/);
  });
  it('allows localhost only when private hosts are allowed', async () => {
    expect(await resolveAllowedHost('127.0.0.1', 5432, open)).toBe('127.0.0.1');
    await expect(resolveAllowedHost('127.0.0.1', 5432, strict)).rejects.toThrow(/not allowed/);
  });
  it('enforces allowlist and ports', async () => {
    const p: HostPolicy = { allowPrivate: false, allowlist: ['db.example.com'], allowedPorts: [5432] };
    const r = resolve({ 'db.example.com': ['8.8.8.8'], 'other.com': ['8.8.8.8'] });
    expect(await resolveAllowedHost('DB.example.com', 5432, p, r)).toBe('8.8.8.8');
    await expect(resolveAllowedHost('other.com', 5432, p, r)).rejects.toThrow(/not allowed/);
    await expect(resolveAllowedHost('db.example.com', 6379, p, r)).rejects.toThrow(/port/);
  });
  it('reports unresolvable names', async () => {
    await expect(resolveAllowedHost('nope.invalid', 5432, strict, resolve({}))).rejects.toThrow(/resolve/);
  });
});

describe('policyFromEnv', () => {
  it('defaults to allowing private hosts outside production only', () => {
    expect(policyFromEnv({}).allowPrivate).toBe(true);
    expect(policyFromEnv({ NODE_ENV: 'production' }).allowPrivate).toBe(false);
    expect(policyFromEnv({ NODE_ENV: 'production', SCHEMAFLOW_ALLOW_PRIVATE_HOSTS: 'true' }).allowPrivate).toBe(true);
  });
  it('parses lists', () => {
    const p = policyFromEnv({ SCHEMAFLOW_HOST_ALLOWLIST: 'A.com, b.com', SCHEMAFLOW_ALLOWED_PORTS: '5432,5433' });
    expect(p.allowlist).toEqual(['a.com', 'b.com']);
    expect(p.allowedPorts).toEqual([5432, 5433]);
  });
});