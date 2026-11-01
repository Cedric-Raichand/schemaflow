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
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
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
  createApp().listen(port, () => console.log(`SchemaFlow API listening on :${port}`));
}