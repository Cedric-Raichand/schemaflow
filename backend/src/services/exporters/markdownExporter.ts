import type { SchemaModel } from '../../types/schema.js';

const esc = (s: string) => s.replace(/\|/g, '\\|');

export function toMarkdown(m: SchemaModel, projectName = 'Schema'): string {
  const out: string[] = [];
  out.push(`# ${projectName} — Database Schema Report`, '');
  out.push(`- Database type: ${m.dialect}`);
  out.push(`- Generated: ${new Date().toISOString().slice(0, 10)}`);
  out.push(`- Tables: ${m.tables.length}`);
  out.push(`- Relationships: ${m.relationships.filter((r) => r.source === 'explicit').length} explicit, ${m.relationships.filter((r) => r.source === 'inferred').length} inferred (unconfirmed)`, '');

  out.push('## Tables', '');
  for (const t of m.tables) {
    out.push(`### ${t.id}${t.isLikelyJunction ? ' _(likely junction table)_' : ''}`, '');
    out.push('| Column | Type | Null | Default | Keys |', '|---|---|---|---|---|');
    for (const c of t.columns) {
      const keys = [c.isPrimaryKey && 'PK', c.isForeignKey && 'FK', c.isUnique && 'UNIQUE'].filter(Boolean).join(', ');
      out.push(`| ${esc(c.name)} | ${esc(c.dataType)} | ${c.nullable ? 'yes' : 'no'} | ${c.defaultValue ? esc(c.defaultValue) : ''} | ${keys} |`);
    }
    if (t.primaryKey.length > 1) out.push('', `Composite primary key: (${t.primaryKey.join(', ')})`);
    const idx = t.indexes.filter((i) => !i.primary);
    if (idx.length) {
      out.push('', 'Indexes:');
      for (const i of idx) out.push(`- \`${i.name}\` (${i.columns.join(', ')})${i.unique ? ' — unique' : ''}`);
    }
    out.push('');
  }

  out.push('## Relationships', '');
  out.push('| From | To | Cardinality | Source | On delete |', '|---|---|---|---|---|');
  for (const r of m.relationships) {
    out.push(`| ${r.fromTable}.${r.fromColumns.join('+')} | ${r.toTable}.${r.toColumns.join('+')} | ${r.cardinality} | ${r.source === 'explicit' ? 'foreign key' : 'inferred from name — confirm'} | ${r.onDelete ?? ''} |`);
  }
  const isolated = m.tables.filter((t) => !m.relationships.some((r) => r.fromTable === t.id || r.toTable === t.id));
  if (isolated.length) out.push('', `Tables with no detected relationships: ${isolated.map((t) => t.id).join(', ')}`);
  if (m.warnings.length) out.push('', '## Warnings', '', ...m.warnings.map((w) => `- ${w}`));
  return out.join('\n') + '\n';
}