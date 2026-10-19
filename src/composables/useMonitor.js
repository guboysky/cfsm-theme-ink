import { ref, shallowRef, computed, onMounted, onBeforeUnmount } from 'vue'
import { getApiBases } from '../utils/config.js'
import { getConfig, getServers, getServer, getHistory } from '../utils/api.js'
import { authToken } from '../utils/http.js'
import { LiveFeed } from '../utils/live.js'
import { mergeMetrics } from '../utils/metrics.js'
import { initAppearance } from './useTheme.js'

export const backends = shallowRef([])
let bootstrap
const listCache = new Map()
const detailCache = new Map()
export function boot() {
  return bootstrap ||= (async () => {
    const bases = getApiBases()
    const results = await Promise.allSettled(bases.map(async base => ({ base, config: await getConfig(base) })))
    backends.value = results.map((result, index) => result.status === 'fulfilled' ? result.value : { base: bases[index], error: result.reason.message })
    const first = backends.value.find(b => b.config)
    if (!first) throw new Error(backends.value.map(b => `${b.base}: ${b.error}`).join('\n'))
    initAppearance(first.config)
  })()
}
export function useMonitor({ id, base } = {}) {
  const records = shallowRef([])
  const summaries = shallowRef([])
  const rows = shallowRef([])
  const liveSamples = shallowRef([])
  const hours = ref(24)
  const busy = ref(true)
  const historyBusy = ref(false)
  const error = ref('')
  const states = ref({})
  let feeds = []
  let disposed = false
  let epoch = 0
  let historyEpoch = 0
  const selectedBackend = () => backends.value.find(b => b.base === base) || backends.value[0]
  const paused = computed(() => Object.values(states.value).includes('expired'))
  const state = computed(() => paused.value ? 'expired' : Object.values(states.value).includes('failed') ? 'failed' : Object.values(states.value).includes('reconnecting') ? 'reconnecting' : Object.values(states.value).every(s => s === 'live') && Object.keys(states.value).length ? 'live' : 'connecting')
  function stop() { for (const feed of feeds) feed.stop(); feeds = [] }
  async function load(restore = false) {
    const run = ++epoch
    stop()
    busy.value = !records.value.length
    error.value = ''
    try {
      await boot()
      const sources = id ? [selectedBackend()] : backends.value
      const results = await Promise.allSettled(sources.map(async source => {
        if (!source?.config) throw new Error(source?.error || 'Unknown backend')
        const { base: origin, config } = source
        let data
        if (id) {
          const key = `${origin}:${id}`
          if (restore || !detailCache.has(key)) detailCache.set(key, getServer(origin, config, id))
          data = await detailCache.get(key)
          if (!restore && !disposed) {
            const range = hours.value, historyRun = historyEpoch
            const history = await getHistory(origin, config, id, range)
            if (!disposed && historyRun === historyEpoch && hours.value === range) rows.value = history
          }
        } else {
          if (restore || !listCache.has(origin)) listCache.set(origin, getServers(origin, config))
          data = await listCache.get(origin)
        }
        return { source, data }
      }))
      if (run !== epoch || disposed || document.hidden) return
      const nextRecords = [], nextSummaries = [], errors = []
      states.value = {}
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === 'rejected') { errors.push(`${sources[i]?.base}: ${result.reason.message}`); continue }
        const { source, data } = result.value
        const items = id ? [data] : data.servers || []
        nextRecords.push(...items.map(server => ({ ...server, _base: source.base, _config: source.config, _sys: data.sysConfig || {}, _key: `${source.base}:${server.id}` })))
        nextSummaries.push({ ...data.stats, base: source.base, sysConfig: data.sysConfig || {} })
      }
      needsRestore = false
      records.value = nextRecords
      summaries.value = nextSummaries
      error.value = errors.join('\n')
      for (const source of sources.filter(s => s?.config)) {
        const items = nextRecords.filter(s => s._base === source.base)
        if (!items.length) continue
        const feed = new LiveFeed({
          base: source.base, scope: id || 'all', ids: items.map(s => s.id), token: authToken,
          timeoutMinutes: Number(source.config.frontend_ws_timeout_minutes) || 0,
          onState: value => { if (value === 'expired') pausedLatch = true; states.value = { ...states.value, [source.base]: value } },
          onBatch(batch) {
            if (!id) liveSamples.value = [...batch].map(([serverId, data]) => ({ key: `${source.base}:${serverId}`, base: source.base, timestamp: Number(data.timestamp) || Date.now(), data }))
            records.value = records.value.map(server => server._base === source.base && batch.has(server.id) ? mergeMetrics(server, batch.get(server.id)) : server)
            if (id && batch.has(id)) {
              const current = records.value[0]
              const cutoff = Date.now() - hours.value * 3600000
              rows.value = [...rows.value.filter(row => row.timestamp >= cutoff), { ...current, timestamp: current.timestamp || Date.now() }].slice(-500)
            }
            if (!id) listCache.set(source.base, Promise.resolve({ ...results.find(r => r.status === 'fulfilled' && r.value.source.base === source.base)?.value.data, servers: records.value.filter(s => s._base === source.base) }))
          }
        })
        feeds.push(feed)
        feed.start()
      }
    } catch (e) { if (!disposed) error.value = e.message }
    finally { if (run === epoch && !disposed) busy.value = false }
  }
  async function changeHours(value) {
    if (historyBusy.value || Number(value) === hours.value) return
    const run = ++historyEpoch
    const previous = hours.value
    hours.value = Number(value)
    historyBusy.value = true
    try {
      const source = selectedBackend()
      const result = await getHistory(source.base, source.config, id, hours.value)
      if (!disposed && run === historyEpoch) { rows.value = result; error.value = '' }
    } catch (e) { if (!disposed) { hours.value = previous; error.value = e.message } }
    finally { if (!disposed && run === historyEpoch) historyBusy.value = false }
  }
  let visibilityRestore, needsRestore = false
  async function visibility() {
    if (document.hidden) { needsRestore = true; ++epoch; for (const feed of feeds) feed.stop(); states.value = { hidden: 'hidden' } }
    else if (!pausedLatch) {
      if (!visibilityRestore || !feeds.length) return load(true)
      const run = ++epoch
      try {
        await visibilityRestore()
        if (run === epoch && !disposed && !document.hidden && !pausedLatch) { needsRestore = false; for (const feed of feeds) feed.resume() }
      } catch (e) { if (!disposed) { error.value = e.message; states.value = { restore: 'failed' } } }
    }
  }
  let pausedLatch = false
  function continueLive() {
    pausedLatch = false
    if (document.hidden) return
    if (needsRestore) return visibility()
    if (feeds.length) { for (const feed of feeds) feed.resume() }
    else load(true)
  }
  function pauseLive() { pausedLatch = true; for (const feed of feeds) feed.stop(); states.value = { paused: 'paused' } }
  onMounted(() => { load(); document.addEventListener('visibilitychange', visibility) })
  onBeforeUnmount(() => { disposed = true; ++epoch; ++historyEpoch; stop(); document.removeEventListener('visibilitychange', visibility) })
  return { records, summaries, rows, liveSamples, hours, busy, historyBusy, error, state, states, paused, changeHours,
    continueLive, pauseLive,
    setVisibilityRestore(callback) { visibilityRestore = callback; return () => { if (visibilityRestore === callback) visibilityRestore = undefined } },
    reconnect: () => {
      if (paused.value || pausedLatch || document.hidden) return
      if (needsRestore) return visibility()
      for (const feed of feeds) { feed.stop(); feed.resume() }
    }
  }
}
