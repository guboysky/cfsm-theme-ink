import http from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { WebSocketServer } from 'ws'

const logs = new Map(), socketLogs = [], allSockets = new Set()
const firstPort = Number(process.env.TEST_PORT || 4325)
const ports = [firstPort, firstPort + 1]
const origin = `http://127.0.0.1:${ports[0]}`
const secondOrigin = `http://127.0.0.1:${ports[1]}`
const sessions = new Map()
const cookie = (req, name) => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1) || ''
const now = () => Date.now()
function fixture(id = 'node-a', name = '香港 · 边缘节点 01') {
  // Different counters and speeds make the demo rankings meaningful.
  const multiplier = 1 + (id.charCodeAt(id.length - 1) % 7)
  const expiry = ({ 'node-a': '2026-11-01', 'node-c': '2026-10-27', 'node-d': '2026-11-08', 'node-e': '2026-11-14', 'node-f': '' })[id] ?? '2026-12-31'
  return { id, name, server_group: '生产环境', tags: 'Edge,Premium', region: 'HK', os: 'Ubuntu 24.04', arch: 'x86_64', cpu_cores: 4, cpu_info: 'Intel Xeon Platinum 8375C', ram_total: 8192, ram_used: 2540, swap_total: 2048, swap_used: 0, disk_total: 102400, disk_used: 28000, cpu: 23.5, net_in_speed: 1240000, net_out_speed: 420000, net_rx: 12600000000 * multiplier, net_tx: 896000000 * multiplier, ping_ct: 0, ping_cu: null, ping_cm: false, loss_ct: 0, loss_cu: null, ip_v4: '1', ip_v6: '0', is_hidden: '0', auto_renewal: '0', price: '0', billing_cycle: 'month', expire_date: expiry, boot_time: String(now() - (7 * 24 + 23) * 3600000), load_avg: '0.00 0.20 0.10', traffic_limit: id === 'node-a' ? '0' : '1024', traffic_calc_type: 'total', net_rx_monthly: 1024 ** 3 * multiplier, net_tx_monthly: 1024 ** 3, processes: 85, tcp_conn: 61, udp_conn: 8, gpu_info: '[{"id":"0","name":"NVIDIA RTX 3060","info":0}]', last_updated: now(), timestamp: now(), ping: Array.from({ length: 8 }, (_, i) => ({ ts: now() - (8 - i) * 60000, ct: 0, cu: null, cm: false, bd: 30 + i * 4 })), loss: Array.from({ length: 8 }, (_, i) => ({ ts: now() - (8 - i) * 60000, ct: 0, cu: null, cm: false, bd: 0 })) }
}
function history(id = 'node-a') {
  return Array.from({ length: 24 }, (_, i) => ({ ...fixture(id), timestamp: now() - (24 - i) * 25000, net_rx: fixture(id).net_rx - (24 - i) * 500000, net_tx: fixture(id).net_tx - (24 - i) * 150000, cpu: 15 + (i % 7) * 4, ram_used: 2200 + i * 13, net_in_speed: 800000 + i * 20000, net_out_speed: 300000 + (i % 5) * 40000, gpu_info: '[{"id":"0","name":"NVIDIA RTX 3060","info":0}]' }))
}
const servers = await Promise.all(ports.map(async (port, backend) => {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      const sessionId = cookie(req, 'session') || 'preview'
      const scenario = cookie(req, 'scenario') || 'public-off'
      const key = `${sessionId}:${backend}`
      if (!logs.has(key)) logs.set(key, [])
      const enabled = scenario.includes('on')
      const isPublic = !scenario.includes('private')
      const authenticated = req.headers.authorization === 'Bearer fixture-jwt' || cookie(req, 'cfsm_auth') === 'fixture-jwt'
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Turnstile-Token, X-Turnstile-Verified')
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
      if (url.pathname.startsWith('/api/')) {
        logs.get(key).push({ path: url.pathname, search: url.search, headers: req.headers, method: req.method })
        res.setHeader('Content-Type', 'application/json')
        const json = (data, status = 200) => { res.writeHead(status); res.end(JSON.stringify(data)) }
        if (url.pathname === '/api/config') return json({ is_public: isPublic, authorization: authenticated, turnstile_enabled: enabled, turnstile_site_key: 'fixture-key', turnstile_verified: req.headers['x-turnstile-token'] === 'fixture-token' ? `proof-${backend}` : null, version: '2.7.12 Beta', preferred_theme: scenario.includes('dark') ? 'dark' : 'light', default_language: scenario.includes('english') ? 'en' : 'zh', site_title: '云端探针', frontend_ws_timeout_minutes: scenario.includes('expiry') ? 0.01 : 0, custom_ct_name: '电信精品', custom_cu_name: '联通', theme_options: {} })
        if (!isPublic && !authenticated) return json({ error: 'Unauthorized' }, 401)
        if (enabled && req.headers['x-turnstile-verified'] !== `proof-${backend}`) return json({ error: 'Forbidden' }, 403)
        if (scenario.includes('always403')) return json({ error: 'Forbidden permanently' }, 403)
        if (scenario.includes('forbidden') && !sessions.has(key)) { sessions.set(key, true); return json({ error: 'Forbidden once' }, 403) }
        if (scenario.includes('unauthorized') && url.pathname === '/api/servers') return json({ error: 'Unauthorized once' }, 401)
        if (url.pathname === '/api/servers') {
          const items = backend ? [fixture('node-b', '东京 · 中转节点 02')] : [fixture(), { ...fixture('node-c', '新加坡 · 计算节点 02'), server_group: '生产环境', region: 'SG', cpu: 45 }, { ...fixture('node-d', '洛杉矶 · 备用节点 03'), server_group: '备用节点', region: 'US', cpu: 0, last_updated: now() - 600000 }, { ...fixture('node-e', '东京 · 应用节点 04'), region: 'JP', cpu: 61 }, { ...fixture('node-f', '法兰克福 · 存储节点 05'), server_group: '存储节点', region: 'DE', cpu: 15 }, { ...fixture('node-g', '上海 · 入口节点 06'), region: 'CN', cpu: 38 }]
          // Extra preview-only examples fill the two requested expiry rows.
          if (!backend && (sessionId === 'preview' || scenario.includes('preview-seven'))) items.push(
            { ...fixture('node-h', '香港 · 备份节点 07'), region: 'HK', expire_date: '2027-01-07' },
            { ...fixture('node-i', '德国 · 应用节点 08'), region: 'DE', expire_date: '2027-02-01' }
          )
          return json({ servers: items, stats: { total: items.length, online: items.length - (backend ? 0 : 1), offline: backend ? 0 : 1, globalSpeedIn: 5000000, globalSpeedOut: 2000000 }, sysConfig: { show_three_net_details: !scenario.includes('nocharts'), show_price: true, show_expire: !scenario.includes('noexpiry'), show_tf: !scenario.includes('notraffic') } })
        }
        if (url.pathname === '/api/server') return json({ ...fixture(url.searchParams.get('id')), sysConfig: { show_price: true, show_expire: !scenario.includes('noexpiry'), show_tf: true } })
        if (url.pathname === '/api/history/all') return json(history(url.searchParams.get('id')))
        if (url.pathname === '/api/theme_options' && req.method === 'POST') {
          if (!authenticated) return json({ error: 'Unauthorized' }, 401)
          let body = ''; for await (const chunk of req) body += chunk
          return json({ success: true, theme_options: JSON.parse(body).theme_options })
        }
        return json({ error: 'Unexpected API request' }, 500)
      }
      if (url.pathname === '/admin') { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Built-in admin fixture</h1>'); return }
      if (url.pathname.startsWith('/flags/') || url.pathname.startsWith('/os-icons/')) {
        const allowed = new Set(['/flags/hk.svg', '/flags/sg.svg', '/flags/us.svg', '/flags/jp.svg', '/flags/de.svg', '/flags/cn.svg', '/os-icons/os-ubuntu.svg', '/os-icons/os-windows.svg'])
        if (!allowed.has(url.pathname)) { res.writeHead(404); res.end('Unknown fixture asset'); return }
        res.setHeader('Content-Type', 'image/svg+xml')
        res.end(await readFile(resolve('tests/fixtures/default-assets', url.pathname.slice(1))))
        return
      }
      const path = url.pathname === '/' || url.pathname === '/index.html' ? 'index.html' : decodeURIComponent(url.pathname).slice(1)
      if (path.includes('..') || (path !== 'index.html' && !path.startsWith('assets/'))) { res.writeHead(404); res.end(); return }
      let data = await readFile(resolve('dist', path))
      if (path === 'index.html' && scenario.includes('multi')) data = Buffer.from(data.toString().replace('name="apiBase" content=""', `name="apiBase" content="${origin},${secondOrigin}"`).replace('connect-src &#39;self&#39;', `connect-src &#39;self&#39; ${origin} ${secondOrigin} ${origin.replace('http:', 'ws:')} ${secondOrigin.replace('http:', 'ws:')}`).replace('img-src &#39;self&#39;', `img-src &#39;self&#39; ${secondOrigin}`))
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream')
      res.end(data)
    } catch (error) { res.writeHead(500); res.end(error.message) }
  })
  const wss = new WebSocketServer({ server, path: '/api/ws' })
  wss.on('connection', (ws, req) => {
    allSockets.add(ws)
    const url = new URL(req.url, origin)
    const entry = { backend, session: cookie(req, 'session'), subscribe: url.searchParams.get('subscribe'), token: url.searchParams.get('token'), ids: null, closed: false }
    ws.fixtureSession = entry.session
    socketLogs.push(entry)
    let timer, tick = 0
    const counters = new Map()
    ws.on('message', raw => { const data = JSON.parse(raw); if (data.type === 'subscribe') entry.ids = data.ids })
    function push() {
      if (ws.readyState !== 1) return
      const ids = entry.subscribe === 'all' ? entry.ids || [] : [entry.subscribe]
      ws.send(JSON.stringify({ type: 'batchUpdate', updates: ids.map(id => {
        const factor = 1 + id.charCodeAt(id.length - 1) % 7
        const down = 260000 * factor + tick % 5 * 70000, up = 85000 * factor + tick % 3 * 30000
        const previous = counters.get(id) || { rx: 12600000000 * factor, tx: 896000000 * factor }
        const next = { rx: previous.rx + down * 0.12, tx: previous.tx + up * 0.12 }
        counters.set(id, next)
        return { serverId: id, samples: [{ ts: now(), data: { cpu: 25 + tick++ % 8, ram_used: 2700, net_in_speed: down, net_out_speed: up, net_rx: Math.round(next.rx), net_tx: Math.round(next.tx) } }] }
      }) }))
      timer = setTimeout(push, 120)
    }
    timer = setTimeout(push, 150)
    ws.on('close', () => { clearTimeout(timer); entry.closed = true; allSockets.delete(ws) })
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  return { server, wss }
}))

