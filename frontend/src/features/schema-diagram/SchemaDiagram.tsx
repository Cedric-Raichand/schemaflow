import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow,
  useReactFlow, type Edge, type Node, type NodeMouseHandler,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SchemaModel } from '../../types/schema'
import { loadLayout, saveLayout, type Positions } from '../../services/storage'
import { computeLayout } from './layout'
import { TableNode, type TableNodeData } from './TableNode'

const nodeTypes = { table: TableNode }

interface Props {
  model: SchemaModel
  projectId: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  matches: Map<string, string[]> | null // tableId -> matching columns; null = no active search
  showInferred: boolean
  layoutVersion: number // bump to force a re-layout (e.g. after "reset layout")
  focusTick: number // bump to pan/zoom to the selection (sidebar picks, inspector jumps)
}

export function SchemaDiagram({ model, projectId, selectedId, onSelect, matches, showInferred, layoutVersion, focusTick }: Props) {
  const { fitView } = useReactFlow()
  const [positions, setPositions] = useState<Positions>({})

  // (Re)compute positions when the model or layout version changes.
  useEffect(() => {
    setPositions(computeLayout(model, layoutVersion === 0 ? loadLayout(projectId) : {}))
  }, [model, projectId, layoutVersion])

  useEffect(() => {
    const id = requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }))
    return () => cancelAnimationFrame(id)
  }, [model, layoutVersion, fitView])

  const relationships = useMemo(
    () => model.relationships.filter((r) => showInferred || r.source === 'explicit'),
    [model, showInferred],
  )

  const neighbours = useMemo(() => {
    if (!selectedId) return null
    const s = new Set<string>([selectedId])
    for (const r of relationships) {
      if (r.fromTable === selectedId) s.add(r.toTable)
      if (r.toTable === selectedId) s.add(r.fromTable)
    }
    return s
  }, [selectedId, relationships])

  const nodes: Node[] = useMemo(
    () => model.tables.map((t) => {
      const dimmedBySearch = matches !== null && !matches.has(t.id)
      const dimmedBySelection = neighbours !== null && !neighbours.has(t.id)
      const data: TableNodeData = {
        table: t,
        selected: t.id === selectedId,
        dimmed: dimmedBySearch || dimmedBySelection,
        matchedColumns: matches?.get(t.id) ?? [],
      }
      return { id: t.id, type: 'table', position: positions[t.id] ?? { x: 0, y: 0 }, data }
    }),
    [model, positions, selectedId, matches, neighbours],
  )

  const edges: Edge[] = useMemo(
    () => relationships.map((r) => {
      const active = selectedId !== null && (r.fromTable === selectedId || r.toTable === selectedId)
      const faded = selectedId !== null && !active
      return {
        id: r.id,
        source: r.fromTable,
        target: r.toTable,
        label: r.source === 'inferred' ? 'inferred?' : r.fromColumns.join(', '),
        animated: active,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className: `edge${r.source === 'inferred' ? ' edge-inferred' : ''}${active ? ' edge-active' : ''}${faded ? ' edge-faded' : ''}`,
        style: r.source === 'inferred' ? { strokeDasharray: '6 4' } : undefined,
      }
    }),
    [relationships, selectedId],
  )

  // Frame the selected table plus its neighbours — only when asked (not on every canvas click).
  useEffect(() => {
    if (focusTick === 0 || !selectedId || !neighbours) return
    // wait a tick so the canvas has resized for the inspector panel before framing
    const t = setTimeout(() => fitView({ nodes: [...neighbours].map((id) => ({ id })), padding: 0.3, maxZoom: 1, duration: 450 }), 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick])

  const onNodeClick: NodeMouseHandler = useCallback((_, n) => onSelect(n.id), [onSelect])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelect(null)}
      onNodeDragStop={(_, n) => {
        const next = { ...positions, [n.id]: n.position }
        setPositions(next)
        saveLayout(projectId, next)
      }}
      nodesConnectable={false}
      minZoom={0.05}
      maxZoom={2}
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
      <Controls showInteractive={false} />
      {model.tables.length > 12 && <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(10,12,16,0.7)" />}
    </ReactFlow>
  )
}