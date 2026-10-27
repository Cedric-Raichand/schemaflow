import { readFileSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { diffSchemas, normalizeDefault, normalizeType } from '../src/services/comparison/diff.js';
import { importSql } from '../src/services/importers/sqlImporter.js';
import { introspectPostgres } from '../src/services/introspection/postgres.js';
import { isSchemaModel } from '../src/validators/schemaModel.js';

const read = (n: string) => readFileSync(new URL(`../../samples/${n}`, import.meta.url), 'utf8');
const v1 = importSql(read('pharmacy.sql'));
const v2 = importSql(read('pharmacy.v2.sql'));
const diff = diffSchemas(v1, v2);
const find = (kind: string, table: string, column?: string) =>
  diff.changes.find((c) => c.kind === kind && c.table === table && (column === undefined || c.column === column));

describe('diffSchemas (pharmacy v1 -> v2)', () => {
  it('reports identical schemas as identical', () => {
    expect(diffSchemas(v1, v1)).toMatchObject({ identical: true, counts: { total: 0 } });
  });

  it('counts changes by risk', () => {
    expect(diff.counts).toEqual({ total: 13, breaking: 2, caution: 6, safe: 5 });
    expect(diff.identical).toBe(false);
  });

  it('flags removed tables and columns as breaking', () => {
    expect(find('table_removed', 'audit_log')?.risk).toBe('breaking');
    expect(find('column_removed', 'medicines', 'generic_name')?.risk).toBe('breaking');
  });

  it('treats added tables and optional columns as safe', () => {
    expect(find('table_added', 'prescriptions')?.risk).toBe('safe');
    expect(find('column_added', 'users', 'phone')?.risk).toBe('safe');
  });

  it('flags a required column with no default as caution', () => {
    const c = find('column_added', 'pharmacies', 'license_no')!;
    expect(c.risk).toBe('caution');
    expect(c.impact).toMatch(/NOT NULL/);
  });

  it('separates wider types (safe) from other type changes (caution)', () => {
    expect(find('column_type_changed', 'users', 'role')).toMatchObject({ risk: 'safe', before: 'VARCHAR(20)', after: 'VARCHAR(50)' });
    expect(find('column_type_changed', 'order_items', 'unit_price')?.risk).toBe('caution');
  });

  it('detects nullability and default changes', () => {
    expect(find('column_nullability_changed', 'pharmacies', 'city')).toMatchObject({ risk: 'caution', before: 'nullable', after: 'NOT NULL' });
    expect(find('column_default_changed', 'orders', 'status')).toMatchObject({ before: "'pending'", after: "'new'" });
  });

  it('detects removed foreign keys and changed delete rules', () => {
    expect(find('foreign_key_removed', 'orders')?.impact).toMatch(/referential integrity/);
    const ch = find('foreign_key_changed', 'order_items')!;
    expect(ch.before).toMatch(/CASCADE/);
    expect(ch.after).toMatch(/no action/);
  });

  it('detects index changes', () => {
    expect(find('index_added', 'orders')?.risk).toBe('safe');
    expect(find('index_removed', 'orders')?.risk).toBe('caution');
  });

  it('does not double-report foreign keys of added or removed tables, nor inferred relationships', () => {
    expect(diff.changes.some((c) => c.kind.startsWith('foreign_key') && (c.table === 'prescriptions' || c.table === 'audit_log'))).toBe(false);
  });

  it('is sorted most severe first', () => {
    const order = diff.changes.map((c) => c.risk);
    expect(order).toEqual([...order].sort((a, b) => ['breaking', 'caution', 'safe'].indexOf(a) - ['breaking', 'caution', 'safe'].indexOf(b)));
  });

  it('detects a primary key change as breaking', () => {
    const a = importSql('CREATE TABLE t (a INT, b INT, PRIMARY KEY (a));');
    const b = importSql('CREATE TABLE t (a INT, b INT, PRIMARY KEY (a, b));');
    expect(diffSchemas(a, b).changes[0]).toMatchObject({ kind: 'primary_key_changed', risk: 'breaking' });
  });

  it('notes dialect mismatches', () => {
    const my = importSql('CREATE TABLE t (a INT);', 'mysql');
    expect(diffSchemas(v1, my).notes.join(' ')).toMatch(/postgresql.*mysql/);
  });
});

describe('normalisation (so the same thing written two ways is not a change)', () => {
  it('equates type spellings', () => {
    expect(normalizeType('SERIAL')).toBe(normalizeType('INTEGER'));
    expect(normalizeType('INT')).toBe('integer');
    expect(normalizeType('character varying(255)')).toBe(normalizeType('VARCHAR(255)'));
    expect(normalizeType('TIMESTAMP WITHOUT TIME ZONE')).toBe('timestamp');
    expect(normalizeType('NUMERIC(10, 2)')).toBe('numeric(10,2)');
    expect(normalizeType('VARCHAR(10)')).not.toBe(normalizeType('VARCHAR(20)'));
  });
  it('strips casts and equates identity with auto-increment', () => {
    expect(normalizeDefault("'customer'::character varying")).toBe("'customer'");
    expect(normalizeDefault('identity')).toBe('auto-increment');
    expect(normalizeDefault(null)).toBeNull();
  });
});

describe('isSchemaModel', () => {
  it('accepts real models and rejects malformed ones', () => {
    expect(isSchemaModel(v1)).toBe(true);
    expect(isSchemaModel({ ...v1, tables: [1] })).toBe(false);
    expect(isSchemaModel({ ...v1, tables: [{ id: 'x', name: 'x', columns: 'nope', primaryKey: [], indexes: [] }] })).toBe(false);
    expect(isSchemaModel({ ...v1, relationships: [{ fromTable: 1 }] })).toBe(false);
    expect(isSchemaModel(null)).toBe(false);
  });
});

describe('POST /api/compare', () => {
  const app = createApp();
  it('returns the diff', async () => {
    const res = await request(app).post('/api/compare').send({ base: v1, next: v2 });
    expect(res.status).toBe(200);
    expect(res.body.counts.total).toBe(13);
  });
  it('rejects bad input', async () => {
    expect((await request(app).post('/api/compare').send({ base: v1 })).status).toBe(400);
    expect((await request(app).post('/api/compare').send({ base: v1, next: { tables: [1] } })).status).toBe(400);
  });
});

const pgEnv = process.env.SCHEMAFLOW_TEST_PG?.split(':');
describe.skipIf(!(pgEnv && pgEnv.length === 5))('SQL import vs live database', () => {
  it('shows no column, type or key differences for the same schema', async () => {
    const [host, port, database, user, password] = pgEnv as string[];
    const live = await introspectPostgres({ host, port: Number(port), database, user, password, sslMode: 'disable', schemas: ['public'] },
      { allowPrivate: true, allowlist: null, allowedPorts: null });
    const d = diffSchemas(v1, live);
    // Only tables that exist in the live database but not in the sample may differ.
    const noise = d.changes.filter((c) => c.kind !== 'table_added');
    expect(noise.map((c) => c.summary)).toEqual([]);
  });
});