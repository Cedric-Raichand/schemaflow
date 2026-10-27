import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { introspectPostgres, withReadOnlyClient } from '../src/services/introspection/postgres.js';
import { parseConnection } from '../src/validators/connection.js';

// Real-database tests run only when you point them at a Postgres:
//   SCHEMAFLOW_TEST_PG="host:port:database:user:password"   (database must contain samples/pharmacy.sql)
const pgEnv = process.env.SCHEMAFLOW_TEST_PG?.split(':');
const live = pgEnv && pgEnv.length === 5 ? {
  host: pgEnv[0], port: Number(pgEnv[1]), database: pgEnv[2], user: pgEnv[3], password: pgEnv[4], sslMode: 'disable' as const,
} : null;
const policy = { allowPrivate: true, allowlist: null, allowedPorts: null };

describe('parseConnection', () => {
  const ok = { host: 'db.example.com', port: 5432, database: 'app', user: 'u', password: 'p' };
  it('accepts valid input and applies defaults', () => {
    const c = parseConnection(ok);
    expect(c.sslMode).toBe('require');
    expect(c.schemas).toEqual(['public']);
  });
  it('rejects bad input', () => {
    expect(() => parseConnection(null)).toThrow();
    expect(() => parseConnection({ ...ok, host: 'a b;rm -rf' })).toThrow(/Host/);
    expect(() => parseConnection({ ...ok, port: 70000 })).toThrow(/Port/);
    expect(() => parseConnection({ ...ok, database: '' })).toThrow(/required/);
    expect(() => parseConnection({ ...ok, sslMode: 'off' })).toThrow(/SSL/);
    expect(() => parseConnection({ ...ok, user: 'a\u0000b' })).toThrow(/User/);
    expect(() => parseConnection({ ...ok, schemas: [] })).toThrow(/schemas/);
  });
});

describe('connection API (no database needed)', () => {
  const strictApp = createApp({ policy: { allowPrivate: false, allowlist: null, allowedPorts: null } });
  const body = { host: '10.0.0.5', port: 5432, database: 'd', user: 'u', password: 'super-secret-pw' };

  it('refuses private hosts when the policy forbids them, without echoing the password', async () => {
    const res = await request(strictApp).post('/api/connections/test').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-pw');
  });
  it('always refuses the cloud metadata address', async () => {
    const res = await request(createApp({ policy })).post('/api/connections/introspect').send({ ...body, host: '169.254.169.254' });
    expect(res.status).toBe(400);
  });
  it('returns 400 for invalid input and for malformed JSON', async () => {
    const app = createApp({ policy });
    expect((await request(app).post('/api/connections/test').send({ host: '' })).status).toBe(400);
    const bad = await request(app).post('/api/connections/test').set('Content-Type', 'application/json').send('{oops');
    expect(bad.status).toBe(400);
  });
  it('sends no-store on connection responses', async () => {
    const res = await request(strictApp).post('/api/connections/test').send(body);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('rate limits repeated attempts', async () => {
    const prev = process.env.SCHEMAFLOW_CONN_RATE_LIMIT;
    process.env.SCHEMAFLOW_CONN_RATE_LIMIT = '3';
    const app = createApp({ policy });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await request(app).post('/api/connections/test').send({})).status);
    process.env.SCHEMAFLOW_CONN_RATE_LIMIT = prev;
    expect(codes).toEqual([400, 400, 400, 429, 429]);
  });
});

describe.skipIf(!live)('live PostgreSQL', () => {
  const params = { ...(live as NonNullable<typeof live>), schemas: ['*'] };
  const app = createApp({ policy });

  it('introspects tables, keys, relationships and indexes', async () => {
    const m = await introspectPostgres(params, policy);
    const names = m.tables.map((t) => t.id);
    expect(names).toEqual(expect.arrayContaining(['users', 'pharmacies', 'medicines', 'pharmacy_stock', 'orders', 'order_items', 'audit_log']));
    const rel = (f: string, t: string) => m.relationships.find((r) => r.fromTable === f && r.toTable === t);
    expect(rel('pharmacies', 'users')).toMatchObject({ source: 'explicit', onDelete: 'CASCADE' });
    expect(rel('order_items', 'orders')?.onDelete).toBe('CASCADE');
    expect(m.tables.find((t) => t.id === 'pharmacy_stock')).toMatchObject({ primaryKey: ['pharmacy_id', 'medicine_id'], isLikelyJunction: true });
    expect(m.relationships.filter((r) => r.source === 'inferred').map((r) => r.fromTable)).toContain('audit_log');
    const email = m.tables.find((t) => t.id === 'users')!.columns.find((c) => c.name === 'email')!;
    expect(email).toMatchObject({ dataType: 'VARCHAR(255)', nullable: false, isUnique: true });
    expect(m.tables.find((t) => t.id === 'orders')!.indexes.some((i) => i.name === 'idx_orders_user')).toBe(true);
  });

  it('reads other schemas with schema-qualified ids', async () => {
    const m = await introspectPostgres(params, policy);
    const inv = m.tables.find((t) => t.id === 'billing.invoices');
    if (inv) {
      expect(inv.schema).toBe('billing');
      expect(m.relationships.some((r) => r.fromTable === 'billing.invoices' && r.toTable === 'orders')).toBe(true);
    }
  });

  it('cannot write: the session is read-only', async () => {
    await expect(withReadOnlyClient(params, policy, async (c) => { await c.query('CREATE TABLE sf_should_not_exist (x int)'); }))
      .rejects.toThrow();
    const m = await introspectPostgres(params, policy);
    expect(m.tables.some((t) => t.name === 'sf_should_not_exist')).toBe(false);
  });

  it('gives friendly errors that never contain the password', async () => {
    const wrongPw = await request(app).post('/api/connections/test').send({ ...params, password: 'definitely-wrong-pw' });
    expect(wrongPw.status).toBe(400);
    expect(wrongPw.body.error).toMatch(/Authentication failed/);
    expect(JSON.stringify(wrongPw.body)).not.toContain('definitely-wrong-pw');
    const noDb = await request(app).post('/api/connections/test').send({ ...params, database: 'nope_nope' });
    expect(noDb.body.error).toMatch(/does not exist/);
    const refused = await request(app).post('/api/connections/test').send({ ...params, port: 1 });
    expect(refused.body.error).toMatch(/refused/);
  });

  it('HTTP: test and introspect endpoints work end to end', async () => {
    const t = await request(app).post('/api/connections/test').send(params);
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ ok: true, database: params.database });
    const i = await request(app).post('/api/connections/introspect').send(params);
    expect(i.status).toBe(200);
    expect(i.body.dialect).toBe('postgresql');
    expect(JSON.stringify(i.body)).not.toContain(params.password);
  });

  it('rejects unknown schemas clearly', async () => {
    const res = await request(app).post('/api/connections/introspect').send({ ...params, schemas: ['nope'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Schema not found/);
  });
});