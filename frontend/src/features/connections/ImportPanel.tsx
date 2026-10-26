import { useRef, useState } from 'react'
import { importSqlFile, importSqlText } from '../../services/api'
import { deleteProject, listProjects, type SavedProject } from '../../services/storage'
import type { Dialect, SchemaModel } from '../../types/schema'

interface Props {
  onLoaded: (name: string, model: SchemaModel) => void
  onOpenSaved: (p: SavedProject) => void
}

export function ImportPanel({ onLoaded, onOpenSaved }: Props) {
  const [dialect, setDialect] = useState<Dialect>('postgresql')
  const [name, setName] = useState('My project')
  const [sql, setSql] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedProject[]>(listProjects)
  const fileRef = useRef<HTMLInputElement>(null)

  async function run(fn: () => Promise<SchemaModel>, projectName = name) {
    setBusy(true)
    setError(null)
    try {
      onLoaded(projectName.trim() || 'Untitled', await fn())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  async function loadSample() {
    const text = await fetch('/pharmacy.sample.sql').then((r) => r.text())
    setName('Pharmacy Platform')
    setDialect('postgresql')
    await run(() => importSqlText(text, 'postgresql'), 'Pharmacy Platform')
  }

  return (
    <div className="import">
      <header className="hero">
        <div className="logo">SchemaFlow</div>
        <h1>See how your database fits together.</h1>
        <p>Import a SQL schema and explore tables, keys and relationships as an interactive map. Your schema is parsed on the server and never stored there.</p>
      </header>

      <section className="card">
        <div className="row">
          <label>Project name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
          <label>Dialect
            <select value={dialect} onChange={(e) => setDialect(e.target.value as Dialect)}>
              <option value="postgresql">PostgreSQL</option>
              <option value="mysql">MySQL</option>
            </select>
          </label>
        </div>

        <div className="row actions">
          <input ref={fileRef} type="file" accept=".sql,text/plain" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => importSqlFile(f, dialect)); e.target.value = '' }} />
          <button className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>Upload .sql file</button>
          <button className="btn" disabled={busy} onClick={loadSample}>Try the pharmacy sample</button>
        </div>

        <label>…or paste SQL
          <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={8} spellCheck={false}
            placeholder={'CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email VARCHAR(255) NOT NULL\n);'} />
        </label>
        <button className="btn" disabled={busy || !sql.trim()} onClick={() => run(() => importSqlText(sql, dialect))}>
          {busy ? 'Parsing…' : 'Visualize pasted SQL'}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="hint">Tip: export structure only, e.g. <code>pg_dump --schema-only</code> or <code>mysqldump --no-data</code>. No data is needed.</p>
      </section>

      {saved.length > 0 && (
        <section className="card">
          <h2>Recent projects</h2>
          <ul className="recent">
            {saved.map((p) => (
              <li key={p.id}>
                <button className="link" onClick={() => onOpenSaved(p)}>{p.name}</button>
                <span className="muted"> {p.model.tables.length} tables · {new Date(p.savedAt).toLocaleDateString()}</span>
                <button className="icon-btn" aria-label={`Delete ${p.name}`}
                  onClick={() => { deleteProject(p.id); setSaved(listProjects()) }}>✕</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}