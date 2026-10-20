import { shallowRef, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { getHistory } from '../utils/api.js'
import { numeric } from '../utils/metrics.js'
import { TrafficSession } from '../utils/traffic.js'

const cache = new Map()
const duration = 600000

// Initial history and subsequent WS counter reports share a timeline. Rebuild
// differences in timestamp order so delayed history cannot double-count live data.
export function useTrafficWindow(records, samples, states) {
  const events = shallowRef([]), clock = ref(Date.now()), busy = ref(false), failed = ref(0)
  const entries = new Map(), generations = new Map(), requested = new Set(), queue = []
  let disposed = false, running = 0, timer
  function put(key, base, rows, generation, historical = false) {
    const points = entries.get(key) || new Map()
    for (const row of rows) {
      const raw = Number(row.timestamp ?? row.ts)
      if (!Number.isFinite(raw) || raw <= 0) continue
      const timestamp = raw < 1e11 ? raw * 1000 : raw
      if (timestamp < Date.now() - duration - 300000 || timestamp > Date.now()) continue
      const existing = points.get(timestamp)
      if (existing && !existing.historical && historical) continue
      const prior = existing || { key, base, timestamp, generation, historical, data: {} }
      if (!historical) { prior.generation = generation; prior.historical = false }
      // Only explicitly reported counters establish baselines.
      for (const field of ['net_rx', 'net_tx']) if (numeric(row[field])) prior.data[field] = Number(row[field])
      points.set(timestamp, prior)
    }
    entries.set(key, points)
  }
  function rebuild() {
    if (disposed) return
    clock.value = Date.now()
    const cutoff = clock.value - duration, result = []
    const allowed = new Set(records.value.filter(server => server._sys.show_tf === true).map(server => server._key))
    for (const [key, points] of entries) {
      if (!allowed.has(key)) continue
      const session = new TrafficSession()
      let previousGeneration
      for (const point of [...points.values()].sort((a, b) => a.timestamp - b.timestamp)) {
        if (point.timestamp < cutoff) { points.delete(point.timestamp); continue }
        if (point.generation !== previousGeneration) session.disconnect(point.base)
        previousGeneration = point.generation
        result.push(...session.push([point]))
      }
    }
    events.value = result.sort((a, b) => a.timestamp - b.timestamp)
  }
  async function drain() {
    if (disposed || document.hidden) return
    while (running < 3 && queue.length) {
      const server = queue.shift(), generation = generations.get(server._base) || 0
      running++; busy.value = true
      const key = server._key
      const promise = cache.get(key) || getHistory(server._base, server._config, server.id, 0.167)
      cache.set(key, promise)
      promise.then(rows => { if (!disposed) { put(key, server._base, rows, generation, true); rebuild() } })
        .catch(() => { if (!disposed) failed.value++ })
        .finally(() => { running--; if (!disposed) { busy.value = running > 0 || queue.length > 0; drain() } })
    }
  }
  watch(records, servers => {
    for (const server of servers) if (server._sys.show_tf === true && !requested.has(server._key)) {
      requested.add(server._key); queue.push(server)
    }
    drain()
  }, { immediate: true })
  watch(states, (next, previous = {}) => {
    for (const base of Object.keys(previous)) if (previous[base] === 'live' && next[base] !== 'live') generations.set(base, (generations.get(base) || 0) + 1)
  })
  watch(samples, batch => {
    const allowed = new Set(records.value.filter(server => server._sys.show_tf === true).map(server => server._key))
    for (const sample of batch) if (allowed.has(sample.key)) put(sample.key, sample.base, [{ ...sample.data, timestamp: sample.timestamp }], generations.get(sample.base) || 0)
    rebuild()
  }, { flush: 'post' })
  const visibility = () => { if (!document.hidden) { drain(); rebuild() } }
  onMounted(() => {
    document.addEventListener?.('visibilitychange', visibility)
    const tick = () => {
      if (!disposed) {
        if (!document.hidden && Date.now() - clock.value > 1000) rebuild()
        timer = setTimeout(tick, 10000)
      }
    }
    timer = setTimeout(tick, 10000)
  })
  onBeforeUnmount(() => { disposed = true; clearTimeout(timer); queue.length = 0; document.removeEventListener?.('visibilitychange', visibility) })
  return { events, clock, busy, failed }
}
