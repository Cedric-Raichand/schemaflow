import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { MAX_SQL_BYTES, router } from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', router);

  // Never leak internals or request bodies (they may contain schema / credentials later).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? `File is too large (${MAX_SQL_BYTES / 1024 / 1024} MB max).` : 'Upload failed.',
      });
    }
    console.error('Unhandled error:', err instanceof Error ? err.message : 'unknown');
    return res.status(500).json({ error: 'Something went wrong.' });
  });
  return app;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? 4000);
  createApp().listen(port, () => console.log(`SchemaFlow API listening on :${port}`));
}