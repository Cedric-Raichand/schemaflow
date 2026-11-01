import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { MAX_SQL_BYTES, router } from './routes/index.js';
import { createConnectionRouter } from './routes/connections.js';
import { policyFromEnv, type HostPolicy, type Resolver } from './services/introspection/hostGuard.js';

export interface AppOptions {
  policy?: HostPolicy;
  resolver?: Resolver;
  /** Public demo: live database connections are switched off. Defaults to SCHEMAFLOW_DEMO_MODE=true. */
  demoMode?: boolean;
  /** Folder containing the built frontend (index.html). When set, the backend also serves the website. */
  staticDir?: string;
}

/** SCHEMAFLOW_TRUST_PROXY: number of proxies in front of the app (1 on Render/Railway/Fly). Needed for correct client IPs. */
function trustProxySetting(v = process.env.SCHEMAFLOW_TRUST_PROXY): number | false {
  if (!v || v === 'false') return false;
  if (v === 'true') return 1;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : false;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting());
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json({ limit: '5mb' }));

  const demoMode = opts.demoMode ?? process.env.SCHEMAFLOW_DEMO_MODE === 'true';

  // Everything under /api is rate limited, so a public deployment cannot be hammered.
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.SCHEMAFLOW_API_RATE_LIMIT ?? 300),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down and try again shortly.' },
  }));

  // Lets the frontend know what this server allows, so it can hide what is switched off.
  app.get('/api/config', (_req, res) => res.json({ demoMode, liveConnections: !demoMode }));

  app.use('/api', router);
  if (demoMode) {
    // The route is never mounted, so no code path can reach a database from the demo.
    app.use('/api/connections', (_req, res) => {
      res.status(403).json({ error: 'Live connections are turned off on this demo. Run SchemaFlow locally to connect to your own database.' });
    });
  } else {
    app.use('/api/connections', createConnectionRouter(opts.policy ?? policyFromEnv(), opts.resolver));
  }

  if (opts.staticDir) {
    const indexFile = path.join(opts.staticDir, 'index.html');
    app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      next();
    });
    app.use(express.static(opts.staticDir, { index: false, maxAge: '1h' }));
    // Single-page app: any other page request gets index.html. Unknown /api paths stay real 404s.
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api')) return next();
      return res.sendFile(indexFile);
    });
  }

  // Never leak internals or request bodies (they may contain schema / credentials later).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `File is too large (${MAX_SQL_BYTES / 1024 / 1024} MB max).` : 'Upload failed.',
      });
    }
    const type = (err as { type?: string })?.type;
    if (type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    if (type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    console.error('Unhandled error:', err instanceof Error ? err.message : 'unknown');
    return res.status(500).json({ error: 'Something went wrong.' });
  });
  return app;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? 4000);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = process.env.SCHEMAFLOW_STATIC_DIR ?? (process.env.NODE_ENV === 'production' ? path.resolve(here, '../../frontend/dist') : undefined);
  const staticDir = candidate && existsSync(path.join(candidate, 'index.html')) ? candidate : undefined;
  if (process.env.NODE_ENV === 'production' && !staticDir) console.warn('No built frontend found; serving the API only.');
  createApp({ staticDir }).listen(port, () => console.log(`SchemaFlow listening on :${port}${staticDir ? ' (serving the website too)' : ''}`));
}