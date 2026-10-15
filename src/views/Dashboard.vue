<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { state } from '../composables/useMonitor.js'
import { t, themeOptions } from '../composables/useTheme.js'
import ServerCard from '../components/ServerCard.vue'
import { timestamp } from '../utils/metrics.js'
const search = ref(''), group = ref('')
const all = computed(() => state.sites.flatMap((site, siteIndex) => site.servers.filter(server => server.is_hidden !== '1').map(server => ({ server, site, siteIndex }))))
const groups = computed(() => [...new Set(all.value.map(item => item.server.server_group).filter(Boolean))])
const filtered = computed(() => all.value.filter(({ server }) => (!group.value || server.server_group === group.value) && [server.name, server.region, server.server_group].join(' ').toLowerCase().includes(search.value.toLowerCase())))
const stats = computed(() => ['total', 'online', 'offline'].map(key => ({ key, value: state.sites.reduce((sum, site) => sum + Number(site.stats[key] || 0), 0) })))
// A single deadline updates stale statuses without querying the backend.
const now = ref(Date.now())
let offlineDeadline
function scheduleOffline() {
  clearTimeout(offlineDeadline)
  now.value = Date.now()
  const deadlines = all.value.map(({ server }) => timestamp(server.last_updated) + 300000).filter(deadline => deadline > now.value)
  if (deadlines.length) offlineDeadline = setTimeout(scheduleOffline, Math.max(1000, Math.min(...deadlines) - now.value + 1))
}
watch(all, scheduleOffline, { immediate: true })
onBeforeUnmount(() => clearTimeout(offlineDeadline))
</script>
<template><section class="page-heading"><div><p class="eyebrow">{{ t('overview') }}</p><h1>{{ t('fleet') }}</h1><p class="muted">{{ t('intro') }}</p></div><span class="node-count">{{ all.length }} NODES</span></section><section class="stats-grid"><article v-for="stat in stats" :key="stat.key" class="stat-card"><span class="muted">{{ t(stat.key) }}</span><div><strong>{{ stat.value.toString().padStart(2, '0') }}</strong><span :class="['stat-symbol', stat.key]">{{ stat.key === 'total' ? '▦' : stat.key === 'online' ? '↗' : '↘' }}</span></div><span class="stat-rule" :class="stat.key"></span></article></section><div class="toolbar"><label class="search"><span>⌕</span><input v-model="search" :placeholder="t('search')" :aria-label="t('search')"></label><select v-model="group" :aria-label="t('groups')"><option value="">{{ t('all') }}</option><option v-for="item in groups" :key="item">{{ item }}</option></select><span class="muted results">{{ filtered.length }} / {{ all.length }}</span></div><p v-if="state.loading && !all.length" class="empty">{{ t('loading') }}</p><div v-else-if="filtered.length" class="server-grid"><ServerCard v-for="item in filtered" :key="`${item.siteIndex}:${item.server.id}`" v-bind="item" :now="now" :compact="themeOptions.density === 'compact'"/></div><p v-else class="empty">{{ t('empty') }}</p></template>
