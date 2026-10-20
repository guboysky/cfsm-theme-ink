import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const require = createRequire(process.env.CFSM_SOURCE ? resolve(process.env.CFSM_SOURCE, 'package.json') : import.meta.url)
const { Miniflare } = require('miniflare')
let privateSite = false, challenge = false
const mf = new Miniflare({ modules: true, scriptPath: resolve('integrations/ip-quality/release/worker.js'), compatibilityDate: '2025-01-01', d1Databases: ['IPQ_DB'], serviceBindings: { MONITOR: async request => {
  const url = new URL(request.url), admin = request.headers.get('Authorization') === 'Bearer fixture-admin'
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://theme.example', 'Access-Control-Allow-Credentials': 'true' }
  if (url.pathname === '/api/config') return Response.json({ authorization: admin, is_public: !privateSite, turnstile_enabled: challenge }, { headers })
  if (url.pathname === '/api/server') {
    if (privateSite && !admin) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
    if (challenge && request.headers.get('X-Turnstile-Verified') !== 'fixture-proof') return Response.json({ error: 'Turnstile required' }, { status: 403, headers })
    if (url.searchParams.get('id') === 'hidden' || url.searchParams.get('id') === 'deleted') return Response.json({ error: 'Not found' }, { status: 404, headers })
    return Response.json({ id: url.searchParams.get('id'), name: 'Fixture node' }, { headers })
  }
  return new Response('original-route', { status: 202 })
} } })
const call = (path, options = {}) => mf.dispatchFetch('https://gateway.example' + path, options)
const admin = { Authorization: 'Bearer fixture-admin' }
let passed = 0
async function test(name, fn) { await fn(); ++passed; console.log('PASS ' + name) }
try {
  const db = await mf.getD1Database('IPQ_DB')
  await test('gateway forwards original routes and advertises extension without changing auth', async () => {
    assert.equal((await call('/admin')).status, 202)
    const config = await (await call('/api/config')).json()
    assert.equal(config.ip_quality_enabled, true); assert.equal(config.authorization, false)
    assert.match(await (await call('/ip-quality/install.sh')).text(), /engine_sha/)
  })
  await test('only same-origin administrators can generate node credentials', async () => {
    assert.equal((await call('/api/ip-quality/setup?id=node-a', { method: 'POST' })).status, 401)
    assert.equal((await call('/api/ip-quality/setup?id=node-a', { method: 'POST', headers: { ...admin, Origin: 'https://evil.example' } })).status, 403)
    assert.equal((await call('/api/ip-quality/setup?id=hidden', { method: 'POST', headers: admin })).status, 404)
  })
  const setupResponse = await call('/api/ip-quality/setup?id=node-a', { method: 'POST', headers: admin })
  assert.equal(setupResponse.status, 200)
  const setup = await setupResponse.json(), credential = { Authorization: 'Bearer ' + setup.token }
  const tokenHash = (await db.prepare('SELECT token_hash FROM ipq_credentials WHERE node_id=?').bind('node-a').first()).token_hash
  await test('credentials are node-scoped hashes and absent from commands and read responses', async () => {
    assert.equal(tokenHash, createHash('sha256').update(setup.token).digest('hex'))
    assert.ok(!setup.command.includes(setup.token))
    assert.equal((await call('/api/ip-quality/upload?id=node-b', { method: 'POST', headers: credential, body: '{}' })).status, 401)
    assert.equal((await call('/api/ip-quality/upload?id=node-a', { method: 'POST', body: '{}' })).status, 401)
    const read = await call('/api/ip-quality?id=node-a')
    assert.ok(!(await read.text()).includes(setup.token))
  })
  const report = { Head: { IP: '192.0.2.1', Time: new Date().toISOString(), Version: 'fixture', Command: 'private command' }, Info: { ASN: 'AS0', Map: 'private map' }, Score: { IPQS: 0 }, Factor: { Proxy: { IPQS: false } }, Media: { Netflix: { Status: 'Yes', Region: 'US' } } }
  const post = body => call('/api/ip-quality/upload?id=node-a', { method: 'POST', headers: credential, body: JSON.stringify(body) })
  await test('upload validates size, schema and address family before storing a report', async () => {
    assert.equal((await post({ family: 'v4', report: {} })).status, 400)
    assert.equal((await post({ family: 'v6', report })).status, 400)
    assert.equal((await post({ family: 'v4', report: { ...report, padding: 'x'.repeat(270000) } })).status, 413)
    assert.equal((await post({ family: 'v4', report })).status, 200)
    assert.equal((await post({ family: 'v4', report })).status, 429)
  })
  await test('reads keep zero/false, mask IP and strip commands; archives are date-addressable', async () => {
    const response = await call('/api/ip-quality?id=node-a'), data = await response.json()
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://theme.example')
    assert.equal(data.reports[0].Head.IP, '192.0.*.*')
    assert.equal(data.reports[0].Head.Command, undefined); assert.equal(data.reports[0].Info.Map, undefined)
    assert.equal(data.reports[0].Score.IPQS, 0); assert.equal(data.reports[0].Factor.Proxy.IPQS, false)
    assert.equal(data.archives.length, 1)
    assert.equal((await (await call('/api/ip-quality?id=node-a&date=' + data.archives[0].day)).json()).reports.length, 1)
    assert.equal((await call('/api/ip-quality?id=node-a&date=invalid')).status, 400)
  })
  await test('private, hidden and challenge-gated reports retain original access requirements', async () => {
    privateSite = true
    assert.equal((await call('/api/ip-quality?id=node-a')).status, 401)
    assert.equal((await call('/api/ip-quality?id=node-a', { headers: admin })).status, 200)
    privateSite = false; challenge = true
    assert.equal((await call('/api/ip-quality?id=node-a')).status, 403)
    assert.equal((await call('/api/ip-quality?id=node-a', { headers: { 'X-Turnstile-Verified': 'fixture-proof' } })).status, 200)
    challenge = false
    assert.equal((await call('/api/ip-quality?id=hidden')).status, 404)
  })
  await db.prepare('UPDATE ipq_status SET attempt_at=0 WHERE node_id=?').bind('node-a').run()
  await test('failed checks preserve the last success and report a separate failure status', async () => {
    assert.equal((await post({ family: 'v4', error: 'timeout' })).status, 200)
    const data = await (await call('/api/ip-quality?id=node-a')).json()
    assert.equal(data.reports.length, 1); assert.equal(data.states[0].error, 'timeout'); assert.ok(data.states[0].success_at > 0)
  })
  await test('credential rotation revokes the previous installer token', async () => {
    const next = await (await call('/api/ip-quality/setup?id=node-a', { method: 'POST', headers: admin })).json()
    assert.notEqual(next.token, setup.token)
    assert.equal((await post({ family: 'v6', error: 'no_route' })).status, 401)
  })
  await test('retention cleanup only deletes expired archives for the uploading node', async () => {
    const current = await (await call('/api/ip-quality/setup?id=node-b', { method: 'POST', headers: admin })).json()
    for (const node of ['node-a', 'node-b']) await db.prepare('INSERT INTO ipq_reports VALUES (?,?,?,?,?)').bind(node, '2020-01-01', 'v4', 1, JSON.stringify(report)).run()
    const response = await call('/api/ip-quality/upload?id=node-b', { method: 'POST', headers: { Authorization: 'Bearer ' + current.token }, body: JSON.stringify({ family: 'v4', report }) })
    assert.equal(response.status, 200)
    assert.ok(await db.prepare("SELECT 1 FROM ipq_reports WHERE node_id='node-a' AND day='2020-01-01'").first())
    assert.equal(await db.prepare("SELECT 1 FROM ipq_reports WHERE node_id='node-b' AND day='2020-01-01'").first(), null)
  })
  await test('service binding gateway preserves original WebSocket upgrades', async () => {
    const sockets = new Miniflare({ workers: [
      { name: 'gateway', modules: true, scriptPath: resolve('integrations/ip-quality/release/worker.js'), compatibilityDate: '2025-01-01', serviceBindings: { MONITOR: 'original' } },
      { name: 'original', modules: true, compatibilityDate: '2025-01-01', script: `export default { fetch(request) { const pair = new WebSocketPair(); pair[1].accept(); pair[1].addEventListener('message', event => pair[1].send(event.data)); return new Response(null, {status:101, webSocket:pair[0]}); } }` }
    ] })
    try {
      const response = await sockets.dispatchFetch('https://gateway.example/api/ws', { headers: { Upgrade: 'websocket' } })
      assert.equal(response.status, 101)
      const ws = response.webSocket; ws.accept()
      const received = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket relay timed out')), 3000)
        ws.addEventListener('message', event => { clearTimeout(timer); resolve(event.data) }, { once: true })
      })
      ws.send('original-metrics'); assert.equal(await received, 'original-metrics'); ws.close()
    } finally { await sockets.dispose() }
  })
  console.log(`All ${passed} gateway scenarios passed against local D1; no external IP probes ran.`)
} finally { await mf.dispose() }
