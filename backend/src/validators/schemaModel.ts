import type { SchemaModel } from '../types/schema.js';

/** Minimal structural check for models sent back by the client (export endpoints). */
export function isSchemaModel(x: unknown): x is SchemaModel {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return (m.dialect === 'postgresql' || m.dialect === 'mysql')
    && Array.isArray(m.tables) && Array.isArray(m.relationships) && Array.isArray(m.warnings)
    && m.tables.length <= 2000 && m.relationships.length <= 10000;
}