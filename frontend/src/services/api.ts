import type { Dialect, SchemaModel } from '../types/schema'

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>
  let msg = `Request failed (${res.status})`
  try {
    const body = await res.json()
    if (body?.error) msg = body.error
  } catch { /* non-JSON error body */ }
  throw new Error(msg)
}

export async function importSqlText(sql: string, dialect: Dialect): Promise<SchemaModel> {
  const res = await fetch('/api/import/sql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, dialect }),
  })
  return parse<SchemaModel>(res)
}

export async function importSqlFile(file: File, dialect: Dialect): Promise<SchemaModel> {
  const form = new FormData()
  form.append('dialect', dialect) // must come before the file so multer exposes it on req.body
  form.append('file', file)
  const res = await fetch('/api/import/sql', { method: 'POST', body: form })
  return parse<SchemaModel>(res)
}

export async function exportMarkdown(model: SchemaModel, projectName: string): Promise<string> {
  const res = await fetch('/api/export/markdown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, projectName }),
  })
  if (!res.ok) return parse<string>(res)
  return res.text()
}