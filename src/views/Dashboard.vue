<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { state } from '../composables/useMonitor.js'
import { t, themeOptions, language } from '../composables/useTheme.js'
import { patchPreferences, favorite, toggleFavorite } from '../composables/usePreferences.js'
import ServerCard from '../components/ServerCard.vue'
import MetricBar from '../components/MetricBar.vue'
import Icon from '../components/Icon.vue'
import Sparkline from '../components/Sparkline.vue'
import { timestamp, bytes, percent, online } from '../utils/metrics.js'
import { osIcon, validRegion, uptimeText, daysLeft, traffic, billing } from '../utils/display.js'
const filter = ref(''), group = ref(''), quick = ref(''), now = ref(Date.now())
const all = computed(() => state.sites.flatMap((site, siteIndex) => site.servers.filter(server => server.is_hidden !== '1').map(server => ({ server, site, siteIndex }))))
const regions = computed(() => [...new Set(all.value.map(item => item.server.region).filter(Boolean))])
const groups = computed(() => [...new Set(all.value.map(item => item.server.server_group).filter(Boolean))])
const stats = computed(() => Object.fromEntries(['total', 'online', 'offline'].map(key => [key, state.sites.reduce((sum, site) => sum + Number(site.stats[key] || 0), 0)])))
const high = item => online(item.server, now.value) && (Number(item.server.cpu) >= 80 || percent(item.server.ram_used, item.server.ram_total) >= 90)
const highCount = computed(() => all.value.filter(high).length)
const expiring = item => item.site.sysConfig.show_expire === true && daysLeft(item.server.expire_date, now.value) !== null && daysLeft(item.server.expire_date, now.value) <= 14
const expiryCount = computed(() => all.value.filter(expiring).length)
const speeds = computed(() => all.value.filter(({ server }) => online(server, now.value)).reduce((sum, { server }) => ({ down: sum.down + (Number(server.net_in_speed) || 0), up: sum.up + (Number(server.net_out_speed) || 0) }), { down: 0, up: 0 }))
const totalTraffic = computed(() => all.value.reduce((sum, { server }) => sum + (Number(server.net_rx) || 0) + (Number(server.net_tx) || 0), 0))
const series = ref([])
watch(speeds, speed => {
  const point = { ...speed, second: Math.floor(Date.now() / 1000) }
  const next = [...series.value]
  if (next.at(-1)?.second === point.second) next[next.length - 1] = point
  else next.push(point)
  series.value = next.slice(-32)
}, { immediate: true })
const layout = computed(() => themeOptions.value.view_mode === 'table' ? 'table' : 'cards')
function billingSummary({ server, site }) {
  const days = site.sysConfig.show_expire === true ? daysLeft(server.expire_date, now.value) : null
  const remaining = days === null ? '' : `${t('remaining')} ${days} ${t('days')}`
  const price = site.sysConfig.show_price === true ? billing(server, language.value) : ''
  return [remaining, price].filter(Boolean).join(' / ') || '—'
}
const filtered = computed(() => all.value.filter(item => {
  const { server, siteIndex } = item
  return (!filter.value || server.region === filter.value) && (!group.value || server.server_group === group.value) && (!quick.value || (quick.value === 'high' ? high(item) : quick.value === 'expiring' ? expiring(item) : favorite(siteIndex, server.id)))
}))
let offlineDeadline
function scheduleOffline() {
  clearTimeout(offlineDeadline); now.value = Date.now()
  const deadlines = all.value.map(({ server }) => timestamp(server.last_updated) + 300000).filter(deadline => deadline > now.value)
  if (deadlines.length) offlineDeadline = setTimeout(scheduleOffline, Math.max(1000, Math.min(...deadlines) - now.value + 1))
}
watch(all, scheduleOffline, { immediate: true })
onBeforeUnmount(() => clearTimeout(offlineDeadline))
const toggleQuick = value => { quick.value = quick.value === value ? '' : value }
</script>
<template>
  <section class="stats-grid" :aria-label="t('overview')">
    <article class="stat-card"><div class="stat-label"><Icon name="pulse"/>{{ t('onlineNodes') }}</div><div class="stat-value"><strong>{{ stats.online }}</strong><span>/ {{ stats.total }} · {{ t('offline') }} {{ stats.offline }}</span></div><p class="stat-note"><span class="tiny-dot"></span>{{ stats.offline === 0 && stats.total ? t('allOnline') : t('snapshot') }}</p></article>
    <article class="stat-card"><div class="stat-label"><Icon name="warning"/>{{ t('highLoadNodes') }}</div><div class="stat-value"><strong>{{ highCount }}</strong><span>/ {{ stats.total }}</span></div><p class="stat-note"><span class="tiny-dot"></span>{{ t('highLoadRule') }}</p></article>
    <article class="stat-card"><div class="stat-label"><Icon name="download"/>{{ t('traffic') }}</div><div class="stat-value"><strong>{{ bytes(totalTraffic).split(' ')[0] }}</strong><span>{{ bytes(totalTraffic).split(' ')[1] }}</span></div><p class="stat-note transfer-note"><span>{{ t('upload') }} ↑ {{ bytes(all.reduce((sum, item) => sum + Number(item.server.net_tx || 0), 0)) }}</span><span aria-hidden="true">·</span><span>{{ t('download') }} ↓ {{ bytes(all.reduce((sum, item) => sum + Number(item.server.net_rx || 0), 0)) }}</span></p></article>
    <article class="stat-card speed-stat"><div class="stat-label"><Icon name="traffic"/>{{ t('realtimeSpeed') }}</div><div class="speed-values"><strong>↓ {{ bytes(speeds.down) }}<small>/s</small></strong><strong>↑ {{ bytes(speeds.up) }}<small>/s</small></strong></div><div class="speed-plot"><Sparkline :values="series.map(point => point.down)" :max="Math.max(1, ...series.map(point => point.down))" :height="44" :label="t('download')"/><Sparkline class="upload-line" :values="series.map(point => point.up)" :max="Math.max(1, ...series.map(point => point.up))" :height="44" :label="t('upload')"/></div></article>
  </section>
  <div class="fleet-toolbar"><div class="filter-tabs"><button :class="{ active: !filter && !group && !quick }" @click="filter = ''; group = ''; quick = ''">{{ t('allNodes') }}</button><button v-for="region in regions" :key="region" :class="{ active: filter === region }" @click="filter = filter === region ? '' : region">{{ region }}</button><select v-if="groups.length > 1" v-model="group" :aria-label="t('groups')"><option value="">{{ t('all') }}</option><option v-for="item in groups" :key="item">{{ item }}</option></select></div><div class="quick-filters"><button :class="{ active: quick === 'favorites' }" @click="toggleQuick('favorites')" :title="t('favorites')"><Icon name="star" :size="15"/></button><span><Icon name="server" :size="15"/>{{ t('total') }} {{ stats.total }}</span><button :class="{ active: quick === 'high' }" @click="toggleQuick('high')"><Icon name="warning" :size="15"/>{{ t('highLoad') }} {{ highCount }}</button><button v-if="expiryCount" :class="{ active: quick === 'expiring' }" @click="toggleQuick('expiring')"><Icon name="calendar" :size="15"/>{{ t('expiring') }} {{ expiryCount }}</button></div><div class="view-actions"><button v-for="view in [{ key: 'cards', icon: 'grid', label: 'cardView' }, { key: 'table', icon: 'list', label: 'tableView' }]" :key="view.key" :aria-label="t(view.label)" :aria-pressed="layout === view.key" :class="{ active: layout === view.key }" @click="patchPreferences({ view_mode: view.key })"><Icon :name="view.icon"/></button></div></div>

  <p v-if="state.loading && !all.length" class="empty">{{ t('loading') }}</p>
  <div v-else-if="filtered.length && layout !== 'table'" class="server-grid"><ServerCard v-for="item in filtered" :key="`${item.siteIndex}:${item.server.id}`" v-bind="item" :now="now"/></div>
  <div v-else-if="filtered.length" class="node-table-wrap"><table class="node-table"><thead><tr><th>{{ t('status') }}</th><th>{{ t('os') }}</th><th>{{ t('node') }}</th><th>{{ t('remainingDate') }}</th><th>{{ t('uptime') }}</th><th>CPU</th><th>{{ t('ram') }}</th><th>{{ t('disk') }}</th><th>{{ t('transfer') }}</th><th>{{ t('realtimeSpeed') }}</th></tr></thead><tbody><tr v-for="item in filtered" :key="`${item.siteIndex}:${item.server.id}`"><td><span class="state-dot" :class="{ offline: !online(item.server, now) }" :title="t(online(item.server, now) ? 'online' : 'offline')"></span></td><td><img v-if="osIcon(item.server.os)" class="os-icon" :src="`${item.site.base}/os-icons/${osIcon(item.server.os)}`" :alt="item.server.os"></td><td class="table-node"><RouterLink :to="{ path: `/server/${item.server.id}`, query: { site: item.siteIndex } }"><img v-if="validRegion(item.server.region)" class="flag-icon" :src="`${item.site.base}/flags/${item.server.region.toLowerCase()}.svg`" :alt="item.server.region"><strong>{{ item.server.name }}</strong></RouterLink><button class="favorite-button" :class="{ selected: favorite(item.siteIndex, item.server.id) }" :aria-label="t('favorite')" @click="toggleFavorite(item.siteIndex, item.server.id)"><Icon name="star" :size="15"/></button></td><td class="table-billing">{{ billingSummary(item) }}</td><td><strong>{{ uptimeText(item.server.boot_time, now, language) }}</strong></td><td><MetricBar label="" :value="Number(item.server.cpu)"/></td><td><MetricBar label="" :value="percent(item.server.ram_used, item.server.ram_total)"/></td><td><MetricBar label="" :value="percent(item.server.disk_used, item.server.disk_total)"/></td><td><MetricBar v-if="item.site.sysConfig.show_tf !== false" label="" :value="traffic(item.server).percentage" :unlimited="!traffic(item.server).limit" green/><span v-else>—</span></td><td class="table-speed"><span>↑ {{ bytes(item.server.net_out_speed) }}/s</span><span>↓ {{ bytes(item.server.net_in_speed) }}/s</span></td></tr></tbody></table></div>
  <p v-else class="empty">{{ t('empty') }}</p>
</template>
