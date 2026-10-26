import { readFileSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp();
const samplePath = new URL('../../samples/pharmacy.sql', import.meta.url);

describe('API', () => {
  it('imports an uploaded sql file', async () => {
    const res = await request(app).post('/api/import/sql').attach('file', readFileSync(samplePath), 'pharmacy.sql');
    expect(res.status).toBe(200);
    expect(res.body.tables).toHaveLength(7);
  });

  it('imports pasted sql text', async () => {
    const res = await request(app).post('/api/import/sql').send({ sql: 'CREATE TABLE a (id INT PRIMARY KEY);' });
    expect(res.status).toBe(200);
    expect(res.body.tables[0].name).toBe('a');
  });

  it('returns 422 for unparseable sql', async () => {
    const res = await request(app).post('/api/import/sql').send({ sql: 'CREATE TABEL (' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Could not parse/);
  });

  it('returns 400 when nothing is sent', async () => {
    expect((await request(app).post('/api/import/sql').send({})).status).toBe(400);
  });

  it('rejects oversized uploads with 413', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 10, 'a');
    const res = await request(app).post('/api/import/sql').attach('file', big, 'big.sql');
    expect(res.status).toBe(413);
  });

  it('exports markdown', async () => {
    const model = (await request(app).post('/api/import/sql').attach('file', readFileSync(samplePath), 'p.sql')).body;
    const res = await request(app).post('/api/export/markdown').send({ model, projectName: 'Pharmacy' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('# Pharmacy — Database Schema Report');
    expect(res.text).toContain('pharmacy_stock');
  });

  it('rejects an invalid model on export', async () => {
    expect((await request(app).post('/api/export/markdown').send({ model: {} })).status).toBe(400);
  });
});