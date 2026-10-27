import type { SchemaModel } from '../types/schema.js';

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 300;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 200 && v.every(isStr);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Structural check for models sent back by the client (export and compare endpoints). */
export function isSchemaModel(x: unknown): x is SchemaModel {
  if (!isObj(x)) return false;
  if (x.dialect !== 'postgresql' && x.dialect !== 'mysql') return false;
  if (!Array.isArray(x.tables) || !Array.isArray(x.relationships) || !Array.isArray(x.warnings)) return false;
  if (x.tables.length > 2000 || x.relationships.length > 10000) return false;
  const tablesOk = x.tables.every((t) =>
    isObj(t) && isStr(t.id) && isStr(t.name) && isStrArr(t.primaryKey)
    && Array.isArray(t.columns) && t.columns.length <= 2000
    && t.columns.every((c) => isObj(c) && isStr(c.name) && isStr(c.dataType) && typeof c.nullable === 'boolean')
    && Array.isArray(t.indexes) && t.indexes.every((i) => isObj(i) && isStrArr(i.columns)));
  if (!tablesOk) return false;
  return x.relationships.every((r) =>
    isObj(r) && isStr(r.fromTable) && isStr(r.toTable) && isStrArr(r.fromColumns) && isStrArr(r.toColumns)
    && (r.source === 'explicit' || r.source === 'inferred'));
}