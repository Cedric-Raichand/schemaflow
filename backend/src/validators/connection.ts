import type { ConnectionParams, SslMode } from '../types/schema.js';

/** A problem with what the user typed. Messages are safe to show to the user. */
export class ValidationError extends Error {}

const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;
const IPV6_RE = /^[0-9A-Fa-f:.]{2,45}$/;
const IDENT_RE = /^[^\u0000-\u001f\u007f]{1,128}$/; // any printable, no control chars
const SSL_MODES: SslMode[] = ['disable', 'require', 'verify'];

function str(v: unknown, field: string, max: number, required = true): string {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${field} is required.`);
    return '';
  }
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text.`);
  if (v.length > max) throw new ValidationError(`${field} is too long.`);
  return v;
}

export function parseConnection(body: unknown): ConnectionParams {
  if (!body || typeof body !== 'object') throw new ValidationError('Connection details are required.');
  const b = body as Record<string, unknown>;

  const host = str(b.host, 'Host', 253).trim();
  if (!HOST_RE.test(host) && !IPV6_RE.test(host)) throw new ValidationError('Host contains invalid characters.');

  const port = b.port === undefined || b.port === '' ? 5432 : Number(b.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ValidationError('Port must be between 1 and 65535.');

  const database = str(b.database, 'Database', 128).trim();
  const user = str(b.user, 'User', 128).trim();
  if (!IDENT_RE.test(database)) throw new ValidationError('Database name contains invalid characters.');
  if (!IDENT_RE.test(user)) throw new ValidationError('User contains invalid characters.');
  const password = str(b.password, 'Password', 256, false);

  const sslMode = (b.sslMode ?? 'require') as SslMode;
  if (!SSL_MODES.includes(sslMode)) throw new ValidationError('Unknown SSL mode.');

  let schemas: string[] = ['public'];
  if (b.schemas !== undefined) {
    if (!Array.isArray(b.schemas) || b.schemas.length === 0 || b.schemas.length > 20) {
      throw new ValidationError('Choose between 1 and 20 schemas.');
    }
    schemas = b.schemas.map((s) => str(s, 'Schema', 63).trim());
    if (schemas.some((s) => !IDENT_RE.test(s))) throw new ValidationError('Schema name contains invalid characters.');
  }

  return { host, port, database, user, password, sslMode, schemas };
}