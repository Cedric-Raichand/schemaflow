import type { SchemaModel, Table } from '../../types/schema'

export interface TableMatch {
  table: Table
  columns: string[] // matching column names (empty if only the table name matched)
}

/** Matches table names, column names and data types (case-insensitive substring). */
export function searchSchema(model: SchemaModel, query: string): TableMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return model.tables.map((table) => ({ table, columns: [] }))
  const out: TableMatch[] = []
  for (const table of model.tables) {
    const nameHit = table.name.toLowerCase().includes(q) || table.id.toLowerCase().includes(q)
    const columns = table.columns
      .filter((c) => c.name.toLowerCase().includes(q) || c.dataType.toLowerCase().includes(q))
      .map((c) => c.name)
    if (nameHit || columns.length) out.push({ table, columns })
  }
  return out
}

export function referencedBy(model: SchemaModel, tableId: string) {
  return model.relationships.filter((r) => r.toTable === tableId)
}
export function references(model: SchemaModel, tableId: string) {
  return model.relationships.filter((r) => r.fromTable === tableId)
}
export function orphanTables(model: SchemaModel): Table[] {
  return model.tables.filter(
    (t) => !model.relationships.some((r) => r.fromTable === t.id || r.toTable === t.id),
  )
}