if (process.argv.includes('--serve')) {
  console.log(`Fixture preview: ${origin} (isolated sample data only)`)
  await new Promise(() => {})
}
await mkdir('test-results', { recursive: true })
const browser = await chromium.launch({ headless: true })
const failures = []
let serial = 0
let passed = 0
async function contextFor(scenario, authenticated = false) {
  const session = `test-${++serial}`
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  await context.addCookies([{ name: 'session', value: session, url: origin }, { name: 'scenario', value: scenario, url: origin }, ...(authenticated ? [{ name: 'cfsm_auth', value: 'fixture-jwt', url: origin }] : [])])
  if (authenticated) await context.addInitScript(() => { if (!sessionStorage.getItem('fixture-initialized')) { localStorage.setItem('jwt_token', 'fixture-jwt'); sessionStorage.setItem('fixture-initialized', '1') } })
  await context.route('https://challenges.cloudflare.com/**', route => route.fulfill({ contentType: 'application/javascript', body: 'window.turnstile={render(el,opts){el.textContent="Fixture verification";setTimeout(()=>opts.callback("fixture-token"),20);return "fixture"},remove(){},reset(){}}' }))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('403') && !message.text().includes('401')) errors.push(message.text()) })
  return { context, page, session, errors, log: backend => logs.get(`${session}:${backend || 0}`) || [], sockets: () => socketLogs.filter(s => s.session === session) }
}
const waitFor = async predicate => { for (let i = 0; i < 80; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)) } assert.fail('Timed out waiting for fixture condition') }
async function test(name, run) { try { await run(); passed++; console.log(`PASS ${name}`) } catch (error) { failures.push({ name, error }); console.error(`FAIL ${name}: ${error.stack}`) } }
const detailHistoryCount = entry => entry.log().filter(row => row.path === '/api/history/all' && new URLSearchParams(row.search).get('hours') !== '0.167').length
const count = (entry, path) => entry.log().filter(r => r.path === path).length
const visible = (page, hidden) => page.evaluate(value => { Object.defineProperty(document, 'hidden', { configurable: true, value }); document.dispatchEvent(new Event('visibilitychange')) }, hidden)

