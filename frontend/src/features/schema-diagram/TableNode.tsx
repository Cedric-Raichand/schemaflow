import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Table } from '../../types/schema'
import { MAX_ROWS } from './layout'

export interface TableNodeData extends Record<string, unknown> {
  table: Table
  dimmed: boolean
  selected: boolean
  matchedColumns: string[]
}

export function TableNode({ data }: NodeProps) {
  const { table, dimmed, selected, matchedColumns } = data as TableNodeData
  const shown = table.columns.slice(0, MAX_ROWS)
  const hidden = table.columns.length - shown.length
  return (
    <div className={`tnode${selected ? ' is-selected' : ''}${dimmed ? ' is-dimmed' : ''}${table.isLikelyJunction ? ' is-junction' : ''}`}>
      <Handle type="target" position={Position.Left} className="handle" />
      <div className="tnode-head">
        <span className="tnode-name">{table.name}</span>
        {table.schema && <span className="tnode-schema">{table.schema}</span>}
        {table.isLikelyJunction && <span className="badge badge-junction" title="Likely junction table">junction</span>}
      </div>
      <ul className="tnode-cols">
        {shown.map((c) => (
          <li key={c.name} className={matchedColumns.includes(c.name) ? 'is-match' : ''}>
            <span className="key">{c.isPrimaryKey ? 'PK' : c.isForeignKey ? 'FK' : ''}</span>
            <span className="cname">{c.name}</span>
            <span className="ctype">{c.dataType.toLowerCase()}</span>
          </li>
        ))}
        {hidden > 0 && <li className="more">+{hidden} more columns</li>}
      </ul>
      <Handle type="source" position={Position.Right} className="handle" />
    </div>
  )
}