import { useState } from 'react'
import { introspectConnection, testConnection, type ConnectionInfo } from '../../services/api'
import type { ConnectionParams, SchemaModel, SslMode } from '../../types/schema'

interface Props {
  onLoaded: (name: string, model: SchemaModel) => void
}

const parseSchemas = (text: string): string[] => {
  const list = text.split(',').map((s) => s.trim()).filter(Boolean)
  return list.length ? list : ['public']
}

export function ConnectPanel({ onLoaded }: Props) {
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('5432')
  const [database, setDatabase] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [sslMode, setSslMode] = useState<SslMode>('require')
  const [schemas, setSchemas] = useState('public')
  const [busy, setBusy] = useState<'test' | 'load' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<ConnectionInfo | null>(null)

  const params = (): ConnectionParams => ({
    host: host.trim(), port: Number(port) || 5432, database: database.trim(), user: user.trim(),
    password, sslMode, schemas: parseSchemas(schemas),
  })
  const ready = host.trim() && database.trim() && user.trim()

  async function run<T>(kind: 'test' | 'load', fn: () => Promise<T>, done: (r: T) => void) {
    setBusy(kind)
    setError(null)
    if (kind === 'test') setInfo(null)
    try {
      done(await fn())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed.')
    } finally {
      setBusy(null)
    }
  }

  const test = () => run('test', () => testConnection(params()), setInfo)

  const visualize = () => run('load', () => introspectConnection(params()), (model) => {
    setPassword('') // the password only lives in this form while you use it
    onLoaded(database.trim(), model)
  })

  return (
    <section className="card">
      <h2>Connect to a live PostgreSQL database</h2>
      <p className="hint" style={{ margin: 0 }}>
        SchemaFlow reads table structure only. It never reads rows, and the session is read-only.
        Use a read-only role (see <code>docs/read-only-role.md</code>). Credentials are used once and never stored.
      </p>

      <form className="connect" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) visualize() }}>
        <div className="row conn-row">
          <label>Host
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" spellCheck={false} />
          </label>
          <label>Port
            <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
          </label>
        </div>
        <div className="row conn-row">
          <label>Database
            <input value={database} onChange={(e) => setDatabase(e.target.value)} spellCheck={false} />
          </label>
          <label>SSL
            <select value={sslMode} onChange={(e) => setSslMode(e.target.value as SslMode)}>
              <option value="require">Require (encrypt)</option>
              <option value="verify">Verify certificate</option>
              <option value="disable">Disable (local only)</option>
            </select>
          </label>
        </div>
        <div className="row">
          <label>User
            <input value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} autoComplete="off" />
          </label>
          <label>Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        <label>Schemas <span className="muted">(comma-separated, or * for all)</span>
          <input value={schemas} onChange={(e) => setSchemas(e.target.value)} spellCheck={false} />
        </label>

        <div className="row actions">
          <button type="button" className="btn" disabled={!ready || busy !== null} onClick={test}>
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          <button type="submit" className="btn primary" disabled={!ready || busy !== null}>
            {busy === 'load' ? 'Reading structure…' : 'Connect and visualize'}
          </button>
        </div>
      </form>

      {info && (
        <div className="notice ok" role="status">
          Connected to <strong>{info.database}</strong> as <strong>{info.user}</strong> · PostgreSQL {info.serverVersion}
          {info.warnings.map((w) => <p key={w} className="warn-text">⚠ {w}</p>)}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  )
}