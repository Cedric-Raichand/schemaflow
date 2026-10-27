import { useEffect, useMemo, useRef, useState } from 'react'
import { compareSchemas, importSqlFile } from '../../services/api'
import { deleteSnapshot, listSnapshots, type Snapshot } from '../../services/storage'
import { downloadText } from '../schema-diagram/exportImage'
import type { Change, Risk, SchemaDiff } from '../../types/diff'
import type { SchemaModel } from '../../types/schema'
import { diffToMarkdown } from './diffMarkdown'

interface Props {
  currentName: string
  currentModel: SchemaModel
  onClose: () => void
}

const RANK: Record<Risk, number> = { breaking: 0, caution: 1, safe: 2 }
const LABEL: Record<Risk, string> = { breaking: 'Breaking', caution: 'Caution', safe: 'Safe' }
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function ComparePanel({ currentName, currentModel, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>(listSnapshots)
  const [baseId, setBaseId] = useState(snapshots[0]?.id ?? '')
  const [target, setTarget] = useState<string>('current') // 'current' | 'file' | snapshot id
  const [fileModel, setFileModel] = useState<{ name: string; model: SchemaModel } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ diff: SchemaDiff; baseLabel: string; targetLabel: string } | null>(null)
  const [filter, setFilter] = useState<Risk | 'all'>('all')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const base = snapshots.find((s) => s.id === baseId) ?? null
  const targetSnap = snapshots.find((s) => s.id === target) ?? null
  const targetModel = target === 'current' ? currentModel : target === 'file' ? fileModel?.model ?? null : targetSnap?.model ?? null
  const targetLabel = target === 'current' ? `Current schema (${currentName})` : target === 'file' ? fileModel?.name ?? '' : targetSnap?.label ?? ''
  const ready = !!base && !!targetModel && !busy && !(target !== 'current' && target !== 'file' && target === baseId)

  async function onFile(f: File) {
    setError(null)
    setBusy(true)
    try {
      setFileModel({ name: f.name, model: await importSqlFile(f, currentModel.dialect) })
    } catch (e) {
      setFileModel(null)
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    if (!base || !targetModel) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const diff = await compareSchemas(base.model, targetModel)
      setFilter('all')
      setResult({ diff, baseLabel: base.label, targetLabel })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Comparison failed.')
    } finally {
      setBusy(false)
    }
  }

  const groups = useMemo(() => {
    if (!result) return []
    const visible = result.diff.changes.filter((c) => filter === 'all' || c.risk === filter)
    const m = new Map<string, Change[]>()
    for (const c of visible) m.set(c.table, [...(m.get(c.table) ?? []), c])
    return [...m.entries()].sort((a, b) => RANK[a[1][0].risk] - RANK[b[1][0].risk] || a[0].localeCompare(b[0]))
  }, [result, filter])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Compare schemas">
        <header className="modal-head">
          <h2>Compare schemas</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {snapshots.length === 0 ? (
          <div className="empty">
            <p><strong>No snapshots yet.</strong></p>
            <ol>
              <li>Click <strong>Snapshot</strong> in the top bar to save the schema as it is now.</li>
              <li>Change your database or SQL file.</li>
              <li>Import or reconnect to load the new schema, then come back here and compare it with your snapshot.</li>
            </ol>
            <p className="muted">Want to try it first? Save a snapshot of the pharmacy sample, then import <code>pharmacy.v2.sql</code> and compare.</p>
          </div>
        ) : (
          <>
            <div className="pickers">
              <label>Before (saved snapshot)
                <select value={baseId} onChange={(e) => { setBaseId(e.target.value); setResult(null) }}>
                  {snapshots.map((s) => <option key={s.id} value={s.id}>{s.label} · {s.model.tables.length} tables · {when(s.savedAt)}</option>)}
                </select>
              </label>
              <div className="arrow" aria-hidden>→</div>
              <label>After
                <select value={target} onChange={(e) => { setTarget(e.target.value); setResult(null); if (e.target.value === 'file') fileRef.current?.click() }}>
                  <option value="current">Current schema ({currentName})</option>
                  <option value="file">Upload a .sql file…</option>
                  {snapshots.filter((s) => s.id !== baseId).map((s) => <option key={s.id} value={s.id}>Snapshot: {s.label}</option>)}
                </select>
              </label>
            </div>
            <input ref={fileRef} type="file" accept=".sql,text/plain" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
            {target === 'file' && (
              <p className="hint" style={{ margin: '0 0 10px' }}>
                {fileModel ? <>Using <strong>{fileModel.name}</strong> · {fileModel.model.tables.length} tables. </> : 'No file chosen yet. '}
                <button className="link" onClick={() => fileRef.current?.click()}>{fileModel ? 'Choose a different file' : 'Choose a file'}</button>
              </p>
            )}
            <div className="row actions" style={{ gridTemplateColumns: 'auto auto 1fr' }}>
              <button className="btn primary" disabled={!ready} onClick={run}>{busy ? 'Comparing…' : 'Compare'}</button>
              {base && <button className="btn ghost" onClick={() => { deleteSnapshot(base.id); const l = listSnapshots(); setSnapshots(l); setBaseId(l[0]?.id ?? ''); setResult(null) }}>Delete this snapshot</button>}
            </div>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}

        {result && (
          <section className="results" aria-live="polite">
            {result.diff.identical ? (
              <div className="notice ok">No differences. These two schemas are identical.</div>
            ) : (
              <>
                <div className="chips">
                  <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All {result.diff.counts.total}</button>
                  {(['breaking', 'caution', 'safe'] as Risk[]).map((r) => (
                    <button key={r} className={`chip risk-${r}${filter === r ? ' on' : ''}`} onClick={() => setFilter(filter === r ? 'all' : r)} disabled={result.diff.counts[r] === 0}>
                      {LABEL[r]} {result.diff.counts[r]}
                    </button>
                  ))}
                  <span className="spacer" />
                  <button className="btn" onClick={() => downloadText(diffToMarkdown(result.diff, result.baseLabel, result.targetLabel), 'schema-comparison.md', 'text/markdown')}>Download report</button>
                </div>
                {groups.map(([table, list]) => (
                  <div key={table} className="group">
                    <h3 className="mono">{table}</h3>
                    <ul>
                      {list.map((c, i) => (
                        <li key={`${c.kind}-${c.column ?? ''}-${i}`}>
                          <span className={`risk risk-${c.risk}`}>{LABEL[c.risk]}</span>
                          <div>
                            <div>{c.summary}</div>
                            {(c.before !== undefined || c.after !== undefined) && (
                              <div className="mono muted">{c.before ?? '—'} → {c.after ?? '—'}</div>
                            )}
                            <div className="muted impact">{c.impact}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            )}
            <ul className="notes">{result.diff.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
        )}
      </div>
    </div>
  )
}