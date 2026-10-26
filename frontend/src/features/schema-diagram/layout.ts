import dagre from 'dagre'
import type { SchemaModel, Table } from '../../types/schema'
import type { Positions } from '../../services/storage'

export const NODE_WIDTH = 250
export const MAX_ROWS = 10
const HEADER = 38
const ROW = 24
const FOOTER = 22

export function nodeHeight(t: Table): number {
  const rows = Math.min(t.columns.length, MAX_ROWS)
  return HEADER + rows * ROW + (t.columns.length > MAX_ROWS ? FOOTER : 0) + 8
}

/** Left-to-right auto layout. Saved positions override computed ones. */
export function computeLayout(model: SchemaModel, saved: Positions): Positions {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 110, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const t of model.tables) g.setNode(t.id, { width: NODE_WIDTH, height: nodeHeight(t) })
  for (const r of model.relationships) {
    if (r.fromTable !== r.toTable) g.setEdge(r.fromTable, r.toTable)
  }
  dagre.layout(g)
  const out: Positions = {}
  for (const t of model.tables) {
    const n = g.node(t.id)
    out[t.id] = saved[t.id] ?? { x: n.x - NODE_WIDTH / 2, y: n.y - nodeHeight(t) / 2 }
  }
  return out
}