import type { IndexInfo, Relationship, SchemaModel, Table } from '../../types/schema.js';
import type { Change, Risk, SchemaDiff } from '../../types/diff.js';

/**
 * Makes "the same thing written two ways" compare equal, so importing a .sql file and later
 * reading the live database does not report fake differences (SERIAL vs INTEGER, ::casts, etc).
 */
export function normalizeType(t: string): string {
  let s = t.toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();
  s = s.replace(/^character varying/, 'varchar').replace(/^character\b/, 'char');
  const alias: Record<string, string> = {
    serial: 'integer', serial4: 'integer', int: 'integer', int4: 'integer',
    bigserial: 'bigint', serial8: 'bigint', int8: 'bigint',
    smallserial: 'smallint', serial2: 'smallint', int2: 'smallint',
    bool: 'boolean',
    'timestamp without time zone': 'timestamp', 'timestamp with time zone': 'timestamptz',
  };
  const base = s.replace(/\(.*$/, '');
  const rest = s.slice(base.length);
  return (alias[base] ?? base) + rest;
}

export function normalizeDefault(d: string | null): string | null {
  if (d === null || d === undefined) return null;
  const s = d.replace(/::[a-z_ ]+(\(\d+(,\d+)?\))?(\[\])?/gi, '').trim().toLowerCase();
  return s === 'identity' ? 'auto-increment' : s;
}

const lengthOf = (t: string): number | null => {
  const m = /\((\d+)\)/.exec(t);
  return m ? Number(m[1]) : null;
};

function typeChangeRisk(before: string, after: string): { risk: Risk; impact: string } {
  const b = normalizeType(before);
  const a = normalizeType(after);
  const bBase = b.replace(/\(.*$/, '');
  const aBase = a.replace(/\(.*$/, '');
  const bl = lengthOf(b);
  const al = lengthOf(a);
  if (bBase === aBase && bl !== null && al !== null && al > bl) {
    return { risk: 'safe', impact: 'The type got wider, so existing data still fits.' };
  }
  return { risk: 'caution', impact: 'May affect compatibility with existing data and with code that reads or writes this column.' };
}

const fkSig = (r: Relationship) => `${r.fromTable}(${r.fromColumns.join(',')})->${r.toTable}(${r.toColumns.join(',')})`;
const idxSig = (i: IndexInfo) => `${i.unique ? 'U' : 'I'}:${i.columns.join(',')}`;
const list = (xs: string[]) => xs.join(', ');

const RANK: Record<Risk, number> = { breaking: 0, caution: 1, safe: 2 };

export function diffSchemas(base: SchemaModel, next: SchemaModel): SchemaDiff {
  const changes: Change[] = [];
  const add = (c: Change) => changes.push(c);
  const baseT = new Map(base.tables.map((t) => [t.id, t]));
  const nextT = new Map(next.tables.map((t) => [t.id, t]));

  for (const t of next.tables) {
    if (!baseT.has(t.id)) {
      add({ kind: 'table_added', risk: 'safe', table: t.id, summary: `Table "${t.id}" added (${t.columns.length} columns)`, impact: 'New table. Existing code is not affected.' });
    }
  }
  for (const t of base.tables) {
    if (!nextT.has(t.id)) {
      add({ kind: 'table_removed', risk: 'breaking', table: t.id, summary: `Table "${t.id}" removed (had ${t.columns.length} columns)`, impact: 'Anything that reads or writes this table could break.' });
    }
  }

  for (const [id, a] of baseT) {
    const b = nextT.get(id);
    if (b) diffTable(id, a, b, add);
  }

  // Relationships: only explicit foreign keys count. Guessed ("inferred") ones are ignored.
  const fks = (m: SchemaModel) => new Map(m.relationships.filter((r) => r.source === 'explicit').map((r) => [fkSig(r), r]));
  const bf = fks(base);
  const nf = fks(next);
  for (const [sig, r] of nf) {
    if (!baseT.has(r.fromTable)) continue; // brand-new table: already reported as added
    const old = bf.get(sig);
    if (!old) {
      add({ kind: 'foreign_key_added', risk: 'caution', table: r.fromTable, column: list(r.fromColumns), summary: `Foreign key added: ${r.fromTable}(${list(r.fromColumns)}) → ${r.toTable}(${list(r.toColumns)})`, impact: 'Existing rows may violate it, and inserts or updates that break it will be rejected.' });
    } else if (old.onDelete !== r.onDelete || old.onUpdate !== r.onUpdate) {
      add({
        kind: 'foreign_key_changed', risk: 'caution', table: r.fromTable, column: list(r.fromColumns),
        summary: `Foreign key rules changed: ${r.fromTable}(${list(r.fromColumns)}) → ${r.toTable}`,
        before: `on delete ${old.onDelete ?? 'no action'}, on update ${old.onUpdate ?? 'no action'}`,
        after: `on delete ${r.onDelete ?? 'no action'}, on update ${r.onUpdate ?? 'no action'}`,
        impact: 'Deleting or updating a parent row now behaves differently.',
      });
    }
  }
  for (const [sig, r] of bf) {
    if (!nextT.has(r.fromTable)) continue; // table removed: already reported
    if (!nf.has(sig)) {
      add({ kind: 'foreign_key_removed', risk: 'caution', table: r.fromTable, column: list(r.fromColumns), summary: `Foreign key removed: ${r.fromTable}(${list(r.fromColumns)}) → ${r.toTable}(${list(r.toColumns)})`, impact: 'Weakens referential integrity: orphaned rows are no longer prevented by the database.' });
    }
  }

  changes.sort((x, y) => RANK[x.risk] - RANK[y.risk] || x.table.localeCompare(y.table) || x.kind.localeCompare(y.kind));

  const counts = {
    total: changes.length,
    breaking: changes.filter((c) => c.risk === 'breaking').length,
    caution: changes.filter((c) => c.risk === 'caution').length,
    safe: changes.filter((c) => c.risk === 'safe').length,
  };
  const notes = [
    'Risk labels describe potential impact only. SchemaFlow reads the database structure, not your application code, so it cannot know what will actually break.',
    'A renamed table or column appears as one removal plus one addition.',
  ];
  if (base.dialect !== next.dialect) notes.push(`You are comparing a ${base.dialect} schema with a ${next.dialect} schema, so type names may differ for reasons that are not real changes.`);

  return { identical: changes.length === 0, counts, baseTables: base.tables.length, nextTables: next.tables.length, changes, notes };
}

function diffTable(id: string, a: Table, b: Table, add: (c: Change) => void) {
  const ac = new Map(a.columns.map((c) => [c.name, c]));
  const bc = new Map(b.columns.map((c) => [c.name, c]));

  for (const c of b.columns) {
    if (ac.has(c.name)) continue;
    const required = !c.nullable && c.defaultValue === null && !c.isPrimaryKey;
    add({
      kind: 'column_added', risk: required ? 'caution' : 'safe', table: id, column: c.name,
      summary: `Column "${c.name}" added to ${id} (${c.dataType}${c.nullable ? '' : ', NOT NULL'})`,
      after: c.dataType,
      impact: required
        ? 'NOT NULL with no default: code that inserts into this table without setting it will fail.'
        : 'May require application updates to make use of the new column.',
    });
  }
  for (const c of a.columns) {
    if (!bc.has(c.name)) {
      add({ kind: 'column_removed', risk: 'breaking', table: id, column: c.name, summary: `Column "${c.name}" removed from ${id}`, before: c.dataType, impact: 'Could break any code that references this column.' });
    }
  }

  for (const o of a.columns) {
    const n = bc.get(o.name);
    if (!n) continue;
    if (normalizeType(o.dataType) !== normalizeType(n.dataType)) {
      const { risk, impact } = typeChangeRisk(o.dataType, n.dataType);
      add({ kind: 'column_type_changed', risk, table: id, column: o.name, summary: `Type of ${id}.${o.name} changed`, before: o.dataType, after: n.dataType, impact });
    }
    if (o.nullable !== n.nullable) {
      add({
        kind: 'column_nullability_changed', risk: n.nullable ? 'safe' : 'caution', table: id, column: o.name,
        summary: `${id}.${o.name} is now ${n.nullable ? 'nullable' : 'NOT NULL'}`,
        before: o.nullable ? 'nullable' : 'NOT NULL', after: n.nullable ? 'nullable' : 'NOT NULL',
        impact: n.nullable
          ? 'Code that reads this column may now receive NULL where it never did before.'
          : 'Existing NULLs may block the change, and inserts without a value will fail.',
      });
    }
    if (normalizeDefault(o.defaultValue) !== normalizeDefault(n.defaultValue)) {
      add({ kind: 'column_default_changed', risk: 'safe', table: id, column: o.name, summary: `Default of ${id}.${o.name} changed`, before: o.defaultValue ?? 'none', after: n.defaultValue ?? 'none', impact: 'New rows that do not set this column will get a different value.' });
    }
  }

  if (a.primaryKey.join(',') !== b.primaryKey.join(',')) {
    add({ kind: 'primary_key_changed', risk: 'breaking', table: id, summary: `Primary key of ${id} changed`, before: list(a.primaryKey) || 'none', after: list(b.primaryKey) || 'none', impact: 'Code and foreign keys that identify rows by the old key could break.' });
  }

  const ai = new Map(a.indexes.filter((i) => !i.primary).map((i) => [idxSig(i), i]));
  const bi = new Map(b.indexes.filter((i) => !i.primary).map((i) => [idxSig(i), i]));
  for (const [sig, i] of bi) {
    if (ai.has(sig)) continue;
    add({
      kind: 'index_added', risk: i.unique ? 'caution' : 'safe', table: id,
      summary: `${i.unique ? 'Unique index' : 'Index'} added on ${id}(${list(i.columns)})`,
      impact: i.unique
        ? 'Existing duplicate data may block it, and inserts that duplicate a value will be rejected.'
        : 'May speed up some queries, but adds a little overhead to every write.',
    });
  }
  for (const [sig, i] of ai) {
    if (bi.has(sig)) continue;
    add({
      kind: 'index_removed', risk: 'caution', table: id,
      summary: `${i.unique ? 'Unique index' : 'Index'} removed from ${id}(${list(i.columns)})`,
      impact: i.unique
        ? 'Duplicate values are no longer prevented by the database.'
        : 'Queries that relied on this index may get slower.',
    });
  }
}