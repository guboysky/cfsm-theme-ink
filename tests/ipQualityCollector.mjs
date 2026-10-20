// Exercise the actual shell wrapper with local stand-ins, never external probes.
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
await mkdir('test-results', { recursive: true })
const root = await mkdtemp(resolve('test-results/collector-'))
const bin = join(root, 'bin'); await mkdir(bin)
const slash = path => path.replaceAll('\\', '/')
const jqPath = join(root, 'jq.mjs')
await writeFile(jqPath, `
import fs from 'node:fs';
const args=process.argv.slice(2), mode=args[0];
const obj=path=>JSON.parse(fs.readFileSync(path,'utf8'));
if(mode==='-er') console.log(obj(args[2])[args[1].slice(1)]);
else if(mode==='-rn') console.log(encodeURIComponent(args[3]));
else if(mode==='-e') {try {const v=obj(args.at(-1));if(!v?.Head||typeof v.Head.IP!=='string'||!['Info','Score','Factor','Media','Mail'].some(k=>v[k]&&typeof v[k]==='object'&&Object.keys(v[k]).length))process.exit(1);}catch{process.exit(1);}}
else if(mode==='-n') {const v={};for(let i=1;i<args.length-1;){if(args[i]==='--arg'){v[args[i+1]]=args[i+2];i+=3;}else if(args[i]==='--slurpfile'){v[args[i+1]]=obj(args[i+2]);i+=3;}else throw Error('Unknown jq fixture argument');}console.log(JSON.stringify(v));}
else throw Error('Unknown jq fixture mode');
`)
const scripts = {
  jq: `#!/usr/bin/env bash\nexec node '${slash(jqPath)}' "$@"\n`,
  flock: '#!/usr/bin/env bash\nexit 0\n',
  ip: '#!/usr/bin/env bash\nexit 0\n',
  curl: `#!/usr/bin/env bash
set -e
body=''
while [[ $# -gt 0 ]]; do if [[ "$1" == --data-binary ]]; then body=$(printf %s "$2" | cut -c 2-); shift 2; else shift; fi; done
family=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).family)" "$body")
cp "$body" "$IPQ_UPLOADS/$family.json"
`
}
for (const [name, script] of Object.entries(scripts)) await writeFile(join(bin, name), script, { mode: 0o755 })
const engine = join(root, 'engine.sh')
await writeFile(engine, `#!/usr/bin/env bash
family=v4; [[ "$1" == -6 ]] && family=v6
if [[ "$family" == v4 && "$IPQ_FIXTURE_MODE" == invalid ]]; then echo not-json; echo fixture-diagnostic >&2; exit 1; fi
if [[ "$family" == v4 && "$IPQ_FIXTURE_MODE" == incomplete ]]; then echo '{"Head":{"IP":"192.0.*.*"}}'; exit 0; fi
printf '{"Head":{"IP":"192.0.*.*"},"Info":{"ASN":"AS0"}}\\n'
if [[ "$family" == v4 ]]; then [[ "$IPQ_FIXTURE_MODE" == timeout ]] && exit 124; exit 1; fi
exit 0
`, { mode: 0o755 })
const bash = process.env.BASH_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash')
const binPath = slash(bin).replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase())
for (const [mode, expected] of [['complete', 'report'], ['invalid', 'collector_failed'], ['incomplete', 'invalid_output'], ['timeout', 'timeout']]) {
  const state = join(root, mode), uploads = join(state, 'uploads'); await mkdir(uploads, { recursive: true })
  const config = join(state, 'config.json')
  await writeFile(config, JSON.stringify({ url: 'https://fixture.invalid', node: 'node-a', token: 'a'.repeat(64) }))
  const result = spawnSync(bash, ['-c', `export PATH='${binPath}':"$PATH"; exec bash integrations/ip-quality/collector.sh`], { encoding: 'utf8', env: { ...process.env, CFSM_IPQ_CONFIG: slash(config), CFSM_IPQ_STATE: slash(state), CFSM_IPQ_ENGINE: slash(engine), IPQ_FIXTURE_MODE: mode, IPQ_UPLOADS: slash(uploads) }, timeout: 20000 })
  assert.equal(result.status, mode === 'complete' ? 0 : 1, result.stderr + String(result.error || ''))
  const v4 = JSON.parse(await readFile(join(uploads, 'v4.json'), 'utf8'))
  const v6 = JSON.parse(await readFile(join(uploads, 'v6.json'), 'utf8'))
  assert.ok(v6.report)
  if (expected === 'report') { assert.ok(v4.report); assert.equal(v4.error, undefined) }
  else { assert.equal(v4.error, expected); assert.ok((await readFile(join(state, 'last-error-v4.log'), 'utf8')).includes('reason=' + expected)) }
  assert.equal((await readdir(state)).some(name => name.startsWith('run.') && name !== 'run.lock'), false)
  console.log('PASS collector wrapper: ' + mode)
}
console.log('4 collector regressions passed; no external network requests or IP checks ran.')
