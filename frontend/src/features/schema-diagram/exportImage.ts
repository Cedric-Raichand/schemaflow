import { getNodesBounds, getViewportForBounds, type Node } from '@xyflow/react'
import { toPng } from 'html-to-image'

/** Renders the whole diagram (not just the visible part) to a PNG download. */
export async function downloadDiagramPng(nodes: Node[], filename: string) {
  const el = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!el || nodes.length === 0) throw new Error('Nothing to export.')
  const width = 2400
  const bounds = getNodesBounds(nodes)
  const height = Math.max(600, Math.round((width * bounds.height) / Math.max(bounds.width, 1)))
  const vp = getViewportForBounds(bounds, width, height, 0.05, 2, 0.05)
  const dataUrl = await toPng(el, {
    backgroundColor: '#0b0e14',
    width,
    height: Math.min(height, 6000),
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
  })
  download(dataUrl, filename)
}

export function download(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.click()
}

export function downloadText(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  download(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}