import { collectBatch } from './metrics.js'
export function websocketUrl(base, scope, token, origin = location.origin) {
  const url = new URL('/api/ws', base)
  url.searchParams.set('subscribe', scope)
  if (url.origin !== origin && token) url.searchParams.set('token', token)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
export class LiveFeed {
  constructor({ base, scope, ids, token, timeoutMinutes, onBatch, onState, WebSocketClass = WebSocket }) {
    Object.assign(this, { base, scope, ids: new Set(ids), token, timeoutMinutes, onBatch, onState, WebSocketClass })
    this.pending = new Map()
    this.attempts = 0
    this.active = false
    this.expired = false
    this.lastFlush = Date.now()
  }
  start() {
    if (this.active || this.expired) return
    this.active = true
    this.attempts = 0
    if (this.timeoutMinutes > 0) this.expiry = setTimeout(() => {
      this.expired = true
      this.stop()
      this.onState('expired')
    }, this.timeoutMinutes * 60000)
    this.connect()
  }
  connect() {
    if (!this.active || this.expired) return
    this.onState(this.attempts ? 'reconnecting' : 'connecting')
    let ws
    try { ws = new this.WebSocketClass(websocketUrl(this.base, this.scope, this.token())) }
    catch { this.retry(); return }
    this.ws = ws
    ws.onopen = () => {
      if (!this.active) return ws.close()
      this.onState('live')
      if (this.scope === 'all') ws.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids: [...this.ids] }))
    }
    ws.onmessage = event => {
      if (!this.active) return
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: message.ts }))
        collectBatch(message, this.pending, this.ids)
        if (this.pending.size && !this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), Math.max(0, 1000 - (Date.now() - this.lastFlush)))
      } catch { this.onState('invalid-message') }
    }
    ws.onerror = () => this.onState('reconnecting')
    ws.onclose = event => {
      if (!this.active) return
      if ([1008, 4001, 4003, 4401, 4403].includes(event.code)) { this.stop(); this.onState('denied'); return }
      this.retry()
    }
  }
  retry() {
    if (!this.active || this.expired) return
    if (this.attempts >= 6) { this.stop(); this.onState('failed'); return }
    this.onState('reconnecting')
    const delay = Math.min(30000, 1000 * 2 ** this.attempts++)
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }
  flush() {
    this.flushTimer = null
    if (!this.active) return
    const batch = this.pending
    this.pending = new Map()
    this.lastFlush = Date.now()
    this.onBatch(batch)
  }
  stop() {
    this.active = false
    clearTimeout(this.retryTimer)
    clearTimeout(this.flushTimer)
    clearTimeout(this.expiry)
    this.flushTimer = null
    this.pending.clear()
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null }
  }
  resume() { this.expired = false; this.start() }
}
