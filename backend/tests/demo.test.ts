import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const sample = readFileSync(new URL('../../samples/pharmacy.sql', import.meta.url), 'utf8');
const creds = { host: '127.0.0.1', port: 5432, database: 'd', user: 'u', password: 'secret-pw' };
const open = { allowPrivate: true, allowlist: null, allowedPorts: null };

describe('demo mode', () => {
  const demo = createApp({ demoMode: true, policy: open });

  it('reports itself through /api/config', async () => {
    const res = await request(demo).get('/api/config');
    expect(res.body).toEqual({ demoMode: true, liveConnections: false });
  });

  it('refuses every live-connection endpoint, whatever is sent', async () => {
    for (const path of ['/api/connections/test', '/api/connections/introspect']) {
      const res = await request(demo).post(path).send(creds);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/turned off/);
      expect(JSON.stringify(res.body)).not.toContain('secret-pw');
    }
  });

  it('still allows import, export and comparison', async () => {
    const imported = await request(demo).post('/api/import/sql').send({ sql: sample });
    expect(imported.status).toBe(200);
    expect((await request(demo).post('/api/compare').send({ base: imported.body, next: imported.body })).body.identical).toBe(true);
    expect((await request(demo).post('/api/export/markdown').send({ model: imported.body })).status).toBe(200);
  });
});

describe('normal mode', () => {
  it('reports live connections as available', async () => {
    const res = await request(createApp({ demoMode: false })).get('/api/config');
    expect(res.body).toEqual({ demoMode: false, liveConnections: true });
  });
});

describe('global API rate limit', () => {
  it('returns 429 once the limit is passed', async () => {
    const prev = process.env.SCHEMAFLOW_API_RATE_LIMIT;
    process.env.SCHEMAFLOW_API_RATE_LIMIT = '4';
    const app = createApp({ demoMode: true });
    process.env.SCHEMAFLOW_API_RATE_LIMIT = prev;
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await request(app).get('/api/health')).status);
    expect(codes).toEqual([200, 200, 200, 200, 429, 429]);
  });
});

describe('serving the built website', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sf-static-'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>SchemaFlow</title><div id="root"></div>');
  const app = createApp({ demoMode: true, staticDir: dir });

  it('serves the page for GET and HEAD, with security headers', async () => {
    for (const method of ['get', 'head'] as const) {
      const res = await request(app)[method]('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    }
  });
  it('falls back to the page for unknown routes, but never for /api', async () => {
    expect((await request(app).get('/some/page')).text).toContain('SchemaFlow');
    const api = await request(app).get('/api/does-not-exist');
    expect(api.status).toBe(404);
    expect(api.text).not.toContain('SchemaFlow');
  });
  it('does not serve a website unless asked to', async () => {
    expect((await request(createApp({ demoMode: true })).get('/')).status).toBe(404);
  });
});