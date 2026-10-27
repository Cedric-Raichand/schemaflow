import net from 'node:net';
import pg from 'pg';
import type {
  Column, ConnectionParams, IndexInfo, Relationship, SchemaModel, Table,
} from '../../types/schema.js';
import { ValidationError } from '../../validators/connection.js';
import { finalizeModel } from '../schemaBuilder.js';
import { toFriendlyError } from './errors.js';
import { resolveAllowedHost, type HostPolicy, type Resolver } from './hostGuard.js';

const { Client } = pg;

const MAX_TABLES = 1500;
const MAX_COLUMNS = 60000;

type Client = InstanceType<typeof Client>;

export interface ConnectionInfo {
  serverVersion: string;
  database: string;
  user: string;
  warnings: string[];
}

/**
 * Opens a connection that can only read. Everything runs in a READ ONLY transaction that is always
 * rolled back, with connect/statement timeouts, against the single IP the host guard approved.
 */
export async function withReadOnlyClient<T>(
  params: ConnectionParams, policy: HostPolicy, fn: (c: Client) => Promise<T>, resolver?: Resolver,
): Promise<T> {
  const address = await resolveAllowedHost(params.host, params.port, policy, resolver);
  const isIpHost = net.isIP(params.host) !== 0;

  const client = new Client({
    host: address, // pinned IP, not the hostname
    port: params.port,
    database: params.database,
    user: params.user,
    password: params.password,
    ssl: params.sslMode === 'disable'
      ? false
      : { rejectUnauthorized: params.sslMode === 'verify', ...(isIpHost ? {} : { servername: params.host }) },
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000,
    query_timeout: 20000,
    idle_in_transaction_session_timeout: 30000,
    application_name: 'SchemaFlow',
  });
  client.on('error', () => { /* connection dropped; surfaced by the pending query */ });

  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    return await fn(client);
  } catch (e) {
    throw toFriendlyError(e);
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be gone */ }
    try { await client.end(); } catch { /* ignore */ }
  }
}

