import { ValidationError } from '../../validators/connection.js';

/** Maps driver errors to messages that are useful but never echo credentials or raw driver text. */
export function toFriendlyError(e: unknown): Error {
  if (e instanceof ValidationError) return e;
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? '';
  const msg = String(err?.message ?? '');
  // Opt-in for developers: code + driver message only (these never contain the password).
  if (process.env.SCHEMAFLOW_DEBUG) console.error('[introspection]', code || 'no-code', msg);

  if (code === '28P01' || code === '28000') return new ValidationError('Authentication failed. Check the user and password.');
  if (code === '3D000') return new ValidationError('That database does not exist on the server.');
  if (code === '42501') return new ValidationError('The user does not have permission to read the database structure.');
  if (code === '57014' || /timeout|timed out/i.test(msg) || code === 'ETIMEDOUT') {
    return new ValidationError('The connection or query timed out.');
  }
  if (code === 'ECONNREFUSED') return new ValidationError('Connection refused. Is the database running, and is the port right?');
  if (code === 'ENOTFOUND') return new ValidationError('Could not resolve that host name.');
  if (code === 'ECONNRESET') return new ValidationError('The server closed the connection.');
  if (/does not support SSL/i.test(msg)) return new ValidationError('The server does not support SSL. Set SSL to "disable" if you trust the network.');
  if (/self[- ]signed|certificate|unable to verify/i.test(msg)) {
    return new ValidationError('The server certificate could not be verified. Use SSL "require" to encrypt without verifying.');
  }
  if (/pg_hba|no encryption/i.test(msg)) return new ValidationError('The server rejected the connection (check SSL setting and server access rules).');
  return new ValidationError('Could not read the database structure.');
}