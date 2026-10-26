import { useReactFlow } from '@xyflow/react'
import { useMemo, useState } from 'react'
import { exportMarkdown } from '../services/api'
import { clearLayout } from '../services/storage'
import { Inspector } from '../features/table-explorer/Inspector'
import { SchemaDiagram } from '../features/schema-diagram/SchemaDiagram'
import { downloadDiagramPng, downloadText } from '../features/schema-diagram/exportImage'
import { orphanTables, searchSchema } from '../features/search/search'
import type { SchemaModel } from '../types/schema'

interface Props {
  name: string
  projectId: string
  model: SchemaModel
  onClose: () => void
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'schema'

export function Workspace({ name, projectId, model, onClose }: Props) {
  const { fitView, getNodes } = useReactFlow()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showInferred, setShowInferred] = useState(true)
  const [layoutVersion, setLayoutVersion] = useState(0)
  const [focusTick, setFocusTick] = useState(0)
  const [showWarnings, setShowWarnings] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const results = useMemo(() => searchSchema(model, query), [model, query])
  const matches = useMemo(
    () => (query.trim() ? new Map(results.map((r) => [r.table.id, r.columns])) : null),
    [results, query],
  )
  const orphans = useMemo(() => orphanTables(model), [model])
  const selected = model.tables.find((t) => t.id === selectedId) ?? null
  const inferredCount = model.relationships.filter((r) => r.source === 'inferred').length

  const pick = (id: string) => { setSelectedId(id); setFocusTick((n) => n + 1) }
  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 3500) }

  async function run(label: string, fn: () => Promise<void> | void) {
    try { await fn() } catch (e) { flash(`${label} failed: ${e instanceof Error ? e.message : 'unknown error'}`) }
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <button className="btn ghost" onClick={onClose}>← Projects</button>
        <div className="title">
          <strong>{name}</strong>
          <span className="muted"> · {model.dialect === 'postgresql' ? 'PostgreSQL' : 'MySQL'} · {model.tables.length} tables · {model.relationships.filter((r) => r.source === 'explicit').length} relationships</span>
        </div>
        <div className="spacer" />
        {inferredCount > 0 && (
          <label className="toggle" title="Relationships guessed from column names (e.g. user_id). Not enforced by the database.">
            <input type="checkbox" checked={showInferred} onChange={(e) => setShowInferred(e.target.checked)} />
            inferred ({inferredCount})
          </label>
        )}
        {model.warnings.length > 0 && <button className="btn ghost warn" onClick={() => setShowWarnings((v) => !v)}>⚠ {model.warnings.length}</button>}
        <button className="btn ghost" onClick={() => fitView({ padding: 0.15, duration: 300 })}>Fit</button>
        <button className="btn ghost" onClick={() => { clearLayout(projectId); setLayoutVersion((v) => v + 1) }}>Reset layout</button>
        <button className="btn" onClick={() => run('PNG export', () => downloadDiagramPng(getNodes(), `${slug(name)}.png`))}>PNG</button>
        <button className="btn" onClick={() => downloadText(JSON.stringify(model, null, 2), `${slug(name)}.json`, 'application/json')}>JSON</button>
        <button className="btn" onClick={() => run('Markdown export', async () => downloadText(await exportMarkdown(model, name), `${slug(name)}.md`, 'text/markdown'))}>Markdown</button>
      </header>

      {showWarnings && (
        <div className="warnings"><ul>{model.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      )}
      {notice && <div className="toast" role="status">{notice}</div>}

      <div className="body">
        <nav className="sidebar" aria-label="Tables">
          <input className="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tables, columns, types…" aria-label="Search schema" />
          <div className="list-head">
            {query.trim() ? `${results.length} match${results.length === 1 ? '' : 'es'}` : 'Tables'}
            {query && <button className="link" onClick={() => setQuery('')}>clear</button>}
          </div>
          <ul className="tlist">
            {results.map(({ table, columns }) => (
              <li key={table.id}>
                <button className={table.id === selectedId ? 'active' : ''} onClick={() => pick(table.id)}>
                  {table.id}
                  {table.isLikelyJunction && <span className="badge badge-junction">junction</span>}
                </button>
                {columns.length > 0 && <div className="hits">{columns.slice(0, 4).join(', ')}{columns.length > 4 ? '…' : ''}</div>}
              </li>
            ))}
            {results.length === 0 && <li className="muted pad">Nothing matches “{query}”.</li>}
          </ul>
          {!query && orphans.length > 0 && (
            <>
              <div className="list-head">No relationships ({orphans.length})</div>
              <ul className="tlist">
                {orphans.map((t) => <li key={t.id}><button onClick={() => pick(t.id)}>{t.id}</button></li>)}
              </ul>
            </>
          )}
        </nav>

        <main className="canvas">
          <SchemaDiagram model={model} projectId={projectId} selectedId={selectedId} onSelect={setSelectedId}
            matches={matches} showInferred={showInferred} layoutVersion={layoutVersion} focusTick={focusTick} />
        </main>

        {selected && <Inspector model={model} table={selected} onJump={pick} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  )
}