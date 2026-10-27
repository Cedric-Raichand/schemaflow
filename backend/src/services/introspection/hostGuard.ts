import dns from 'node:dns/promises';
import net from 'node:net';
import { ValidationError } from '../../validators/connection.js';

export interface HostPolicy {
  /** Allow loopback / private-network targets (fine on your own laptop, not on a public server). */
  allowPrivate: boolean;
  /** If set, only these hostnames/IPs may be used. */
  allowlist: string[] | null;
  /** If set, only these ports may be used. */
  allowedPorts: number[] | null;
}

export function policyFromEnv(env: NodeJS.ProcessEnv = process.env): HostPolicy {
  const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
  return {
    allowPrivate: env.SCHEMAFLOW_ALLOW_PRIVATE_HOSTS
      ? env.SCHEMAFLOW_ALLOW_PRIVATE_HOSTS === 'true'
      : env.NODE_ENV !== 'production',
    allowlist: list(env.SCHEMAFLOW_HOST_ALLOWLIST)?.map((h) => h.toLowerCase()) ?? null,
    allowedPorts: list(env.SCHEMAFLOW_ALLOWED_PORTS)?.map(Number).filter(Number.isInteger) ?? null,
  };
}

// Never allowed, whatever the policy: cloud metadata (169.254.169.254), unspecified, multicast, reserved.
const ALWAYS = new net.BlockList();
ALWAYS.addSubnet('0.0.0.0', 8, 'ipv4');
ALWAYS.addSubnet('169.254.0.0', 16, 'ipv4');
ALWAYS.addSubnet('224.0.0.0', 4, 'ipv4');
ALWAYS.addSubnet('240.0.0.0', 4, 'ipv4');
ALWAYS.addAddress('::', 'ipv6');
ALWAYS.addSubnet('fe80::', 10, 'ipv6');
ALWAYS.addSubnet('ff00::', 8, 'ipv6');

// Blocked unless allowPrivate: loopback and private ranges.
const PRIVATE = new net.BlockList();
PRIVATE.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE.addAddress('::1', 'ipv6');
PRIVATE.addSubnet('fc00::', 7, 'ipv6');

/** Turn ::ffff:127.0.0.1 and ::ffff:7f00:1 back into plain IPv4 so they can't dodge the checks. */
export function normalizeIp(ip: string): { address: string; family: 'ipv4' | 'ipv6' } {
  const lower = ip.toLowerCase();
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return { address: dotted[1], family: 'ipv4' };
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    return { address: [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'), family: 'ipv4' };
  }
  return { address: lower, family: net.isIPv6(lower) ? 'ipv6' : 'ipv4' };
}

export function isBlockedIp(ip: string, allowPrivate: boolean): boolean {
  const { address, family } = normalizeIp(ip);
  if (ALWAYS.check(address, family)) return true;
  return !allowPrivate && PRIVATE.check(address, family);
}

export type Resolver = (host: string) => Promise<{ address: string }[]>;
const systemResolver: Resolver = (host) => dns.lookup(host, { all: true, verbatim: true });

const DENIED = 'That host is not allowed. SchemaFlow only connects to databases it is permitted to reach.';

/**
 * Validates the target and returns ONE resolved IP. The caller must connect to that IP
 * (not the hostname again), otherwise DNS could answer differently the second time (DNS rebinding).
 */
export async function resolveAllowedHost(
  host: string, port: number, policy: HostPolicy, resolver: Resolver = systemResolver,
): Promise<string> {
  if (policy.allowedPorts && !policy.allowedPorts.includes(port)) {
    throw new ValidationError('That port is not allowed.');
  }
  if (policy.allowlist && !policy.allowlist.includes(host.toLowerCase())) throw new ValidationError(DENIED);

  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await resolver(host)).map((a) => a.address);
    } catch {
      throw new ValidationError('Could not resolve that host name.');
    }
  }
  if (addresses.length === 0) throw new ValidationError('Could not resolve that host name.');
  // Every address must be acceptable, so a mixed public/private answer cannot sneak through.
  if (addresses.some((a) => isBlockedIp(a, policy.allowPrivate))) throw new ValidationError(DENIED);
  return addresses[0];
}