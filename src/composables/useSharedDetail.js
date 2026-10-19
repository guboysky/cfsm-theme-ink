import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { getServer, getHistory } from '../utils/api.js'
import { mergeMetrics } from '../utils/metrics.js'

// A homepage dialog owns REST history, while the mounted dashboard owns live data.
export function useSharedDetail(monitor, id, base) {
  const existing = () => monitor.records.value.find(s => s.id === id && (!base || s._base === base))
  const initial = existing()
  const source = { base: initial?._base || base, config: initial?._config }
  const snapshot = shallowRef(initial)
  const rows = shallowRef([]), hours = ref(24), busy = ref(true), historyBusy = ref(false), error = ref('')
  const records = computed(() => snapshot.value ? [mergeMetrics(snapshot.value, existing())] : [])
  let disposed = false, historyRun = 0
  async function refresh() {
    const data = await getServer(source.base, source.config, id)
    if (disposed) return
    const current = existing()
    snapshot.value = { ...current, ...data, _base: source.base, _config: source.config, _sys: data.sysConfig || current?._sys || {}, _key: `${source.base}:${id}` }
    monitor.records.value = monitor.records.value.map(s => s._key === snapshot.value._key ? mergeMetrics(s, data) : s)
  }
  async function loadHistory(range) {
    const run = ++historyRun
    const data = await getHistory(source.base, source.config, id, range)
    if (!disposed && run === historyRun) rows.value = data
  }
  async function changeHours(value) {
    if (historyBusy.value || value === hours.value) return
    const previous = hours.value
    hours.value = value; historyBusy.value = true
    try { await loadHistory(value); if (!disposed) error.value = '' }
    catch (e) { if (!disposed) { hours.value = previous; error.value = e.message } }
    finally { if (!disposed) historyBusy.value = false }
  }
  watch(monitor.liveSamples, samples => {
    const sample = samples.find(s => s.key === `${source.base}:${id}`)
    if (!sample || !records.value[0]) return
    const cutoff = Date.now() - hours.value * 3600000
    rows.value = [...rows.value.filter(row => row.timestamp >= cutoff), { ...records.value[0], timestamp: sample.timestamp }].slice(-500)
  }, { flush: 'post' })
  const resetVisibility = monitor.setVisibilityRestore(refresh)
  onMounted(async () => {
    try { await refresh(); if (!disposed) await loadHistory(hours.value) }
    catch (e) { if (!disposed) error.value = e.message }
    finally { if (!disposed) busy.value = false }
  })
  onBeforeUnmount(() => { disposed = true; ++historyRun; resetVisibility() })
  return { records, rows, hours, busy, historyBusy, error, changeHours,
    states: monitor.states, continueLive: monitor.continueLive, pauseLive: monitor.pauseLive, reconnect: monitor.reconnect }
}
