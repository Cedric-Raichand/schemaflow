import { Router } from 'express';
import multer from 'multer';
import { importSql, SqlImportError } from '../services/importers/sqlImporter.js';
import { toMarkdown } from '../services/exporters/markdownExporter.js';
import { isSchemaModel } from '../validators/schemaModel.js';
import type { Dialect } from '../types/schema.js';

export const MAX_SQL_BYTES = 2 * 1024 * 1024; // 2 MB cap on uploaded schema files

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SQL_BYTES, files: 1 } });
export const router = Router();

const parseDialect = (v: unknown): Dialect => (v === 'mysql' ? 'mysql' : 'postgresql');

router.get('/health', (_req, res) => res.json({ ok: true }));

// Import from an uploaded .sql file (multipart field "file") or pasted text (JSON { sql }).
router.post('/import/sql', upload.single('file'), (req, res) => {
  const sql: string | undefined = req.file ? req.file.buffer.toString('utf8') : req.body?.sql;
  if (typeof sql !== 'string' || !sql.trim()) {
    return res.status(400).json({ error: 'Provide a .sql file or SQL text.' });
  }
  if (Buffer.byteLength(sql) > MAX_SQL_BYTES) {
    return res.status(413).json({ error: 'Schema is too large (2 MB max).' });
  }
  try {
    return res.json(importSql(sql, parseDialect(req.body?.dialect)));
  } catch (e) {
    if (e instanceof SqlImportError) return res.status(422).json({ error: e.message });
    throw e;
  }
});

router.post('/export/markdown', (req, res) => {
  const { model, projectName } = req.body ?? {};
  if (!isSchemaModel(model)) return res.status(400).json({ error: 'Invalid schema model.' });
  const name = typeof projectName === 'string' ? projectName.slice(0, 80) : 'Schema';
  res.type('text/markdown').send(toMarkdown(model, name));
});