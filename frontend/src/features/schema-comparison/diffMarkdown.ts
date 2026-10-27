import type { Change, Risk, SchemaDiff } from '../../types/diff'

const ICON: Record<Risk, string> = { breaking: '🔴 Breaking', caution: '🟠 Caution', safe: '🟢 Safe' }

export function diffToMarkdown(diff: SchemaDiff, baseLabel: string, targetLabel: string): string {
  const out: string[] = ['# Schema comparison', '']
  out.push(`- **Before:** ${baseLabel} (${diff.baseTables} tables)`)
  out.push(`- **After:** ${targetLabel} (${diff.nextTables} tables)`)
  out.push(`- **Generated:** ${new Date().toISOString().slice(0, 10)}`, '')

  if (diff.identical) {
    out.push('No differences found. The two schemas are identical.', '')
  } else {
    out.push(`**${diff.counts.total} changes:** ${diff.counts.breaking} breaking, ${diff.counts.caution} caution, ${diff.counts.safe} safe`, '')
    const byTable = new Map<string, Change[]>()
    for (const c of diff.changes) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c])
    for (const [table, list] of byTable) {
      out.push(`## ${table}`, '')
      for (const c of list) {
        out.push(`- ${ICON[c.risk]}: ${c.summary}`)
        if (c.before !== undefined || c.after !== undefined) out.push(`  - \`${c.before ?? '—'}\` → \`${c.after ?? '—'}\``)
        out.push(`  - ${c.impact}`)
      }
      out.push('')
    }
  }
  out.push('## Notes', '', ...diff.notes.map((n) => `- ${n}`), '')
  return out.join('\n')
}