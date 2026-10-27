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

// ---- Snapshots: saved copies of a schema, used for comparison ----
export interface Snapshot {
  id: string
  label: string
  projectName: string
  savedAt: string
  model: SchemaModel
}

const SNAPSHOTS = 'schemaflow:snapshots'
const MAX_SNAPSHOTS = 10

export const listSnapshots = (): Snapshot[] => read<Snapshot[]>(SNAPSHOTS, [])

/** Returns null if the browser has no room left (oldest snapshots are dropped first to make space). */
export function saveSnapshot(label: string, projectName: string, model: SchemaModel): Snapshot | null {
  const snap: Snapshot = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label: label.trim().slice(0, 80) || 'Snapshot',
    projectName,
    savedAt: new Date().toISOString(),
    model,
  }
  const next = [snap, ...listSnapshots()].slice(0, MAX_SNAPSHOTS)
  while (next.length && !write(SNAPSHOTS, next)) next.pop()
  return next.includes(snap) ? snap : null
}

export function deleteSnapshot(id: string) {
  write(SNAPSHOTS, listSnapshots().filter((s) => s.id !== id))
}