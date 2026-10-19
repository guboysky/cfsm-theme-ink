// Optional integration against an unmodified CF-Server-Monitor source checkout.
// Seeds an isolated local D1 binding directly; never touches an installed Worker.
import { createRequire } from 'node:module'
import { resolve, join, extname } from 'node:path'
import http from 'node:http'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

if (!process.env.CFSM_SOURCE) throw new Error('Set CFSM_SOURCE to an upstream checkout with npm dependencies installed')
const upstream = resolve(process.env.CFSM_SOURCE)
const requireUpstream = createRequire(join(upstream, 'package.json'))
const { Miniflare } = requireUpstream('miniflare')
const { build } = requireUpstream('esbuild')
const work = await mkdtemp(join(tmpdir(), 'cfsm-theme-integration-'))
const modulePath = relative => JSON.stringify(join(upstream, relative).replaceAll('\\', '/'))
const jwtSecret = 'local-theme-integration-secret-000000000000'
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64') .replace(/=/g, '')
const payload = Buffer.from(JSON.stringify({ sub: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64').replace(/=/g, '')
const jwt = `${header}.${payload}.${createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64').replace(/=/g, '')}`
const entryPath = join(work, 'entry.js')
const bundlePath = join(work, 'worker.mjs')
let targetOrigin = ''
const staticServer = http.createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? 'index.html' : req.url.split('?')[0].slice(1)
    if (path !== 'index.html' && !path.startsWith('assets/')) { res.writeHead(404); res.end(); return }
    let data = await readFile(resolve('dist', path))
    if (path === 'index.html') data = Buffer.from(data.toString().replace('name="apiBase" content=""', `name="apiBase" content="${targetOrigin}"`).replace('connect-src &#39;self&#39;', `connect-src &#39;self&#39; ${targetOrigin} ${targetOrigin.replace('http:', 'ws:')}`).replace('img-src &#39;self&#39;', `img-src &#39;self&#39; ${targetOrigin}`))
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream')
    res.end(data)
  } catch { res.writeHead(500); res.end() }
})
await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve))
const staticOrigin = `http://127.0.0.1:${staticServer.address().port}`
await writeFile(entryPath, `
import worker, { MetricsBroadcaster } from ${modulePath('src/index.js')};
import { initDatabase, saveMetricsHistory } from ${modulePath('src/database/schema.js')};
import { clearSiteSettingsCache } from ${modulePath('src/utils/settings.js')};
export { MetricsBroadcaster };
let seeded;
async function seed(env) {
  await initDatabase(env.DB);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").bind('site_options', JSON.stringify({
    is_public: env.TEST_PUBLIC, turnstile_enabled: env.TEST_TURNSTILE,
    turnstile_site_key: '1x00000000000000000000AA', turnstile_secret_key: '1x0000000000000000000000000000000AA',
    jwt_secret: ${JSON.stringify(jwtSecret)}, show_three_net_details: 'true', servers_optimized: 'true'
  })).run();
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").bind('appearance_options', JSON.stringify({site_title:'上游兼容性联测', preferred_theme:'light', default_language:'zh', custom_head:'<meta name="integration-head" content="applied">', custom_script:'window.integrationScript=true', custom_bg:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'})).run();
  clearSiteSettingsCache();
  await env.DB.prepare("INSERT INTO servers (id,name,region,history_partition_id,timestamp) VALUES (?,?,?,?,?)").bind('real-node','真实 Worker 测试节点','HK',1,Date.now()).run();
  for (let i=4;i>=0;i--) await saveMetricsHistory(env.DB,'real-node',1,{cpu:21+i,ram_total:8192,ram_used:2048,swap_total:1024,swap_used:0,disk_total:102400,disk_used:20480,net_in_speed:1024,net_out_speed:512,ip_v4:'1',ping_ct:0,loss_ct:0,gpu_info:[{id:'0',name:'Test GPU',info:0}]},'HK',Date.now()-i*60000);
}
export default { async fetch(request,env,ctx) { await (seeded ||= seed(env)); if (['/assets/','/flags/','/os-icons/'].some(prefix => new URL(request.url).pathname.startsWith(prefix))) return env.ASSETS.fetch(request); return worker.fetch(request,env,ctx); } };
`)
await build({ entryPoints: [entryPath], outfile: bundlePath, bundle: true, format: 'esm', platform: 'browser', external: ['node:*', 'cloudflare:*'], logLevel: 'silent' })
const browser = await chromium.launch({ headless: true })
await mkdir('test-results', { recursive: true })
let failures = 0
try {
  for (const isPublic of [true, false]) for (const turnstile of [false, true]) {
    const label = `${isPublic ? 'public' : 'private'}-${turnstile ? 'on' : 'off'}`
    const mf = new Miniflare({
      modules: true, scriptPath: bundlePath, compatibilityDate: '2024-12-01', compatibilityFlags: ['nodejs_compat'],
      d1Databases: ['DB'], durableObjects: { METRICS_BROADCASTER: { className: 'MetricsBroadcaster', useSQLite: true } },
      bindings: { TEST_PUBLIC: String(isPublic), TEST_TURNSTILE: String(turnstile), API_SECRET: 'local-test-api-secret', CORS_ALLOWED_ORIGINS: staticOrigin },
      serviceBindings: { ASSETS: async request => {
        const url = new URL(request.url)
        let path = url.pathname.slice(1)
        if (path === 'dashboard.html') path = 'index.html'
        try {
          const data = await readFile(path.startsWith('flags/') || path.startsWith('os-icons/') ? resolve(upstream, 'public', path) : resolve('dist', path))
          return new Response(data, { headers: { 'Content-Type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream' } })
        } catch { return new Response('Not found', { status: 404 }) }
      } }
    })
    let context
    try {
      const origin = (await mf.ready).origin
      targetOrigin = origin
      context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
      if (!isPublic) {
        await context.addCookies([{ name: 'cfsm_auth', value: jwt, url: origin }])
        await context.addInitScript(token => localStorage.setItem('jwt_token', token), jwt)
      }
      const page = await context.newPage(), errors = [], requests = [], messages = []
      page.on('pageerror', e => errors.push(e.message))
      page.on('response', r => { if (new URL(r.url()).pathname.startsWith('/api/')) requests.push({ path: new URL(r.url()).pathname, status: r.status() }) })
      page.on('websocket', ws => ws.on('framereceived', e => { try { messages.push(JSON.parse(e.payload)) } catch {} }))
      await page.goto(origin)
      await page.locator('.server-card').first().waitFor({ timeout: 30000 })
      assert.equal(await page.locator('meta[name="integration-head"]').count(), 1, 'backend custom head injection')
      assert.equal(await page.evaluate(() => window.integrationScript), true, 'backend custom script injection')
      const bindings = await mf.getBindings()
      const stub = bindings.METRICS_BROADCASTER.get(bindings.METRICS_BROADCASTER.idFromName('global'))
      await page.waitForTimeout(300)
      await stub.fetch('http://internal/push/real-node', { method: 'POST', body: JSON.stringify({ cpu: 47.2, ram_used: 3072, timestamp: Date.now() }) })
      await page.waitForTimeout(1300)
      assert.ok(messages.some(m => m.type === 'batchUpdate'), 'real Durable Object must push batchUpdate')
      assert.match(await page.locator('.server-card').innerText(), /47.2%/)
      await page.locator('.server-card').click(); await page.getByRole('tab', { name: '机器信息', exact: true }).click(); await page.locator('.machine-overview').waitFor()
      assert.ok(requests.some(r => r.path === '/api/history/all' && r.status === 200))
      assert.deepEqual(errors, [])
      assert.ok(requests.every(r => r.status === 200), JSON.stringify(requests))
      assert.equal(requests.filter(r => r.path === '/api/config').length, turnstile ? 2 : 1)
      if (turnstile) {
        await page.reload(); await page.getByRole('tab', { name: '机器信息', exact: true }).click(); await page.locator('.machine-overview').waitFor()
        assert.equal(requests.filter(r => r.path === '/api/config').length, 3)
        assert.equal(await page.locator('.overlay').count(), 0)
      }
      await page.screenshot({ path: `test-results/upstream-${label}.png`, fullPage: true })
      console.log(`PASS real upstream ${label}: D1, JWT/Cookie, ${turnstile ? 'Cloudflare test widget + Siteverify + encrypted proof, ' : ''}DO WebSocket, history, head/script`)
      if (!isPublic) {
        const cross = await browser.newContext()
        try {
          await cross.addInitScript(token => localStorage.setItem('jwt_token', token), jwt)
          const tab = await cross.newPage(), crossMessages = [], crossSockets = []
          tab.on('websocket', ws => { crossSockets.push(ws.url()); ws.on('framereceived', e => { try { crossMessages.push(JSON.parse(e.payload)) } catch {} }) })
          await tab.goto(staticOrigin); await tab.locator('.server-card').first().waitFor({ timeout: 30000 })
          await tab.waitForTimeout(300)
          await stub.fetch('http://internal/push/real-node', { method: 'POST', body: JSON.stringify({ cpu: 38.6, timestamp: Date.now() }) })
          await tab.waitForTimeout(1300)
          assert.ok(crossSockets.every(url => new URL(url).searchParams.get('token') === jwt))
          assert.ok(crossMessages.some(m => m.type === 'batchUpdate'), 'cross-origin JWT subscription must receive real updates')
          assert.match(await tab.locator('.server-card').innerText(), /38.6%/)
          console.log(`PASS real upstream ${label}: cross-origin CORS + JWT query WebSocket`)
        } finally { await cross.close() }
      }
    } catch (error) { failures++; console.error(`FAIL real upstream ${label}: ${error.stack}`); if (context?.pages()[0]) console.error((await context.pages()[0].locator('body').innerText()).slice(0, 3000)) }
    finally { await context?.close(); await mf.dispose() }
  }
} finally { await browser.close(); await new Promise(resolve => staticServer.close(resolve)) }
if (failures) process.exitCode = 1