async function resolveSchemas(c: Client, wanted: string[]): Promise<string[]> {
  const { rows } = await c.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
      ORDER BY nspname`,
  );
  const existing = rows.map((r) => r.nspname);
  if (wanted.includes('*')) return existing;
  const missing = wanted.filter((s) => !existing.includes(s));
  if (missing.length) throw new ValidationError(`Schema not found: ${missing.slice(0, 3).join(', ')}`);
  return wanted;
}

async function privilegeWarnings(c: Client, schemas: string[]): Promise<string[]> {
  const { rows } = await c.query<{ rolsuper: boolean; can_write: boolean }>(
    `SELECT r.rolsuper,
       EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r','p') AND n.nspname = ANY($1)
                  AND (has_table_privilege(c.oid,'INSERT') OR has_table_privilege(c.oid,'UPDATE')
                    OR has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE'))) AS can_write
       FROM pg_roles r WHERE r.rolname = current_user`,
    [schemas],
  );
  const w: string[] = [];
  if (rows[0]?.rolsuper) w.push('You are connected as a superuser. SchemaFlow only reads structure, but please use a read-only role (see docs/read-only-role.md).');
  else if (rows[0]?.can_write) w.push('This database user can modify data. SchemaFlow only reads structure, but a read-only role is safer (see docs/read-only-role.md).');
  return w;
}

export async function testPostgresConnection(
  params: ConnectionParams, policy: HostPolicy, resolver?: Resolver,
): Promise<ConnectionInfo> {
  return withReadOnlyClient(params, policy, async (c) => {
    const v = await c.query<{ server_version: string; db: string; usr: string }>(
      'SELECT current_setting($1) AS server_version, current_database() AS db, current_user AS usr', ['server_version'],
    );
    const schemas = await resolveSchemas(c, params.schemas);
    return {
      serverVersion: v.rows[0].server_version,
      database: v.rows[0].db,
      user: v.rows[0].usr,
      warnings: await privilegeWarnings(c, schemas),
    };
  }, resolver);
}

const TYPE_ALIASES: [RegExp, string][] = [
  [/^character varying/i, 'VARCHAR'],
  [/^character\b/i, 'CHAR'],
  [/^timestamp without time zone/i, 'TIMESTAMP'],
  [/^timestamp with time zone/i, 'TIMESTAMPTZ'],
  [/^time without time zone/i, 'TIME'],
  [/^time with time zone/i, 'TIMETZ'],
  [/^double precision/i, 'DOUBLE PRECISION'],
];
function niceType(t: string): string {
  for (const [re, rep] of TYPE_ALIASES) if (re.test(t)) return t.replace(re, rep).toUpperCase();
  return t.toUpperCase();
}

const ACTIONS: Record<string, string | null> = { a: null, r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

export async function introspectPostgres(
  params: ConnectionParams, policy: HostPolicy, resolver?: Resolver,
): Promise<SchemaModel> {
  return withReadOnlyClient(params, policy, async (c) => {
    const schemas = await resolveSchemas(c, params.schemas);
    const warnings = await privilegeWarnings(c, schemas);

    // "public" tables get a plain id; others are "schema.table" so names never collide.
    const idOf = (schema: string, name: string) => (schema === 'public' ? name : `${schema}.${name}`);

    const cols = await c.query<{
      schema: string; table: string; column: string; data_type: string; nullable: boolean;
      default_expr: string | null; identity: string;
    }>(
      `SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
              format_type(a.atttypid, a.atttypmod) AS data_type, NOT a.attnotnull AS nullable,
              pg_get_expr(d.adbin, d.adrelid) AS default_expr, a.attidentity AS identity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        WHERE c.relkind IN ('r','p') AND NOT c.relispartition AND n.nspname = ANY($1)
        ORDER BY n.nspname, c.relname, a.attnum`,
      [schemas],
    );
    if (cols.rows.length > MAX_COLUMNS) throw new ValidationError('This database is too large to visualize in one go. Pick fewer schemas.');

    const tables = new Map<string, Table>();
    for (const r of cols.rows) {
      const id = idOf(r.schema, r.table);
      let t = tables.get(id);
      if (!t) {
        if (tables.size >= MAX_TABLES) throw new ValidationError(`More than ${MAX_TABLES} tables found. Pick fewer schemas.`);
        t = { id, schema: r.schema === 'public' ? null : r.schema, name: r.table, columns: [], primaryKey: [], indexes: [], isLikelyJunction: false };
        tables.set(id, t);
      }
      const def = r.identity ? 'identity' : /^nextval\(/i.test(r.default_expr ?? '') ? 'auto-increment' : (r.default_expr ?? null);
      const col: Column = {
        name: r.column, dataType: niceType(r.data_type), nullable: r.nullable,
        defaultValue: def && def.length > 80 ? `${def.slice(0, 77)}...` : def,
        isPrimaryKey: false, isUnique: false, isForeignKey: false,
      };
      t.columns.push(col);
    }

    const uniqueCols = new Map<string, Set<string>>([...tables.keys()].map((k) => [k, new Set<string>()]));

    const idx = await c.query<{
      schema: string; table: string; index_name: string; unique: boolean; primary: boolean; full: boolean; columns: string[];
    }>(
      `SELECT n.nspname AS schema, t.relname AS table, i.relname AS index_name,
              ix.indisunique AS unique, ix.indisprimary AS primary, (ix.indpred IS NULL) AS full,
              ARRAY(SELECT COALESCE(a.attname::text, '(expression)')
                      FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                      LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                     WHERE k.ord <= ix.indnkeyatts ORDER BY k.ord) AS columns
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE t.relkind IN ('r','p') AND NOT t.relispartition AND n.nspname = ANY($1)
        ORDER BY n.nspname, t.relname, i.relname`,
      [schemas],
    );
    for (const r of idx.rows) {
      const t = tables.get(idOf(r.schema, r.table));
      if (!t) continue;
      const info: IndexInfo = { name: r.index_name, columns: r.columns, unique: r.unique, primary: r.primary };
      t.indexes.push(info);
      if (r.primary) t.primaryKey = r.columns;
      if (r.unique && r.full && r.columns.length === 1 && r.columns[0] !== '(expression)') uniqueCols.get(t.id)!.add(r.columns[0]);
    }
    for (const t of tables.values()) {
      for (const col of t.columns) {
        col.isPrimaryKey = t.primaryKey.includes(col.name);
        col.isUnique = uniqueCols.get(t.id)!.has(col.name) && !col.isPrimaryKey;
      }
    }

    const fks = await c.query<{
      name: string; schema: string; table: string; fschema: string; ftable: string;
      columns: string[]; fcolumns: string[]; del: string; upd: string;
    }>(
      `SELECT con.conname AS name, n.nspname AS schema, c.relname AS table,
              fn.nspname AS fschema, fc.relname AS ftable,
              ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns,
              ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS fcolumns,
              con.confdeltype AS del, con.confupdtype AS upd
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class fc ON fc.oid = con.confrelid
         JOIN pg_namespace fn ON fn.oid = fc.relnamespace
        WHERE con.contype = 'f' AND NOT c.relispartition AND n.nspname = ANY($1)`,
      [schemas],
    );
    const relationships: Relationship[] = fks.rows.map((r) => {
      const from = idOf(r.schema, r.table);
      const to = idOf(r.fschema, r.ftable);
      return {
        id: `${from}.${r.columns.join('+')}->${to}.${r.fcolumns.join('+')}`,
        name: r.name, source: 'explicit', fromTable: from, fromColumns: r.columns,
        toTable: to, toColumns: r.fcolumns, cardinality: 'one-to-many',
        onDelete: ACTIONS[r.del] ?? null, onUpdate: ACTIONS[r.upd] ?? null,
      };
    });

    if (tables.size === 0) warnings.push('No tables were found in the selected schemas.');
    return finalizeModel({ dialect: 'postgresql', tables: [...tables.values()], relationships, uniqueCols, warnings });
  }, resolver);
}