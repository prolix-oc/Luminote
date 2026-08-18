import { existsSync } from 'node:fs'

import type { SpindleManifest } from 'lumiverse-spindle-types'

const manifest = await Bun.file('spindle.json').json() as SpindleManifest
const packageJson = await Bun.file('package.json').json() as { version?: unknown }

const requiredManifestFields: (keyof SpindleManifest)[] = [
  'version',
  'name',
  'identifier',
  'author',
  'github',
  'homepage',
  'permissions',
]

for (const field of requiredManifestFields) {
  if (!manifest[field]) throw new Error(`spindle.json is missing required field: ${field}`)
}

if (manifest.version !== packageJson.version) {
  throw new Error(`Version mismatch: spindle.json (${manifest.version}) != package.json (${String(packageJson.version)})`)
}

for (const entry of [manifest.entry_backend ?? 'dist/backend.js', manifest.entry_frontend ?? 'dist/frontend.js']) {
  if (!existsSync(entry)) throw new Error(`Missing built entry point: ${entry}`)
}

console.log(`Luminote ${manifest.version} release verification passed.`)
