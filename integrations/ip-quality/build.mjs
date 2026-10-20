import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(process.env.CFSM_SOURCE ? resolve(process.env.CFSM_SOURCE, 'package.json') : import.meta.url)
const { build } = require('esbuild')
await mkdir(resolve(root, 'release'), { recursive: true })
const result = await build({ entryPoints: [resolve(root, 'worker.js')], bundle: true, write: false, format: 'esm', target: 'es2022', loader: { '.sh': 'text' }, legalComments: 'inline' })
const bytes = result.outputFiles[0].contents
await writeFile(resolve(root, 'release/worker.js'), bytes)
await writeFile(resolve(root, 'release/SHA256SUMS'), createHash('sha256').update(bytes).digest('hex') + '  worker.js\n')
console.log('Built console-deployable integrations/ip-quality/release/worker.js')
