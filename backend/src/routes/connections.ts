import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { introspectPostgres, testPostgresConnection } from '../services/introspection/postgres.js';
import type { HostPolicy, Resolver } from '../services/introspection/hostGuard.js';
import { parseConnection, ValidationError } from '../validators/connection.js';

export function createConnectionRouter(policy: HostPolicy, resolver?: Resolver) {
  const router = Router();

  // Connection attempts are expensive and can be abused to probe networks: keep them slow.
  router.use(rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: Number(process.env.SCHEMAFLOW_CONN_RATE_LIMIT ?? 20),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many connection attempts. Please wait a few minutes.' },
  }));

  // Responses can describe a private database: never cache them.
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ error: e.message });
      return next(e);
    }
  };

  router.post('/test', handle(async (req) => {
    const info = await testPostgresConnection(parseConnection(req.body), policy, resolver);
    return { ok: true, ...info };
  }));

  router.post('/introspect', handle((req) => introspectPostgres(parseConnection(req.body), policy, resolver)));

  return router;
}