import { ReactFlowProvider } from '@xyflow/react'
import { useState } from 'react'
import { ImportPanel } from './features/connections/ImportPanel'
import { Workspace } from './pages/Workspace'
import { saveProject, type SavedProject } from './services/storage'
import type { SchemaModel } from './types/schema'

export default function App() {
  const [project, setProject] = useState<SavedProject | null>(null)

  const open = (name: string, model: SchemaModel) => setProject(saveProject(name, model))

  if (!project) return <ImportPanel onLoaded={open} onOpenSaved={setProject} />
  return (
    <ReactFlowProvider>
      <Workspace name={project.name} projectId={project.id} model={project.model} onClose={() => setProject(null)} />
    </ReactFlowProvider>
  )
}