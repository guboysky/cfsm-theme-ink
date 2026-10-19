import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveFeed, websocketUrl } from '../src/utils/live.js'
class FakeSocket {
  static instances = []
  constructor(url) { this.url = url; this.sent = []; FakeSocket.instances.push(this) }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.closed = true }
  open() { this.onopen?.() }
  receive(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
}
function make(options = {}) {
  const onBatch = vi.fn(), onState = vi.fn()
  const feed = new LiveFeed({ base: 'https://worker.test', scope: 'all', ids: ['a'], token: () => '', timeoutMinutes: 0, WebSocketClass: FakeSocket, onBatch, onState, ...options })
  return { feed, onBatch, onState }
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('location', { origin: 'https://worker.test' }); FakeSocket.instances = [] })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('WebSocket lifecycle', () => {
  it('uses same-origin cookies and cross-origin query token', () => {
    expect(websocketUrl('https://worker.test', 'a', 'secret')).toBe('wss://worker.test/api/ws?subscribe=a')
    expect(websocketUrl('https://other.test', 'a', 'secret')).toContain('token=secret')
  })
  it('subscribes only to the current backend ids', () => {
    const { feed } = make(); feed.start(); const ws = FakeSocket.instances[0]; ws.open()
    expect(ws.sent).toEqual([{ type: 'subscribe', scope: 'all', ids: ['a'] }]); feed.stop()
  })
  it('single-server feed does not subscribe to all', () => {
    const { feed } = make({ scope: 'a' }); feed.start(); const ws = FakeSocket.instances[0]; ws.open()
    expect(ws.url).toContain('subscribe=a'); expect(ws.sent).toEqual([]); feed.stop()
  })
  it('throttles many pushes to one render per second without clearing report data', () => {
    const { feed, onBatch } = make(); feed.start(); const ws = FakeSocket.instances[0]; ws.open()
    const push = (ts, data) => ws.receive({ type: 'batchUpdate', updates: [{ serverId: 'a', samples: [{ ts, data }] }] })
    push(1, { disk_used: 100, cpu: 1 })
    for (let i = 2; i <= 40; i++) push(i, { cpu: i })
    vi.advanceTimersByTime(999); expect(onBatch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1); expect(onBatch).toHaveBeenCalledTimes(1)
    expect(onBatch.mock.calls[0][0].get('a')).toMatchObject({ cpu: 40, disk_used: 100 })
    push(41, { cpu: 50 }); vi.advanceTimersByTime(999); expect(onBatch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1); expect(onBatch).toHaveBeenCalledTimes(2); feed.stop()
  })
  it('uses bounded exponential retries even for connections that open then drop', () => {
    const { feed, onState } = make(); feed.start()
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
      const count = FakeSocket.instances.length
      FakeSocket.instances.at(-1).open(); FakeSocket.instances.at(-1).onclose({ code: 1006 })
      vi.advanceTimersByTime(delay - 1); expect(FakeSocket.instances.length).toBe(count)
      vi.advanceTimersByTime(1); expect(FakeSocket.instances.length).toBe(count + 1)
    }
    FakeSocket.instances.at(-1).onclose({ code: 1006 }); vi.advanceTimersByTime(999999)
    expect(FakeSocket.instances.length).toBe(7); expect(onState).toHaveBeenLastCalledWith('failed')
  })
  it('expires, stays stopped, and requires explicit resume', () => {
    const { feed, onState } = make({ timeoutMinutes: 1 }); feed.start()
    vi.advanceTimersByTime(60000); expect(onState).toHaveBeenLastCalledWith('expired')
    expect(FakeSocket.instances[0].closed).toBe(true); feed.start(); expect(FakeSocket.instances.length).toBe(1)
    feed.resume(); expect(FakeSocket.instances.length).toBe(2); feed.stop()
  })
  it('stops timers and drops pending samples when hidden/unmounted', () => {
    const { feed, onBatch } = make(); feed.start(); const ws = FakeSocket.instances[0]
    ws.receive({ type: 'batchUpdate', updates: [{ serverId: 'a', samples: [{ ts: 1, data: { cpu: 1 } }] }] })
    feed.stop(); vi.advanceTimersByTime(100000); expect(onBatch).not.toHaveBeenCalled(); expect(ws.closed).toBe(true)
  })
})
