import type { Dialect, Relationship, SchemaModel, Table } from '../types/schema.js';

export interface BuildInput {
  dialect: Dialect;
  tables: Table[];
  /** Explicit (foreign-key) relationships only. Inferred ones are added here. */
  relationships: Relationship[];
  /** tableId -> single columns known to be UNIQUE (used to detect one-to-one). */
  uniqueCols: Map<string, Set<string>>;
  warnings: string[];
}

/**
 * Shared by every importer/introspector so the diagram sees identical models
 * whatever the source: drops dangling FKs, flags FK columns, refines cardinality,
 * detects junction tables and adds clearly-labelled inferred relationships.
 */
export function finalizeModel(input: BuildInput): SchemaModel {
  const { dialect, tables, uniqueCols, warnings } = input;
  const byId = new Map(tables.map((t) => [t.id, t]));
  const rels: Relationship[] = [];

  for (const r of input.relationships) {
    if (!byId.has(r.fromTable)) continue;
    if (!byId.has(r.toTable)) {
      warnings.push(`Foreign key on "${r.fromTable}" references "${r.toTable}", which is not in the imported schema.`);
      continue;
    }
    rels.push(r);
  }

  for (const r of rels) {
    const t = byId.get(r.fromTable)!;
    for (const c of r.fromColumns) {
      const col = t.columns.find((x) => x.name === c);
      if (col) col.isForeignKey = true;
    }
    const oneToOne = r.fromColumns.length === 1
      && ((uniqueCols.get(r.fromTable)?.has(r.fromColumns[0]) ?? false)
        || (t.primaryKey.length === 1 && t.primaryKey[0] === r.fromColumns[0]));
    r.cardinality = oneToOne ? 'one-to-one' : 'one-to-many';
  }

  for (const t of tables) {
    const fks = rels.filter((r) => r.fromTable === t.id);
    const fkCols = new Set(fks.flatMap((r) => r.fromColumns));
    const pkAllFk = t.primaryKey.length >= 2 && t.primaryKey.every((c) => fkCols.has(c));
    const twoFkSlim = fks.length === 2 && t.columns.filter((c) => !fkCols.has(c.name) && !c.isPrimaryKey).length <= 1;
    t.isLikelyJunction = pkAllFk || twoFkSlim;
  }

  // Inferred (unconfirmed) relationships from naming: user_id / userId -> users/user
  const byName = new Map<string, Table>();
  for (const t of tables) byName.set(t.name.toLowerCase().replace(/_/g, ''), t);
  const explicitCols = new Set(rels.flatMap((r) => r.fromColumns.map((c) => `${r.fromTable}.${c}`)));
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.isPrimaryKey || explicitCols.has(`${t.id}.${c.name}`)) continue;
      const m = /^(.+?)(?:_id|Id)$/.exec(c.name);
      if (!m) continue;
      const stem = m[1].toLowerCase().replace(/_/g, '');
      const target = byName.get(stem) ?? byName.get(`${stem}s`) ?? byName.get(`${stem}es`);
      if (!target || target.id === t.id || !target.primaryKey.length) continue;
      rels.push({
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

  return { dialect, importedAt: new Date().toISOString(), tables, relationships: rels, warnings };
}