try {
  for (const scenario of ['public-off', 'public-on', 'private-off', 'private-on']) await test(`${scenario}: auth, REST counts, detail, history, visibility`, async () => {
    const entry = await contextFor(scenario, scenario.includes('private'))
    const { page, context } = entry
    try {
      await page.goto(origin)
      await page.locator('.server-card').first().waitFor()
      await waitFor(() => entry.sockets().some(s => s.ids?.length === 6))
      await page.waitForTimeout(1300)
      assert.equal(count(entry, '/api/config'), scenario.includes('on') ? 2 : 1)
      assert.equal(count(entry, '/api/servers'), 1)
      assert.equal(detailHistoryCount(entry), 0)
      const serverReq = entry.log().find(r => r.path === '/api/servers')
      assert.equal(serverReq.headers['x-turnstile-verified'], scenario.includes('on') ? 'proof-0' : undefined)
      assert.equal(entry.sockets()[0].token, null, 'same-origin WS must use cookies')
      await page.locator('.server-card').first().click()
      await page.locator('.detail-view-switch').waitFor(); await page.getByRole('tab', { name: '机器信息', exact: true }).click()
      assert.equal(entry.sockets().length, 1, 'modal reuses homepage socket'); assert.equal(entry.sockets()[0].subscribe, 'all')
      assert.equal(count(entry, '/api/servers'), 1)
      assert.equal(detailHistoryCount(entry), 1)
      assert.match(entry.log().find(r => r.path === '/api/history/all' && new URLSearchParams(r.search).get('hours') === '24').search, /hours=24/)
      assert.equal(await page.getByRole('heading', { name: '磁盘 IO', exact: true }).count(), 0)
      assert.match(await page.locator('.charts-grid').innerText(), /超时/)
      assert.equal(await page.getByRole('heading', { name: 'GPU 使用率' }).count(), 1)
      await page.getByLabel('历史时间范围').selectOption('0.5')
      await waitFor(() => detailHistoryCount(entry) === 2)
      await visible(page, true)
      await waitFor(() => entry.sockets().every(s => s.closed))
      const beforeRestore = count(entry, '/api/server')
      await visible(page, false)
      await waitFor(() => count(entry, '/api/server') === beforeRestore + 1)
      await waitFor(() => entry.sockets().filter(s => s.subscribe === 'all').length === 2)
      assert.equal(detailHistoryCount(entry), 2, 'visibility must not refresh history')
      await page.locator('.back-link').click()
      await page.locator('.server-card').first().waitFor()
      assert.equal(count(entry, '/api/servers'), 1, 'route return must reuse the list')
      await visible(page, true); await visible(page, false)
      await waitFor(() => count(entry, '/api/servers') === 2)
      assert.equal(count(entry, '/api/config'), scenario.includes('on') ? 2 : 1)
      if (scenario.includes('on')) {
        await page.reload(); await page.locator('.server-card').first().waitFor()
        assert.equal(count(entry, '/api/config'), 3, 'reload should bootstrap config without another exchange')
        assert.equal(await page.locator('.overlay').count(), 0)
      }
      assert.deepEqual(entry.errors, [])
    } finally { await context.close() }
  })
  await test('private unauthenticated: redirects once to built-in admin', async () => {
    const entry = await contextFor('private-off')
    await entry.page.goto(origin)
    await entry.page.waitForURL('**/admin#/admin')
    assert.equal(count(entry, '/api/config'), 1); assert.equal(count(entry, '/api/servers'), 0)
    await entry.context.close()
  })
  await test('401 clears JWT without refresh loops', async () => {
    const entry = await contextFor('private-off-unauthorized', true)
    await entry.page.goto(origin); await entry.page.waitForURL('**/admin#/admin')
    assert.equal(await entry.page.evaluate(() => localStorage.getItem('jwt_token')), null)
    assert.equal(count(entry, '/api/servers'), 1); await entry.context.close()
  })
  await test('403 clears proof and re-verifies with one bounded retry', async () => {
    const entry = await contextFor('public-on-forbidden')
    await entry.page.goto(origin); await entry.page.locator('.server-card').first().waitFor()
    assert.equal(count(entry, '/api/servers'), 2)
    assert.equal(count(entry, '/api/config'), 3)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('persistent 403 stops after one retry and exposes the error', async () => {
    const entry = await contextFor('public-on-always403')
    await entry.page.goto(origin); await entry.page.locator('.notice').filter({ hasText: 'Forbidden permanently' }).waitFor()
    await entry.page.waitForTimeout(600)
    assert.equal(count(entry, '/api/servers'), 2)
    assert.equal(count(entry, '/api/config'), 3)
    assert.equal(entry.sockets().length, 0)
    assert.equal(await entry.page.locator('.overlay').count(), 0)
    await entry.context.close()
  })
  await test('multi-backend: ids and proofs remain isolated; cross-origin JWT uses query', async () => {
    const entry = await contextFor('private-on-multi', true)
    await entry.page.goto(origin); await entry.page.locator('.server-card').first().waitFor()
    await waitFor(() => entry.sockets().filter(s => s.ids).length === 2)
    assert.deepEqual(entry.sockets().find(s => s.backend === 0).ids, ['node-a', 'node-c', 'node-d', 'node-e', 'node-f', 'node-g'])
    assert.deepEqual(entry.sockets().find(s => s.backend === 1).ids, ['node-b'])
    assert.equal(entry.sockets().find(s => s.backend === 1).token, 'fixture-jwt')
    assert.equal(entry.log(1).find(r => r.path === '/api/servers').headers['x-turnstile-verified'], 'proof-1')
    await entry.page.locator('.server-card').last().click(); await entry.page.locator('.detail-view-switch').waitFor(); await entry.page.getByRole('tab', { name: '机器信息', exact: true }).click()
    assert.equal(entry.log(1).filter(r => r.path === '/api/server').length, 1)
    assert.equal(count(entry, '/api/server'), 0)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('expiry survives visibility until the user explicitly continues', async () => {
    const entry = await contextFor('public-off-expiry')
    await entry.page.goto(origin); await entry.page.getByRole('button', { name: '继续实时更新' }).waitFor()
    const connections = entry.sockets().length, requests = count(entry, '/api/servers')
    await visible(entry.page, true); await visible(entry.page, false); await entry.page.waitForTimeout(300)
    assert.equal(entry.sockets().length, connections); assert.equal(count(entry, '/api/servers'), requests)
    await entry.page.getByRole('button', { name: '继续', exact: true }).click()
    await waitFor(() => entry.sockets().length === connections + 1)
    assert.equal(count(entry, '/api/servers'), requests + 1, 'explicit continue after hiding refreshes current REST before reconnecting')
    await entry.context.close()
  })
  await test('search, group, status, table view and server-backed preferences', async () => {
    const entry = await contextFor('private-off', true), { page } = entry
    await page.goto(origin); await page.locator('.server-card').first().waitFor()
    await page.getByLabel('搜索服务器').fill('香港'); assert.equal(await page.locator('.server-card').count(), 1)
    await page.getByRole('button', { name: '清空搜索' }).click()
    await page.getByLabel('状态筛选').selectOption('offline'); assert.equal(await page.locator('.server-card').count(), 1)
    await page.getByLabel('状态筛选').selectOption('')
    await page.getByLabel('分组筛选').selectOption('存储节点'); assert.equal(await page.locator('.server-card').count(), 1)
    await page.getByLabel('分组筛选').selectOption('')
    await page.getByLabel('表格视图', { exact: true }).click(); assert.equal(await page.locator('.servers-panel tbody tr').count(), 6)
    assert.equal(await page.getByRole('button', { name: '显示设置' }).count(), 0)
    assert.equal(count(entry, '/api/theme_options'), 0)
    const listRequests = count(entry, '/api/servers')
    for (const ws of allSockets) if (ws.fixtureSession === entry.session) ws.close(1008)
    await page.getByRole('button', { name: '重新连接' }).waitFor()
    const connections = entry.sockets().length
    await page.getByRole('button', { name: '重新连接' }).click()
    await waitFor(() => entry.sockets().length === connections + 1)
    assert.equal(count(entry, '/api/servers'), listRequests, 'manual reconnection must not fetch the list')
    await entry.context.close()
  })
  await test('direct detail loads no list and uses only one server subscription', async () => {
    const entry = await contextFor('public-off')
    await entry.page.goto(`${origin}/#/server/node-a`); await entry.page.locator('.detail-view-switch').waitFor(); await entry.page.getByRole('tab', { name: '机器信息', exact: true }).click()
    assert.equal(count(entry, '/api/servers'), 0); assert.equal(count(entry, '/api/server'), 1)
    assert.equal(detailHistoryCount(entry), 1)
    await waitFor(() => entry.sockets().length === 1)
    assert.equal(entry.sockets()[0].subscribe, 'node-a')
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('initial history survives hiding and restoring during its in-flight request', async () => {
    const entry = await contextFor('public-off')
    let release, markSeen
    const gate = new Promise(resolve => { release = resolve })
    const seen = new Promise(resolve => { markSeen = resolve })
    await entry.page.route('**/api/history/all?**', async route => { markSeen(); await gate; await route.continue() })
    await entry.page.goto(`${origin}/#/server/node-a`)
    await seen
    await visible(entry.page, true); await visible(entry.page, false)
    await entry.page.locator('.detail-view-switch').waitFor(); await entry.page.getByRole('tab', { name: '机器信息', exact: true }).click()
    release()
    await entry.page.locator('.chart-panel').filter({ hasText: 'GPU 使用率' }).waitFor()
    assert.equal(detailHistoryCount(entry), 1)
    assert.equal(count(entry, '/api/server'), 2)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('visual layouts: desktop, phone, dark and detail', async () => {
    const entry = await contextFor('public-off-preview-seven'), { page } = entry
    await page.goto(origin); await page.locator('.server-card').first().waitFor()
    await page.getByRole('img', { name: '近 10 分钟流量柱状图' }).waitFor()
    await page.waitForTimeout(1100)
    for (const width of [1440, 1200, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 }); await page.screenshot({ path: `test-results/dashboard-${width}.png`, fullPage: true })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `horizontal overflow at ${width}`)
    }
    await page.getByLabel('切换明暗主题').click(); await page.screenshot({ path: 'test-results/dashboard-dark-320.png', fullPage: true })
    await page.locator('.server-card').first().click(); await page.locator('.detail-view-switch').waitFor(); await page.getByRole('tab', { name: '机器信息', exact: true }).click(); await page.screenshot({ path: 'test-results/detail-dark-320.png' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.locator('.back-link').click(); await page.setViewportSize({ width: 1440, height: 1100 }); await page.getByLabel('切换明暗主题').click(); await page.locator('.card-popup-button').first().click(); await page.locator('.detail-view-switch').waitFor(); await page.getByRole('tab', { name: '机器信息', exact: true }).click(); await page.screenshot({ path: 'test-results/detail-1440.png' })
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('disabled three-net details never fetch or render mini charts', async () => {
    const entry = await contextFor('public-off-nocharts')
    await entry.page.goto(origin); await entry.page.locator('.server-card').first().waitFor()
    assert.equal(await entry.page.locator('.card-charts').count(), 0); assert.equal(detailHistoryCount(entry), 0)
    await entry.context.close()
  })
  await test('backend language and preferred theme drive the UI', async () => {
    const entry = await contextFor('public-off-english-dark')
    await entry.page.goto(origin); await entry.page.getByRole('heading', { name: 'Expiration ranking' }).waitFor()
    assert.equal(await entry.page.locator('html').getAttribute('lang'), 'en')
    assert.equal(await entry.page.locator('html').getAttribute('data-theme'), 'dark')
    await entry.context.close()
  })
  await test('fixed ten-minute traffic history loads once and filters without refetching', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); await page.locator('.server-card').first().waitFor()
    assert.equal(await page.locator('.page-heading').count(), 0)
    assert.equal(await page.locator('.servers-panel > .section-heading').count(), 0)
    assert.equal(await page.locator('.filterbar .segmented').count(), 1)
    assert.ok((await page.locator('.summary-card').first().boundingBox()).height <= 90)
    await page.getByRole('img', { name: '近 10 分钟流量柱状图' }).waitFor()
    await page.getByRole('heading', { name: '节点流量排行' }).waitFor()
    await waitFor(() => count(entry, '/api/history/all') === 6)
    await page.getByRole('heading', { name: '节点实时排行' }).waitFor()
    await page.getByRole('heading', { name: '流量分布' }).waitFor()
    const summaryBox = await page.locator('.summary-grid').boundingBox(), insightsBox = await page.locator('.traffic-insights').boundingBox(), filterBox = await page.locator('.filterbar').boundingBox()
    assert.ok(insightsBox.y >= summaryBox.y + summaryBox.height)
    assert.ok(filterBox.y >= insightsBox.y + insightsBox.height)
    await page.getByLabel('图表节点').selectOption(`${origin}:node-a`)
    await page.getByLabel('流量方向').selectOption('up')
    assert.equal(await page.getByLabel('会话时间范围').count(), 0)
    assert.equal(await page.locator('.traffic-timeline>span').count(), 6)
    await page.getByLabel('实时排行指标').selectOption('net_out_speed')
    await page.getByText('采样明细', { exact: true }).click()
    assert.ok(await page.locator('.traffic-detail-scroll tbody tr').count() > 0)
    assert.equal(detailHistoryCount(entry), 0)
    assert.equal(count(entry, '/api/history/all'), 6, 'one initial ten-minute history per node; filters never refetch')
    assert.equal(count(entry, '/api/servers'), 1)
    assert.equal(count(entry, '/api/config'), 1)
    assert.deepEqual(entry.errors, [])
    await entry.context.close()
  })
  await test('fixed traffic chart exists from history before any WebSocket samples', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.addInitScript(() => {
      window.WebSocket = class {
        constructor() { this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen?.({}) }, 0) }
        send() {}
        close() { this.readyState = 3 }
      }
    })
    await page.goto(origin)
    await page.getByRole('img', { name: '近 10 分钟流量柱状图' }).waitFor()
    await waitFor(() => count(entry, '/api/history/all') === 6)
    assert.ok(await page.locator('.traffic-bar-plot rect').count() > 10)
    assert.equal(entry.sockets().length, 0, 'chart must be available before live reports')
    const stamps = await page.locator('.traffic-timeline>span').allTextContents()
    const seconds = stamp => stamp.split(':').reduce((sum, value) => sum * 60 + Number(value), 0)
    assert.equal((seconds(stamps.at(-1)) - seconds(stamps[0]) + 86400) % 86400, 600)
    assert.equal(stamps.length, 6)
    assert.doesNotMatch(await page.locator('.traffic-trend').innerText(), /本次会话|仅记录本次/)
    assert.equal(await page.locator('.rank-footer').count(), 0)
    await page.getByLabel('流量方向').selectOption('up')
    await page.getByLabel('图表节点').selectOption(origin + ':node-a')
    await page.waitForTimeout(1300)
    assert.equal(count(entry, '/api/history/all'), 6)
    assert.equal(count(entry, '/api/servers'), 1)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('site traffic switch hides counter charts and distribution', async () => {
    const entry = await contextFor('public-off-notraffic'), { page } = entry
    await page.goto(origin); await page.locator('.server-card').first().waitFor()
    assert.equal(await page.locator('.traffic-trend').count(), 0)
    assert.equal(await page.locator('.flow-panel').count(), 0)
    assert.equal(await page.getByRole('heading', { name: '节点流量排行' }).count(), 0)
    assert.equal(await page.getByRole('heading', { name: '到期时间排行榜' }).count(), 1)
    assert.equal(detailHistoryCount(entry), 0)
    await entry.context.close()
  })
  await test('reference cards show true resource values, tri-state segments and expiry badges', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); const card = page.locator('.reference-card').first(); await card.waitFor()
    assert.equal(await card.locator('.reference-resource').count(), 4)
    assert.match(await card.locator('.uptime-badge').innerText(), /7 天 23 小时/)
    assert.match(await card.locator('[data-resource="traffic"]').innerText(), /∞/)
    assert.equal(await card.locator('.reference-probe[data-lane="cm"]').count(), 0)
    assert.match(await card.locator('.reference-probe[data-lane="ct"]').innerText(), /0 ms/)
    assert.match(await card.locator('.reference-probe[data-lane="ct"]').innerText(), /0% 丢包/)
    assert.ok(await card.locator('.reference-probe[data-lane="ct"] .segment-good').count() > 0)
    assert.match(await card.locator('.reference-probe[data-lane="cu"]').innerText(), /超时/)
    assert.ok(await card.locator('.reference-probe[data-lane="cu"] .segment-timeout').count() > 0)
    assert.equal(await page.getByRole('button', { name: '显示设置' }).count(), 0)
    assert.ok(await page.locator('.reference-probe').count() > 0)
    assert.equal(detailHistoryCount(entry), 0)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('distribution moved to top and expiry ranking sorts configured dates with valid node links', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    assert.equal(await page.locator('.insight-top .flow-panel').count(), 1)
    assert.equal(await page.locator('.network-trend').count(), 0)
    assert.equal(await page.locator('.insight-bottom .flow-panel').count(), 0)
    assert.equal(await page.locator('.insight-bottom .expiry-panel').count(), 1)
    assert.equal(await page.locator('.expiry-table tbody tr').count(), 5)
    const dates = await page.locator('.expiry-table tbody tr td:nth-child(3)').allTextContents()
    assert.deepEqual(dates, ['2026-10-27', '2026-11-01', '2026-11-08', '2026-11-14', '2026-12-31'])
    assert.match(await page.locator('.expiry-panel .insight-heading').innerText(), /共 5 台/)
    assert.equal(count(entry, '/api/servers'), 1); assert.equal(detailHistoryCount(entry), 0)
    await page.locator('.expiry-table tbody tr').first().getByRole('link').click(); await page.locator('.detail-view-switch').waitFor(); await page.getByRole('tab', { name: '机器信息', exact: true }).click()
    assert.match(page.url(), /server\/node-c/)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('site expiry switch hides ranking and expiry card badges', async () => {
    const entry = await contextFor('public-off-noexpiry'), { page } = entry
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    assert.equal(await page.locator('.expiry-panel').count(), 0)
    assert.equal(await page.locator('.expiry-badge').count(), 0)
    assert.equal(await page.locator('.insight-top .flow-panel').count(), 1)
    await entry.context.close()
  })
  await test('compact card typography, clear network labels and distinct real flag/OS assets', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); const card = page.locator('.reference-card').first(); await card.waitFor()
    assert.ok(await card.locator('.reference-card-heading strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) <= 14)
    assert.ok(await card.locator('.reference-resource-heading b').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)) <= 12)
    assert.ok((await card.boundingBox()).height < 380)
    assert.equal(await page.locator('.insight-bottom > .insight-panel:not(.expiry-panel) .insight-heading p').count(), 0)
    assert.match(await card.locator('.network-download').innerText(), /下载.*\n.*累计/s)
    assert.match(await card.locator('.network-upload').innerText(), /上传.*\n.*累计/s)
    assert.equal(await card.locator('.reference-flag').getAttribute('src'), `${origin}/flags/hk.svg`)
    assert.equal(await card.locator('.reference-os').getAttribute('src'), `${origin}/os-icons/os-ubuntu.svg`)
    assert.ok(await card.locator('.reference-flag').evaluate(el => el.complete && el.naturalWidth > 0))
    assert.ok(await card.locator('.reference-os').evaluate(el => el.complete && el.naturalWidth > 0))
    const [hk, sg, ubuntu] = await Promise.all(['/flags/hk.svg', '/flags/sg.svg', '/os-icons/os-ubuntu.svg'].map(path => fetch(origin + path).then(r => r.text())))
    assert.notEqual(hk, sg); assert.notEqual(hk, ubuntu)
    assert.equal(await page.locator('.expiry-table tbody tr').first().locator('img').getAttribute('src'), `${origin}/flags/sg.svg`)
    assert.equal(detailHistoryCount(entry), 0)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('five-row rankings retain all totals, readable numbers and smaller latency segments', async () => {
    const entry = await contextFor('public-off-preview-seven'), { page } = entry
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    assert.equal(await page.locator('.expiry-table tbody tr').count(), 5)
    assert.match(await page.locator('.expiry-panel .insight-heading').innerText(), /共 7 台/)
    const lastRows = await page.locator('.expiry-table tbody tr td:nth-child(3)').allTextContents()
    assert.deepEqual(lastRows, ['2026-10-27', '2026-11-01', '2026-11-08', '2026-11-14', '2026-12-31'])
    const ranks = page.locator('.insight-bottom > .insight-panel:not(.expiry-panel)')
    for (const panel of await ranks.all()) assert.equal(await panel.locator('.insight-rank-row').count(), 5)
    assert.equal(await page.locator('.rank-footer').count(), 0)
    assert.ok((await page.locator('.insight-top').boundingBox()).height <= 260)
    const block = page.locator('.probe-segments .segment-good').first()
    assert.ok((await block.boundingBox()).height <= 4)
    assert.ok((await block.boundingBox()).width <= 14)
    const color = await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--ink').trim())
    const toRgb = value => page.evaluate(value => { const el = document.createElement('span'); el.style.color = value; document.body.append(el); const color = getComputedStyle(el).color; el.remove(); return color }, value)
    const ink = await toRgb(color)
    assert.equal(await page.locator('.flow-legend b').first().evaluate(el => getComputedStyle(el).color), ink)
    assert.equal(await page.locator('.expiry-table tbody tr:not(.expiry-urgent) td:last-child').first().evaluate(el => getComputedStyle(el).color), ink)
    assert.equal(count(entry, '/api/servers'), 1); assert.equal(detailHistoryCount(entry), 0)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('latency opens first, lane selection and machine tab reuse history and socket', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); await page.locator('.card-popup-button').first().click()
    await page.getByRole('tab', { name: '延迟监控', exact: true }).waitFor()
    assert.equal(await page.getByLabel('历史时间范围').inputValue(), '24')
    assert.equal(await page.getByRole('tab', { name: '延迟监控', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('.machine-overview').isVisible(), false)
    assert.match(await page.locator('.latency-lane').first().innerText(), /0 ms/)
    assert.match(await page.locator('.latency-lane.timeout').innerText(), /超时/)
    assert.equal(await page.locator('.latency-lane').filter({ hasText: '移动' }).count(), 0)
    await page.getByRole('button', { name: '全不选', exact: true }).click()
    assert.match(await page.locator('.latency-trend h3').innerText(), /0 \/ 2/)
    await page.getByRole('button', { name: '全选', exact: true }).click()
    await page.getByRole('switch').check()
    assert.equal(await page.getByRole('switch').isChecked(), true)
    await page.getByRole('tab', { name: '机器信息', exact: true }).click()
    await page.locator('.machine-overview').waitFor()
    await page.getByRole('tab', { name: '机器信息', exact: true }).press('ArrowLeft')
    assert.equal(await page.getByRole('tab', { name: '延迟监控', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(count(entry, '/api/server'), 1); assert.equal(detailHistoryCount(entry), 1); assert.equal(entry.sockets().length, 1)
    await page.getByLabel('历史时间范围').selectOption('1')
    await waitFor(() => detailHistoryCount(entry) === 2)
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: 'test-results/latency-1440.png' })
    await page.setViewportSize({ width: 320, height: 900 }); await page.screenshot({ path: 'test-results/latency-320.png' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('detail dialog retains filters and scroll, traps focus, expands and closes without new sockets', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    const search = page.locator('input').first()
    await search.fill('香港')
    const popup = page.getByRole('button', { name: '打开节点详情弹窗' }).first()
    await popup.scrollIntoViewIfNeeded()
    const scroll = await page.evaluate(() => scrollY)
    await popup.click(); await page.locator('.detail-view-switch').waitFor(); await page.getByRole('tab', { name: '机器信息', exact: true }).click()
    assert.equal(await page.getByRole('dialog').count(), 1)
    assert.equal(entry.sockets().length, 1)
    assert.equal(entry.sockets()[0].closed, false)
    assert.equal(await page.evaluate(() => scrollY), scroll)
    assert.equal(await page.locator('.shell').getAttribute('inert'), '')
    await page.getByLabel('放大窗口', { exact: true }).click()
    assert.equal(await page.locator('.detail-dialog.expanded').count(), 1)
    await page.getByLabel('还原窗口').click()
    await page.getByLabel('关闭详情弹窗').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.getByRole('tab', { name: '机器信息', exact: true }).evaluate(el => el === document.activeElement), true)
    await page.getByLabel('历史时间范围').focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.locator('.machine-extra>summary').evaluate(el => el === document.activeElement), true)
    await page.keyboard.press('Tab')
    assert.equal(await page.getByLabel('放大窗口', { exact: true }).evaluate(el => el === document.activeElement), true)
    const before = await page.locator('.detail-metrics').innerText()
    await page.waitForTimeout(1500)
    assert.notEqual(await page.locator('.detail-metrics').innerText(), before, 'modal receives shared live updates')
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(await search.inputValue(), '香港')
    assert.equal(await popup.evaluate(el => el === document.activeElement), true)
    assert.equal(count(entry, '/api/servers'), 1)
    await popup.click(); await page.locator('.detail-view-switch').waitFor(); await page.getByRole('tab', { name: '机器信息', exact: true }).click()
    await page.locator('.detail-overlay').click({ position: { x: 2, y: 2 } })
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.equal(entry.sockets().length, 1)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('restored header metrics, probe blocks, inline metadata and bordered responsive machine facts', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    await page.waitForTimeout(1200)
    for (const ws of allSockets) if (ws.fixtureSession === entry.session) ws.close(1008)
    await page.waitForTimeout(1100)
    assert.match(await page.locator('.summary-total').innerText(), /节点总览[\s\S]*6/)
    assert.match(await page.locator('.summary-busiest').innerText(), /最忙节点/)
    assert.equal(await page.locator('.summary-cores, .summary-memory, .summary-storage, .summary-today').count(), 0)
    assert.match(await page.locator('.summary-busiest>strong').innerText(), /B\/s/)
    assert.match(await page.locator('.summary-total .summary-offline-count').innerText(), /台离线/)
    assert.equal(await page.locator('.probe-sparkline').count(), 0)
    assert.ok(await page.locator('.probe-segments .segment-good').count() > 0)
    await page.locator('.card-popup-button').first().click(); await page.getByRole('tab', { name: '机器信息', exact: true }).click()
    assert.equal(await page.locator('.resource-card').count(), 4)
    assert.equal(await page.locator('.resource-ring').count(), 4)
    assert.match(await page.locator('.resource-cpu').innerText(), /Intel Xeon/)
    assert.match(await page.locator('.resource-ram').innerText(), /RAM[\s\S]*Swap/)
    await page.locator('.machine-extra>summary').click()
    assert.equal(await page.locator('.machine-fact').count(), 14)
    assert.equal(await page.locator('.machine-identity, .history-heading').count(), 0)
    assert.match(await page.locator('.dialog-machine-summary').innerText(), /Ubuntu[\s\S]*TCP/)
    assert.equal(await page.locator('.dialog-region-flag').getAttribute('alt'), 'HK')
    assert.match(await page.locator('.dialog-online-status').innerText(), /在线/)
    assert.equal(await page.locator('.machine-charts .chart-panel').first().evaluate(el => getComputedStyle(el).borderTopWidth), '1px')
    assert.match(await page.locator('.machine-facts').innerText(), /运行时间[\s\S]*月流量限制[\s\S]*Agent 版本/)
    const panels = await page.locator('.machine-charts .chart-panel').all()
    const first = await panels[0].boundingBox(), second = await panels[1].boundingBox()
    assert.equal(second.y, first.y); assert.ok(second.x > first.x + first.width)
    assert.ok(await panels[0].locator('path[fill-opacity]').count() > 0)
    assert.match(await panels[1].innerText(), /GB/)
    await page.setViewportSize({ width: 320, height: 1000 })
    const facts = page.locator('.machine-fact')
    assert.equal(Math.round((await facts.nth(0).boundingBox()).y), Math.round((await facts.nth(1).boundingBox()).y))
    assert.ok((await facts.nth(2).boundingBox()).y > (await facts.nth(0).boundingBox()).y)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(count(entry, '/api/servers'), 1); assert.equal(detailHistoryCount(entry), 1)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('four compact summary cards show traffic busiest node and remove extra totals', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    await page.waitForTimeout(2300)
    const cards = page.locator('.compact-summary .summary-card')
    assert.equal(await cards.count(), 4)
    const first = await cards.first().boundingBox(), last = await cards.last().boundingBox()
    assert.equal(first.y, last.y); assert.ok(first.height <= 90)
    assert.match(await page.locator('.summary-month').innerText(), /33.0 GB/)
    assert.match(await page.locator('.summary-total .summary-offline-count').innerText(), /台离线/)
    assert.ok((await page.locator('.summary-busiest-name').innerText()).length > 0)
    assert.match(await page.locator('.summary-busiest>strong').innerText(), /B\/s/)
    assert.doesNotMatch(await page.locator('.summary-busiest').innerText(), /CPU|%/)
    assert.equal(await page.locator('.summary-cores, .summary-memory, .summary-storage, .summary-today, .compact-summary .summary-foot, .summary-offline-note').count(), 0)
    assert.ok(await page.locator('.summary-speed path[fill-opacity]').count() > 0)
    await page.locator('.header').screenshot({ path: 'test-results/header-1440.png' })
    await page.setViewportSize({ width: 320, height: 1000 })
    await page.locator('.header').screenshot({ path: 'test-results/header-320.png' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(count(entry, '/api/servers'), 1); assert.equal(detailHistoryCount(entry), 0); assert.equal(count(entry, '/api/config'), 1)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('table separates OS and renewal while settings remain removed', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.route('**/api/servers', async route => {
      const response = await route.fetch(), data = await response.json()
      data.servers[0].price = '12'; data.servers[0].currency = '$'; data.servers[0].billing_cycle = 'month'
      await route.fulfill({ response, json: data })
    })
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    await page.getByLabel('表格视图', { exact: true }).click()
    const first = page.locator('.server-list-table tbody tr').first()
    assert.match(await page.locator('.server-list-table thead').innerText(), /服务器[\s\S]*系统[\s\S]*续期价格[\s\S]*CPU/)
    assert.doesNotMatch(await first.locator('td').first().innerText(), /Ubuntu/)
    assert.match(await first.locator('.list-system').innerText(), /Ubuntu 24.04 · 4 核/)
    assert.match(await first.locator('.list-renewal').innerText(), /2026-11-01[\s\S]*\$12\/月/)
    assert.equal(await page.locator('.display-toggle, .display-settings').count(), 0)
    await page.screenshot({ path: 'test-results/server-table-1440.png', fullPage: true })
    await page.setViewportSize({ width: 320, height: 1000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.equal(count(entry, '/api/servers'), 1); assert.equal(count(entry, '/api/theme_options'), 0)
    await first.locator('td').first().getByRole('link').click(); await page.getByRole('dialog').waitFor()
    assert.equal(entry.sockets().length, 1)
    assert.deepEqual(entry.errors, []); await entry.context.close()
  })
  await test('dashboard summary sits in the header without duplicate data requests and leaves with the page', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    assert.equal(await page.locator('.header .summary-card').count(), 4)
    assert.equal(await page.locator('main .summary-grid').count(), 0)
    assert.equal(await page.locator('.header nav, .header-note').count(), 0)
    const brand = await page.locator('.brand').boundingBox(), summary = await page.locator('.header-summary').boundingBox(), tools = await page.locator('.header-tools').boundingBox()
    assert.ok(summary.y >= brand.y + brand.height)
    assert.ok(summary.y >= tools.y + tools.height)
    assert.ok(summary.width > brand.width + tools.width)
    await page.locator('.reference-card').first().click(); await page.locator('.detail-view-switch').waitFor(); await page.getByRole('tab', { name: '机器信息', exact: true }).click()
    assert.equal(await page.locator('.header .summary-grid').count(), 1); assert.equal(await page.locator('.shell').getAttribute('inert'), '')
    assert.equal(count(entry, '/api/servers'), 1)
    await page.locator('.back-link').click(); await page.locator('.header .summary-card').first().waitFor()
    assert.equal(await page.locator('.header .summary-card').count(), 4)
    assert.equal(count(entry, '/api/servers'), 1); assert.equal(count(entry, '/api/config'), 1)
    await entry.context.close()
  })
  await test('IP quality import preserves unknowns, keyboard navigation and request boundaries', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    await page.locator('.reference-card').first().click(); await page.locator('.detail-view-switch').waitFor()
    const quality = page.getByRole('tab', { name: 'IP 质量', exact: true })
    await quality.click(); await page.getByText('尚无 IP 质量报告', { exact: true }).waitFor()
    assert.equal(await page.locator('.detail-range-tools').isVisible(), false)
    const requests = count(entry, '/api/history/all'), sockets = entry.sockets().length
    await quality.press('ArrowLeft'); assert.equal(await page.getByRole('tab', { name: '机器信息', exact: true }).getAttribute('aria-selected'), 'true')
    await page.getByRole('tab', { name: '机器信息', exact: true }).press('End')
    assert.equal(await quality.getAttribute('aria-selected'), 'true')
    const data = { Head: { IP: '192.0.2.1', Time: '2026-10-20 01:00:00 UTC', Version: 'test-fixture' }, Info: { Region: { Name: 'Test region' }, City: { Name: 'Test city' }, ASN: 'AS0' }, Score: { IPQS: 0, AbuseIPDB: null }, Factor: { CountryCode: { IPQS: 'US', IPinfo: 'US' }, Proxy: { IPQS: true, IPinfo: false }, VPN: { IPQS: null } }, Media: { Netflix: { Status: 'Originals Only', Region: 'US' }, ChatGPT: { Status: 'Timeout' } }, Mail: { Port25: false, DNSBlacklist: { Total: 10, Clean: 10, Blacklisted: 0 } } }
    const upload = value => page.locator('.ipq-file').setInputFiles({ name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
    await upload(data)
    assert.match(await page.locator('.ipq-archive-bar').innerText(), /本地预览/)
    assert.match(await page.locator('.ipq-facts').innerText(), /192.0.\*.\*/)
    await page.getByRole('tab', { name: '风控评分', exact: true }).click()
    assert.equal(await page.locator('.ipq-score strong').first().innerText(), '0')
    assert.equal(await page.locator('.ipq-score strong').nth(1).innerText(), '—')
    await page.getByRole('tab', { name: '风险因子', exact: true }).click()
    assert.equal(await page.locator('.ipq-badge.detected').count(), 1)
    assert.equal(await page.locator('.ipq-badge.clear').count(), 1)
    assert.equal(await page.locator('.ipq-badge.unknown').count(), 2)
    await page.getByRole('tab', { name: '流媒体与 AI', exact: true }).click()
    assert.match(await page.locator('.ipq-service').first().innerText(), /部分支持/)
    assert.match(await page.locator('.ipq-service').nth(1).innerText(), /未确认/)
    await page.locator('.detail-dialog').screenshot({ path: 'test-results/ip-quality-1440.png' })
    await page.setViewportSize({ width: 375, height: 850 })
    assert.equal(await page.locator('.detail-dialog-content').evaluate(el => el.scrollWidth > el.clientWidth), false)
    await page.locator('.detail-dialog').screenshot({ path: 'test-results/ip-quality-375.png' })
    await page.getByRole('tab', { name: '原始归档', exact: true }).click()
    assert.match(await page.locator('.ipq-raw').innerText(), /192.0.2.1/)
    await upload({ unexpected: true })
    assert.match(await page.locator('.ip-quality [role=alert]').innerText(), /格式不支持/)
    assert.equal(await page.locator('.ipq-raw').isVisible(), true)
    assert.equal(count(entry, '/api/history/all'), requests)
    assert.equal(entry.sockets().length, sockets)
    assert.equal(count(entry, '/api/theme_options'), 0)
    assert.deepEqual(entry.errors, [])
    await entry.context.close()
  })
  await test('IP quality node archives switch without requests and stay separate from local imports', async () => {
    const entry = await contextFor('public-off'), { page } = entry
    const latest = { Head: { IP: '192.0.2.2', Time: '2026-10-20 00:00:00 UTC' }, Info: { ASN: 'AS-NEW' } }
    const older = { Head: { IP: '2001:db8::2', Time: '2026-10-19 00:00:00 UTC' }, Info: { ASN: 'AS-OLD' } }
    await page.route('**/api/server?*', async route => {
      const response = await route.fetch(), data = await response.json()
      data.ip_quality_reports = [older, latest]
      await route.fulfill({ response, json: data })
    })
    await page.goto(origin); await page.locator('.reference-card').first().waitFor()
    await page.locator('.reference-card').first().click(); await page.locator('.detail-view-switch').waitFor()
    await page.getByRole('tab', { name: 'IP 质量', exact: true }).click()
    assert.match(await page.locator('.ipq-facts').innerText(), /AS-NEW/)
    const requests = count(entry, '/api/server')
    await page.getByLabel('选择检测归档', { exact: true }).selectOption('1')
    assert.match(await page.locator('.ipq-facts').innerText(), /AS-OLD/)
    await page.locator('.ipq-file').setInputFiles({ name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...latest, Info: { ASN: 'AS-LOCAL' } })) })
    assert.match(await page.locator('.ipq-facts').innerText(), /AS-LOCAL/)
    await page.getByRole('button', { name: '返回节点报告', exact: true }).click()
    assert.match(await page.locator('.ipq-facts').innerText(), /AS-NEW/)
    assert.equal(count(entry, '/api/server'), requests)
    await page.setViewportSize({ width: 320, height: 850 })
    assert.equal(await page.locator('.detail-dialog-content').evaluate(el => el.scrollWidth > el.clientWidth), false)
    assert.deepEqual(entry.errors, [])
    await entry.context.close()
  })
} finally {
  await browser.close()
  for (const ws of allSockets) ws.terminate()
  for (const { server, wss } of servers) { wss.close(); await new Promise(resolve => server.close(resolve)) }
}
if (failures.length) { console.error(`${failures.length} browser scenario(s) failed`); process.exitCode = 1 }
else console.log(`All ${passed} browser scenarios passed. Screenshots saved to test-results/.`)
