import { useMemo, useState } from 'react'
import type { Relationship, SchemaModel, Table } from '../../types/schema'
import { referencedBy, references } from '../search/search'

type SortKey = 'position' | 'name' | 'type'

function RelRow({ r, direction, onJump }: { r: Relationship; direction: 'out' | 'in'; onJump: (id: string) => void }) {
  const other = direction === 'out' ? r.toTable : r.fromTable
  return (
    <li>
      <button className="link" onClick={() => onJump(other)}>{other}</button>
      <span className="muted"> {direction === 'out' ? `via ${r.fromColumns.join(', ')} → ${r.toColumns.join(', ')}` : `via ${r.fromColumns.join(', ')}`}</span>
      <span className={`badge ${r.source === 'explicit' ? 'badge-fk' : 'badge-inferred'}`}>
        {r.source === 'explicit' ? r.cardinality : 'inferred — confirm'}
      </span>
      {r.onDelete && <span className="muted"> · on delete {r.onDelete.toLowerCase()}</span>}
    </li>
  )
}

export function Inspector({ model, table, onJump, onClose }: {
  model: SchemaModel; table: Table; onJump: (id: string) => void; onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('position')

  const cols = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = table.columns.filter((c) => !f || c.name.toLowerCase().includes(f) || c.dataType.toLowerCase().includes(f))
    if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'type') return [...list].sort((a, b) => a.dataType.localeCompare(b.dataType))
    return list
  }, [table, filter, sort])

  const out = references(model, table.id)
  const inc = referencedBy(model, table.id)

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <h2>{table.name}</h2>
          <p className="muted">{table.schema ? `${table.schema} · ` : ''}{table.columns.length} columns{table.isLikelyJunction ? ' · likely junction table' : ''}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close inspector">✕</button>
      </div>

      <div className="inspector-tools">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter columns…" aria-label="Filter columns" />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort columns">
          <option value="position">Original order</option>
          <option value="name">Name</option>
          <option value="type">Type</option>
        </select>
      </div>

      <table className="coltable">
        <thead><tr><th>Column</th><th>Type</th><th>Null</th><th>Default</th></tr></thead>
        <tbody>
          {cols.map((c) => (
            <tr key={c.name}>
              <td>
                <span className="cname">{c.name}</span>
                {c.isPrimaryKey && <span className="badge badge-pk">PK</span>}
                {c.isForeignKey && <span className="badge badge-fk">FK</span>}
                {c.isUnique && <span className="badge badge-uq">UQ</span>}
              </td>
              <td className="mono">{c.dataType}</td>
              <td>{c.nullable ? 'yes' : 'no'}</td>
              <td className="mono muted">{c.defaultValue ?? '—'}</td>
            </tr>
          ))}
          {cols.length === 0 && <tr><td colSpan={4} className="muted">No columns match.</td></tr>}
        </tbody>
      </table>

      <h3>References ({out.length})</h3>
      {out.length ? <ul className="rels">{out.map((r) => <RelRow key={r.id} r={r} direction="out" onJump={onJump} />)}</ul> : <p className="muted">Doesn’t reference other tables.</p>}

      <h3>Referenced by ({inc.length})</h3>
      {inc.length ? <ul className="rels">{inc.map((r) => <RelRow key={r.id} r={r} direction="in" onJump={onJump} />)}</ul> : <p className="muted">No other table references this one.</p>}

      <h3>Indexes ({table.indexes.length})</h3>
      {table.indexes.length ? (
        <ul className="rels">
          {table.indexes.map((i, n) => (
            <li key={`${i.name}-${n}`}>
              <span className="mono">{i.name}</span> <span className="muted">({i.columns.join(', ')})</span>
              {i.primary ? <span className="badge badge-pk">primary</span> : i.unique ? <span className="badge badge-uq">unique</span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted">No indexes defined in the imported SQL.</p>}
    </aside>
  )
}