import pkg from 'node-sql-parser';
import type {
  Column, Dialect, IndexInfo, Relationship, SchemaModel, Table,
} from '../../types/schema.js';

const { Parser } = pkg;
const parser = new Parser();

export class SqlImportError extends Error {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;

const colName = (ref: Node): string => {
  const v = ref?.column;
  if (typeof v === 'string') return v;
  return String(v?.expr?.value ?? v?.value ?? '');
};

const tableId = (t: Node): { id: string; schema: string | null; name: string } => {
  const schema: string | null = t?.db ?? null;
  const name: string = t?.table;
  return { id: schema ? `${schema}.${name}` : name, schema, name };
};

function formatType(def: Node): string {
  if (!def) return 'UNKNOWN';
  let out = String(def.dataType ?? 'UNKNOWN').toUpperCase();
  if (def.length !== undefined && def.length !== null) {
    out += def.scale !== undefined && def.scale !== null
      ? `(${def.length},${def.scale})`
      : `(${def.length})`;
  }
  return out;
}

function formatDefault(v: Node): string | null {
  if (!v) return null;
  const d = v.value ?? v;
  if (d === null || d === undefined) return null;
  if (typeof d !== 'object') return String(d);
  if (d.type === 'function') {
    const name = d.name?.name?.[0]?.value ?? d.name;
    return `${typeof name === 'string' ? name : 'fn'}()`;
  }
  if (d.type === 'single_quote_string' || d.type === 'string') return `'${d.value}'`;
  if (d.value !== undefined) return String(d.value);
  return null;
}

const SERIAL = /^(BIG|SMALL)?SERIAL$/;

export function importSql(sql: string, dialect: Dialect = 'postgresql'): SchemaModel {
  let ast: Node;
  try {
    ast = parser.astify(sql, { database: dialect === 'postgresql' ? 'postgresql' : 'mysql' });
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : 'Unknown parse error';
    throw new SqlImportError(`Could not parse SQL: ${msg}`);
  }
  const statements: Node[] = Array.isArray(ast) ? ast : [ast];

  const tables = new Map<string, Table>();
  const relationships: Relationship[] = [];
  const warnings: string[] = [];
  const uniqueCols = new Map<string, Set<string>>();

  const addFk = (
    from: string, fromCols: string[], ref: Node, name: string | null,
  ) => {
    const to = tableId(ref.table?.[0]);
    const toCols: string[] = (ref.definition ?? []).map(colName);
    const action = (kind: string): string | null => {
      const a = (ref.on_action ?? []).find((x: Node) => x.type === kind);
      return a ? String(a.value?.value ?? a.value).toUpperCase() : null;
    };
    relationships.push({
      id: `${from}.${fromCols.join('+')}->${to.id}.${toCols.join('+')}`,
      name,
      source: 'explicit',
      fromTable: from,
      fromColumns: fromCols,
      toTable: to.id,
      toColumns: toCols,
      cardinality: 'one-to-many', // refined below
      onDelete: action('on delete'),
      onUpdate: action('on update'),
    });
  };

  const handleConstraint = (tid: string, def: Node) => {
    const t = tables.get(tid);
    if (!t) { warnings.push(`Constraint on unknown table "${tid}" was skipped.`); return; }
    const cols: string[] = (def.definition ?? []).map(colName);
    const type = String(def.constraint_type ?? '').toLowerCase();
    if (type === 'primary key') {
      t.primaryKey = cols;
      t.indexes.push({ name: def.constraint ?? `${t.name}_pkey`, columns: cols, unique: true, primary: true });
    } else if (type === 'unique' || type === 'unique key') {
      t.indexes.push({ name: def.constraint ?? def.index ?? `${t.name}_${cols.join('_')}_key`, columns: cols, unique: true, primary: false });
      if (cols.length === 1) uniqueCols.get(tid)!.add(cols[0]);
    } else if (type === 'foreign key') {
      if (def.reference_definition) addFk(tid, cols, def.reference_definition, def.constraint ?? null);
    }
  };

  // Pass 1: CREATE TABLE
  for (const s of statements) {
    if (s?.type !== 'create' || s.keyword !== 'table') continue;
    const { id, schema, name } = tableId(s.table?.[0]);
    const table: Table = { id, schema, name, columns: [], primaryKey: [], indexes: [], isLikelyJunction: false };
    tables.set(id, table);
    uniqueCols.set(id, new Set());

    for (const d of s.create_definitions ?? []) {
      if (d.resource !== 'column') continue;
      const name = colName(d.column);
      const type = formatType(d.definition);
      const isPk = Boolean(d.primary_key);
      const col: Column = {
        name,
        dataType: type,
        nullable: !(d.nullable?.type === 'not null') && !isPk,
        defaultValue: formatDefault(d.default_val) ?? (SERIAL.test(type) ? 'auto-increment' : null),
        isPrimaryKey: isPk,
        isUnique: Boolean(d.unique || d.unique_or_primary === 'unique' || d.unique === 'unique'),
        isForeignKey: false,
      };
      if (isPk) {
        table.primaryKey.push(name);
        table.indexes.push({ name: `${table.name}_pkey`, columns: [name], unique: true, primary: true });
      }
      if (col.isUnique) {
        uniqueCols.get(id)!.add(name);
        table.indexes.push({ name: `${table.name}_${name}_key`, columns: [name], unique: true, primary: false });
      }
      table.columns.push(col);
      if (d.reference_definition) addFk(id, [name], d.reference_definition, null);
    }
  }

  // Pass 2: constraints inside CREATE TABLE, ALTER TABLE, CREATE INDEX
  for (const s of statements) {
    if (s?.type === 'create' && s.keyword === 'table') {
      const { id } = tableId(s.table?.[0]);
      for (const d of s.create_definitions ?? []) {
        if (d.resource === 'constraint') handleConstraint(id, d);
        else if (d.resource === 'index') {
          const t = tables.get(id)!;
          const cols = (d.definition ?? []).map(colName);
          t.indexes.push({ name: d.index ?? `${t.name}_${cols.join('_')}_idx`, columns: cols, unique: false, primary: false });
        }
      }
    } else if (s?.type === 'alter') {
      const { id } = tableId(s.table?.[0]);
      for (const e of s.expr ?? []) {
        if (e.action === 'add' && e.resource === 'constraint') handleConstraint(id, e.create_definitions);
      }
    } else if (s?.type === 'create' && s.keyword === 'index') {
      const { id } = tableId(s.table);
      const t = tables.get(id);
      if (!t) { warnings.push(`Index "${s.index}" references unknown table "${id}".`); continue; }
      const cols = (s.index_columns ?? []).map(colName);
      const idx: IndexInfo = { name: s.index ?? `${t.name}_${cols.join('_')}_idx`, columns: cols, unique: s.index_type === 'unique', primary: false };
      t.indexes.push(idx);
      if (idx.unique && cols.length === 1) uniqueCols.get(id)!.add(cols[0]);
    }
  }

  // Drop FKs pointing at tables that don't exist in the import (keep the table list honest)
  const valid: Relationship[] = [];
  for (const r of relationships) {
    if (!tables.has(r.fromTable)) continue;
    if (!tables.has(r.toTable)) {
      warnings.push(`Foreign key on "${r.fromTable}" references "${r.toTable}", which is not in the imported schema.`);
      continue;
    }
    valid.push(r);
  }

  // Mark FK columns, refine cardinality
  for (const r of valid) {
    const t = tables.get(r.fromTable)!;
    for (const c of r.fromColumns) {
      const col = t.columns.find((x) => x.name === c);
      if (col) col.isForeignKey = true;
    }
    const oneToOne = r.fromColumns.length === 1
      && (uniqueCols.get(r.fromTable)!.has(r.fromColumns[0])
        || (t.primaryKey.length === 1 && t.primaryKey[0] === r.fromColumns[0]));
    r.cardinality = oneToOne ? 'one-to-one' : 'one-to-many';
  }

  // Junction detection: composite PK made entirely of FK columns, or exactly 2 FKs and little else
  for (const t of tables.values()) {
    const fks = valid.filter((r) => r.fromTable === t.id);
    const fkCols = new Set(fks.flatMap((r) => r.fromColumns));
    const pkAllFk = t.primaryKey.length >= 2 && t.primaryKey.every((c) => fkCols.has(c));
    const twoFkSlim = fks.length === 2 && t.columns.filter((c) => !fkCols.has(c.name) && !c.isPrimaryKey).length <= 1;
    t.isLikelyJunction = pkAllFk || twoFkSlim;
  }

  // Inferred (unconfirmed) relationships from naming: user_id / userId -> users/user table
  const byName = new Map<string, Table>();
  for (const t of tables.values()) byName.set(t.name.toLowerCase().replace(/_/g, ''), t);
  const explicitCols = new Set(valid.flatMap((r) => r.fromColumns.map((c) => `${r.fromTable}.${c}`)));
  for (const t of tables.values()) {
    for (const c of t.columns) {
      if (c.isPrimaryKey || explicitCols.has(`${t.id}.${c.name}`)) continue;
      const m = /^(.+?)(?:_id|Id)$/.exec(c.name);
      if (!m) continue;
      const stem = m[1].toLowerCase().replace(/_/g, '');
      const target = byName.get(stem) ?? byName.get(`${stem}s`) ?? byName.get(`${stem}es`);
      if (!target || target.id === t.id || !target.primaryKey.length) continue;
      valid.push({
        id: `inferred:${t.id}.${c.name}->${target.id}.${target.primaryKey[0]}`,
        name: null,
        source: 'inferred',
        fromTable: t.id,
        fromColumns: [c.name],
        toTable: target.id,
        toColumns: [target.primaryKey[0]],
        cardinality: 'one-to-many',
        onDelete: null,
        onUpdate: null,
      });
    }
  }

  if (tables.size === 0) {
    throw new SqlImportError('No CREATE TABLE statements were found in the file.');
  }

  return {
    dialect,
    importedAt: new Date().toISOString(),
    tables: [...tables.values()],
    relationships: valid,
    warnings,
  };
}