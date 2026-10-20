// Gateway extension: the existing CFSM Worker remains the authority for access.
// MONITOR is a Worker service binding, IPQ_DB is a separate D1 database.
import installer from './install.sh'
import collector from './collector.sh'

const MAX_BYTES = 256 * 1024
const json = (value, status = 200, source) => {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  for (const name of ['Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials', 'Vary']) if (source?.headers.get(name)) headers.set(name, source.headers.get(name))
  return new Response(JSON.stringify(value), { status, headers })
}
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('')
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('')
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f]/.test(value)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
let schemaReady
async function init(db) {
  if (!db) throw new Error('IPQ_DB binding is required')
  if (!schemaReady) schemaReady = db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS ipq_credentials (node_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS ipq_reports (node_id TEXT NOT NULL, day TEXT NOT NULL, family TEXT NOT NULL, received_at INTEGER NOT NULL, report TEXT NOT NULL, PRIMARY KEY(node_id,day,family))'),
    db.prepare('CREATE TABLE IF NOT EXISTS ipq_status (node_id TEXT NOT NULL, family TEXT NOT NULL, attempt_at INTEGER NOT NULL, success_at INTEGER, error TEXT, PRIMARY KEY(node_id,family))')
  ]).catch(error => { schemaReady = null; throw error })
  await schemaReady
}
async function upstream(request, env, path) {
  const url = new URL(path, request.url)
  return env.MONITOR.fetch(new Request(url, { method: 'GET', headers: request.headers, redirect: 'manual' }))
}
async function access(request, env, node, admin = false) {
  if (admin) {
    const response = await upstream(request, env, '/api/config')
    if (!response.ok) return { denied: response }
    const config = await response.json()
    if (config.authorization !== true) return { denied: json({ error: 'Administrator login required' }, 401, response) }
  }
  const response = await upstream(request, env, '/api/server?id=' + encodeURIComponent(node))
  if (!response.ok) return { denied: response }
  const server = await response.json()
  if (String(server.id) !== node) return { denied: json({ error: 'Node not found' }, 404, response) }
  return { response }
}
async function boundedJson(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) throw Object.assign(new Error('Report is too large'), { status: 413 })
  const reader = request.body?.getReader()
  if (!reader) throw Object.assign(new Error('JSON body required'), { status: 400 })
  let size = 0; const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) { await reader.cancel(); throw Object.assign(new Error('Report is too large'), { status: 413 }) }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }) }
}
function cleanReport(input, family, receivedAt) {
  if (!object(input) || !object(input.Head) || typeof input.Head.IP !== 'string' ||
      !['Info', 'Score', 'Factor', 'Media', 'Mail'].some(key => object(input[key]) && Object.keys(input[key]).length)) throw Object.assign(new Error('Invalid IPQuality report'), { status: 400 })
  const ip = input.Head.IP
  if (ip.length > 128 || (family === 'v4' ? !/^(\d{1,3}|\*)\.(\d{1,3}|\*)\.(\d{1,3}|\*)\.(\d{1,3}|\*)$/.test(ip) : !/^[0-9a-fA-F:*]+$/.test(ip) || !ip.includes(':'))) throw Object.assign(new Error('Report address family mismatch'), { status: 400 })
  const masked = family === 'v4' ? ip.split('.').slice(0, 2).join('.') + '.*.*' : ip.split(':').slice(0, 2).join(':') + ':*:*'
  // Whitelist report fields; never store commands, upload credentials or full IP.
  const captured = Date.parse(String(input.Head.Time || ''))
  if (!Number.isFinite(captured) || captured > receivedAt + 300000 || captured < receivedAt - 30 * 86400000) throw Object.assign(new Error('Report time is invalid or outside the 30-day archive window'), { status: 400 })
  const report = { Head: { IP: masked, Time: new Date(captured).toISOString(), Version: String(input.Head.Version || '').slice(0, 80), Family: family } }
  for (const key of ['Info', 'Type', 'Score', 'Factor', 'Media', 'Mail']) if (object(input[key])) report[key] = input[key]
  if (report.Info) { report.Info = { ...report.Info }; delete report.Info.Map }
  return report
}
const ERROR_CODES = new Set(['timeout', 'collector_failed', 'invalid_output', 'no_route', 'dependency_missing'])
async function upload(request, env, node) {
  await init(env.IPQ_DB)
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
  if (!token) return json({ error: 'Invalid report credential' }, 401)
  const credential = await env.IPQ_DB.prepare('SELECT token_hash FROM ipq_credentials WHERE node_id=?').bind(node).first()
  if (!credential || credential.token_hash !== await sha256(token)) return json({ error: 'Invalid report credential' }, 401)
  const body = await boundedJson(request)
  if (!['v4', 'v6'].includes(body.family)) return json({ error: 'family must be v4 or v6' }, 400)
  // Deletion/hidden-node visibility is checked at read time; upload tokens grant no read access.
  const now = Date.now(), family = body.family
  const previous = await env.IPQ_DB.prepare('SELECT attempt_at FROM ipq_status WHERE node_id=? AND family=?').bind(node, family).first()
  if (previous && now - previous.attempt_at < 30000) return json({ error: 'Please wait before uploading again' }, 429)
  if (body.report) {
    const report = cleanReport(body.report, family, now)
    const day = report.Head.Time.slice(0, 10), captured = Date.parse(report.Head.Time)
    await env.IPQ_DB.batch([
      env.IPQ_DB.prepare('INSERT INTO ipq_reports VALUES (?,?,?,?,?) ON CONFLICT(node_id,day,family) DO UPDATE SET received_at=excluded.received_at,report=excluded.report').bind(node, day, family, now, JSON.stringify(report)),
      env.IPQ_DB.prepare('INSERT INTO ipq_status VALUES (?,?,?,?,NULL) ON CONFLICT(node_id,family) DO UPDATE SET attempt_at=excluded.attempt_at,success_at=excluded.success_at,error=NULL').bind(node, family, now, captured),
      env.IPQ_DB.prepare('DELETE FROM ipq_reports WHERE node_id=? AND day<?').bind(node, new Date(now - 30 * 86400000).toISOString().slice(0, 10))
    ])
  } else {
    const code = ERROR_CODES.has(body.error) ? body.error : 'collector_failed'
    await env.IPQ_DB.prepare('INSERT INTO ipq_status VALUES (?,?,?,NULL,?) ON CONFLICT(node_id,family) DO UPDATE SET attempt_at=excluded.attempt_at,error=excluded.error').bind(node, family, now, code).run()
  }
  return json({ ok: true })
}
async function handle(request, env) {
  const url = new URL(request.url), path = url.pathname
  if (!env.MONITOR) return json({ error: 'Bind the existing CFSM Worker as MONITOR' }, 503)
  if (request.method === 'GET' && ['/ip-quality/install.sh', '/ip-quality/collector.sh'].includes(path)) return new Response(path.endsWith('/install.sh') ? installer : collector, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
  if (path === '/api/ip-quality' || path.startsWith('/api/ip-quality/')) {
    if (request.method === 'OPTIONS') return env.MONITOR.fetch(request)
    const node = url.searchParams.get('id')
    if (!validId(node)) return json({ error: 'Valid node id required' }, 400)
    if (path === '/api/ip-quality/upload' && request.method === 'POST') return upload(request, env, node)
    const setup = path === '/api/ip-quality/setup' && request.method === 'POST'
    if (!setup && !(path === '/api/ip-quality' && request.method === 'GET')) return json({ error: 'Not found' }, 404)
    if (setup && ((request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')) return json({ error: 'Use the gateway page to configure automatic checks' }, 403)
    const gate = await access(request, env, node, setup)
    if (gate.denied) return gate.denied
    await init(env.IPQ_DB)
    if (setup) {
      const token = randomToken()
      await env.IPQ_DB.prepare('INSERT INTO ipq_credentials VALUES (?,?,?) ON CONFLICT(node_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at').bind(node, await sha256(token), Date.now()).run()
      const base = url.origin
      return json({ token, command: `curl -fsSL ${quote(base + '/ip-quality/install.sh')} -o /tmp/cfsm-ipq-install.sh && sudo bash /tmp/cfsm-ipq-install.sh --url ${quote(base)} --node ${quote(node)}` }, 200, gate.response)
    }
    const day = url.searchParams.get('date')
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'Invalid archive date' }, 400, gate.response)
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    if (day && day < cutoff) return json({ error: 'Archive is outside the retention window' }, 400, gate.response)
    const db = env.IPQ_DB
    const [{ results: archives }, { results: states }, credential] = await Promise.all([
      db.prepare('SELECT day,family,received_at FROM ipq_reports WHERE node_id=? AND day>=? ORDER BY day DESC,family LIMIT 64').bind(node, cutoff).all(),
      db.prepare('SELECT family,attempt_at,success_at,error FROM ipq_status WHERE node_id=?').bind(node).all(),
      db.prepare('SELECT created_at FROM ipq_credentials WHERE node_id=?').bind(node).first()
    ])
    const query = day ? db.prepare('SELECT report FROM ipq_reports WHERE node_id=? AND day=? ORDER BY family').bind(node, day) : db.prepare('SELECT report FROM ipq_reports r WHERE node_id=? AND day>=? AND day=(SELECT MAX(day) FROM ipq_reports WHERE node_id=r.node_id AND family=r.family) ORDER BY family').bind(node, cutoff)
    const { results } = await query.all()
    return json({ reports: results.map(row => JSON.parse(row.report)), archives, states, configured: !!credential }, 200, gate.response)
  }
  const response = await env.MONITOR.fetch(request)
  if (path === '/api/config' && request.method === 'GET' && response.ok) {
    const value = await response.clone().json()
    return json({ ...value, ip_quality_enabled: !!env.IPQ_DB }, 200, response)
  }
  return response
}
export default { async fetch(request, env) {
  try { return await handle(request, env) }
  catch (error) { console.error('IP quality extension:', error.message); return json({ error: error.status ? error.message : 'IP quality service unavailable; check Worker bindings' }, error.status || 503) }
} }
