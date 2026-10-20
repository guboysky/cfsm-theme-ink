import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createRenderer, shallowRef, nextTick } from 'vue'
const { getHistory } = vi.hoisted(() => ({ getHistory: vi.fn() }))
vi.mock('../src/utils/api.js', () => ({ getHistory }))
import { useTrafficWindow } from '../src/composables/useTrafficWindow.js'

const now = 1800000000000
let serial = 0, app
const renderer = createRenderer({ createComment: () => ({}), createElement: () => ({}), createText: () => ({}), insert() {}, remove() {}, setElementText() {}, setText() {}, parentNode: () => null, nextSibling: () => null, patchProp() {} })
const flush = async () => { for (let i = 0; i < 6; i++) await nextTick() }
function mount(count = 1) {
  const base = `https://traffic-${++serial}.invalid`
  const records = shallowRef(Array.from({ length: count }, (_, i) => ({ id: String(i), _key: `${base}:${i}`, _base: base, _config: {}, _sys: { show_tf: true } })))
  const samples = shallowRef([]), states = shallowRef({ [base]: 'live' })
  let window
  app = renderer.createApp({ setup() { window = useTrafficWindow(records, samples, states); return () => null } })
  app.mount({})
  return { window, records, samples, states, base, send: (timestamp, value) => { samples.value = [{ key: `${base}:0`, base, timestamp, data: { net_rx: value } }] } }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubGlobal('document', { hidden: false }); getHistory.mockReset() })
afterEach(() => { app?.unmount(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('fixed ten-minute history with live counter reports', () => {
  it('merges delayed history with live data without counting overlap twice', async () => {
    let resolve
    getHistory.mockReturnValue(new Promise(done => { resolve = done }))
    const monitor = mount()
    monitor.send(now - 1000, 300); await flush()
    resolve([{ timestamp: now - 600000, net_rx: 100 }, { timestamp: now - 300000, net_rx: 200 }, { timestamp: now - 1000, net_rx: 290 }]); await flush()
    expect(monitor.window.events.value.reduce((sum, event) => sum + event.downBytes, 0)).toBe(200)
    expect(getHistory).toHaveBeenCalledExactlyOnceWith(monitor.base, {}, '0', 0.167)
    expect(monitor.window.busy.value).toBe(false)
  })
  it('does not bridge disconnections, ages data out, and never polls history', async () => {
    getHistory.mockResolvedValue([{ timestamp: now - 20000, net_rx: 100 }, { timestamp: now - 10000, net_rx: 200 }])
    const monitor = mount(); await flush()
    monitor.send(now, 300); await flush()
    monitor.states.value = { [monitor.base]: 'reconnecting' }; await flush()
    vi.setSystemTime(now + 10000); monitor.send(now + 10000, 900); await flush()
    vi.setSystemTime(now + 20000); monitor.send(now + 20000, 1000); await flush()
    expect(monitor.window.events.value.reduce((sum, event) => sum + event.downBytes, 0)).toBe(300)
    await vi.advanceTimersByTimeAsync(700000)
    expect(monitor.window.events.value).toEqual([])
    expect(monitor.window.clock.value).toBeGreaterThan(now + 600000)
    expect(getHistory).toHaveBeenCalledTimes(1)
    app.unmount(); app = null
    expect(vi.getTimerCount()).toBe(0)
  })
  it('limits initial history concurrency and ignores late results after closing', async () => {
    const pending = []
    getHistory.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
    const monitor = mount(5)
    expect(getHistory).toHaveBeenCalledTimes(3)
    pending[0]([]); await flush()
    expect(getHistory).toHaveBeenCalledTimes(4)
    app.unmount(); app = null
    for (const resolve of pending) resolve([{ timestamp: now - 10000, net_rx: 1 }, { timestamp: now, net_rx: 2 }])
    await flush()
    expect(getHistory).toHaveBeenCalledTimes(4)
    expect(monitor.window.events.value).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
