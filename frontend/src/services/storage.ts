import type { SchemaModel } from '../types/schema'

export interface SavedProject {
  id: string
  name: string
  model: SchemaModel
  savedAt: string
}

const PROJECTS = 'schemaflow:projects'
const MAX_PROJECTS = 5

// Browser storage can throw (private windows, quota) — every access is guarded.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const listProjects = (): SavedProject[] => read<SavedProject[]>(PROJECTS, [])

export function saveProject(name: string, model: SchemaModel): SavedProject {
  const id = `${name}:${model.tables.map((t) => t.id).sort().join(',')}`
  const project: SavedProject = { id, name, model, savedAt: new Date().toISOString() }
  const next = [project, ...listProjects().filter((p) => p.id !== id)].slice(0, MAX_PROJECTS)
  // If storage is full, drop the oldest until it fits.
  while (next.length && !write(PROJECTS, next)) next.pop()
  return project
}

export function deleteProject(id: string) {
  write(PROJECTS, listProjects().filter((p) => p.id !== id))
  try { localStorage.removeItem(`schemaflow:layout:${id}`) } catch { /* ignore */ }
}

export type Positions = Record<string, { x: number; y: number }>
export const loadLayout = (projectId: string) => read<Positions>(`schemaflow:layout:${projectId}`, {})
export const saveLayout = (projectId: string, p: Positions) => write(`schemaflow:layout:${projectId}`, p)
export const clearLayout = (projectId: string) => {
  try { localStorage.removeItem(`schemaflow:layout:${projectId}`) } catch { /* ignore */ }
}