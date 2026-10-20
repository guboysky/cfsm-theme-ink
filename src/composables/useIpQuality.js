import { ref, shallowRef, watch, onBeforeUnmount } from 'vue'
import { getIpQuality, setupIpQuality } from '../utils/api.js'

const cache = new Map(), pending = new Map()
export function useIpQuality(server, active) {
  const data = shallowRef(null), busy = ref(false), error = ref(''), installing = ref(false), installation = shallowRef(null)
  let run = 0, disposed = false
  const enabled = () => server.value?._config?.ip_quality_enabled === true
  async function load(date = '', fresh = false) {
    if (!enabled()) return
    const node = server.value, key = JSON.stringify([node._base, node.id, date]), current = ++run
    busy.value = true; error.value = ''
    try {
      const saved = cache.get(key)
      let result
      if (!fresh && saved && Date.now() - saved.time < 5 * 60000) result = saved.value
      else {
        if (!pending.has(key)) pending.set(key, getIpQuality(node._base, node._config, node.id, date).then(value => {
          if (cache.size >= 60) cache.delete(cache.keys().next().value)
          cache.set(key, { value, time: Date.now() }); return value
        }).finally(() => pending.delete(key)))
        result = await pending.get(key)
      }
      if (!disposed && current === run) data.value = result
    } catch (e) { if (!disposed && current === run) error.value = e.message }
    finally { if (!disposed && current === run) busy.value = false }
  }
  async function setup() {
    if (installing.value || !enabled()) return
    installing.value = true; error.value = ''
    try {
      const node = server.value
      const value = await setupIpQuality(node._base, node._config, node.id)
      if (!disposed) { installation.value = value; await load('', true) }
    } catch (e) { if (!disposed) error.value = e.message }
    finally { if (!disposed) installing.value = false }
  }
  watch(() => JSON.stringify([server.value?._base, server.value?.id]), () => { ++run; data.value = null; installation.value = null; error.value = '' })
  watch(() => JSON.stringify([active.value, enabled(), server.value?._base, server.value?.id]), () => { if (active.value) load() }, { immediate: true })
  onBeforeUnmount(() => { disposed = true; ++run })
  return { data, busy, error, load, setup, installing, installation }
}
