// Full project health check. Run from the root schemaflow folder:
//   node scripts/check-structure.mjs          -> files, up-to-date contents, installed packages (instant)
//   node scripts/check-structure.mjs --full   -> all of the above + typecheck + tests (about a minute)
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const FULL = process.argv.includes('--full')
let problems = 0
const bad = (tag, msg, hint) => { problems++; console.log(`  ✗ ${tag.padEnd(10)} ${msg}${hint ? `\n               → ${hint}` : ''}`) }
const section = (t) => console.log(`\n${t}`)

if (!existsSync('package.json') || !readFileSync('package.json', 'utf8').includes('"workspaces"')) {
  console.log('This does not look like the root schemaflow folder (no root package.json with "workspaces").')
  console.log('Open a terminal in the folder that contains backend, frontend and scripts, then run this again.')
  process.exit(1)
}

// 1. Files that must exist
const files = [
  '.gitignore', 'package.json', 'samples/pharmacy.sql', 'samples/pharmacy.v2.sql',
  'backend/package.json', 'backend/tsconfig.json',
  'backend/src/app.ts', 'backend/src/routes/index.ts', 'backend/src/routes/connections.ts',
  'backend/src/types/schema.ts', 'backend/src/validators/schemaModel.ts', 'backend/src/validators/connection.ts',
  'backend/src/services/schemaBuilder.ts', 'backend/src/types/diff.ts', 'backend/src/services/comparison/diff.ts',
  'backend/src/services/importers/sqlImporter.ts', 'backend/src/services/exporters/markdownExporter.ts',
  'backend/src/services/introspection/hostGuard.ts', 'backend/src/services/introspection/errors.ts',
  'backend/src/services/introspection/postgres.ts',
  'backend/tests/sqlImporter.test.ts', 'backend/tests/api.test.ts',
  'backend/tests/hostGuard.test.ts', 'backend/tests/connection.test.ts', 'backend/tests/diff.test.ts',
  'frontend/package.json', 'frontend/index.html', 'frontend/vite.config.ts',
  'frontend/tsconfig.json', 'frontend/tsconfig.app.json', 'frontend/tsconfig.node.json',
  'frontend/public/pharmacy.sample.sql',
  'frontend/src/main.tsx', 'frontend/src/App.tsx', 'frontend/src/index.css',
  'frontend/src/pages/Workspace.tsx',
  'frontend/src/services/api.ts', 'frontend/src/services/storage.ts', 'frontend/src/types/schema.ts', 'frontend/src/types/diff.ts',
  'frontend/src/features/search/search.ts',
  'frontend/src/features/schema-comparison/ComparePanel.tsx', 'frontend/src/features/schema-comparison/diffMarkdown.ts',
  'frontend/src/features/connections/ImportPanel.tsx', 'frontend/src/features/connections/ConnectPanel.tsx',
  'frontend/src/features/table-explorer/Inspector.tsx',
  'frontend/src/features/schema-diagram/SchemaDiagram.tsx', 'frontend/src/features/schema-diagram/TableNode.tsx',
  'frontend/src/features/schema-diagram/layout.ts', 'frontend/src/features/schema-diagram/exportImage.ts',
]
section(`1. Files (${files.length} expected)`)
let missing = 0
for (const f of files) {
  if (!existsSync(f)) { bad('MISSING', f); missing++ }
  else if (statSync(f).size === 0) { bad('EMPTY', f); missing++ }
}
for (const w of ['tests', 'src', 'index.html', 'App.tsx', 'services']) {
  if (existsSync(w)) bad('MISPLACED', `${w} is in the root folder`, 'it belongs inside backend/ or frontend/')
}
if (missing === 0) console.log('  ✓ all present and non-empty')
for (const o of ['README.md', 'docs/read-only-role.md']) {
  if (!existsSync(o)) console.log(`  ℹ optional, not added yet: ${o}`)
}

// 2. Files exist but might be OLD versions (a new file saved over the wrong place, or not replaced)
const markers = [
  ['backend/src/types/schema.ts', 'ConnectionParams'], ['frontend/src/types/schema.ts', 'ConnectionParams'],
  ['backend/src/app.ts', 'createConnectionRouter'], ['backend/src/services/importers/sqlImporter.ts', 'finalizeModel'],
  ['frontend/src/services/api.ts', 'introspectConnection'], ['frontend/src/services/api.ts', 'importSqlFile'],
  ['frontend/src/features/connections/ImportPanel.tsx', 'ConnectPanel'],
  ['frontend/src/features/connections/ConnectPanel.tsx', 'introspectConnection'],
  ['frontend/src/features/schema-diagram/exportImage.ts', 'downloadDiagramPng'],
  ['frontend/src/features/schema-diagram/exportImage.ts', 'downloadText'],
  ['frontend/src/index.css', '.connect '], ['frontend/src/index.css', '.modal-backdrop'],
  ['backend/src/routes/index.ts', '/compare'], ['frontend/src/services/api.ts', 'compareSchemas'],
  ['frontend/src/services/storage.ts', 'saveSnapshot'], ['frontend/src/pages/Workspace.tsx', 'ComparePanel'], ['backend/package.json', '"dev"'],
]
section('2. File contents are the latest versions')
let stale = 0
for (const [f, needle] of markers) {
  if (existsSync(f) && !readFileSync(f, 'utf8').includes(needle)) {
    bad('OUTDATED', `${f} does not contain "${needle}"`, 'replace it with the newest version I sent')
    stale++
  }
}
if (stale === 0 && missing === 0) console.log('  ✓ all up to date')

// 3. Packages installed
const deps = {
  backend: ['express', 'cors', 'multer', 'node-sql-parser', 'pg', 'express-rate-limit', 'tsx', 'vitest', 'typescript', 'supertest', '@types/pg'],
  frontend: ['react', 'react-dom', '@xyflow/react', 'dagre', 'html-to-image', 'vite', '@vitejs/plugin-react', 'typescript'],
}
section('3. Packages installed')
let pkgMissing = 0
for (const [ws, list] of Object.entries(deps)) {
  for (const p of list) {
    if (!['node_modules', `${ws}/node_modules`].some((d) => existsSync(`${d}/${p}`))) {
      bad('NOT FOUND', `${p} (${ws})`, ws === 'backend' && /^(pg|express-rate-limit|@types\/pg)$/.test(p)
        ? 'in the backend folder run: npm install pg express-rate-limit  and  npm install -D @types/pg'
        : 'in the root folder run: npm install')
      pkgMissing++
    }
  }
}
if (pkgMissing === 0) console.log('  ✓ all installed')

// 4. Typecheck + tests (only with --full)
if (FULL) {
  const run = (cmd, cwd) => spawnSync(cmd, { cwd, shell: true, encoding: 'utf8' })
  section('4. Typecheck')
  for (const [name, cmd, cwd] of [['backend', 'npx tsc --noEmit -p tsconfig.json', 'backend'], ['frontend', 'npx tsc -b', 'frontend']]) {
    const r = run(cmd, cwd)
    if (r.status === 0) console.log(`  ✓ ${name} has no type errors`)
    else {
      problems++
      console.log(`  ✗ ${name} type errors:`)
      console.log((r.stdout + r.stderr).split('\n').filter((l) => /error TS/.test(l)).slice(0, 8).map((l) => '      ' + l).join('\n'))
    }
  }
  section('5. Tests')
  const t = run('npx vitest run', 'backend')
  const summary = (t.stdout + t.stderr).split('\n').filter((l) => /Tests |Test Files/.test(l)).join(' | ').replace(/\s+/g, ' ')
  if (t.status === 0) console.log(`  ✓ ${summary}`)
  else { problems++; console.log(`  ✗ tests failed: ${summary}`) }
}

console.log(problems === 0
  ? `\n✅ Project setup looks good${FULL ? '' : '. Run with --full to also typecheck and run the tests'}.`
  : `\n❌ ${problems} problem(s). Fix the ✗ lines above (top to bottom), then run this again.`)
process.exit(problems === 0 ? 0 : 1)