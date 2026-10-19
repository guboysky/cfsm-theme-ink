<script setup>
import { computed, ref, watch, inject, onBeforeUnmount } from 'vue'
import { monitorContext } from '../composables/monitorContext.js'
import { useMonitor, backends } from '../composables/useMonitor.js'
import { t } from '../composables/useTheme.js'
import { bytes, online, percent, pct, osIcon } from '../utils/metrics.js'
import { assetUrl } from '../utils/config.js'
import { expiryInfo } from '../utils/serverPresentation.js'
import Icon from '../components/Icon.vue'
import ServerCard from '../components/ServerCard.vue'
import ServerIdentity from '../components/ServerIdentity.vue'
import ConnectionNotice from '../components/ConnectionNotice.vue'
import HeaderSummary from '../components/HeaderSummary.vue'
import TrafficInsights from '../components/TrafficInsights.vue'
const monitor = useMonitor()
const homeMonitor = inject(monitorContext)
homeMonitor.value = monitor
onBeforeUnmount(() => { if (homeMonitor.value === monitor) homeMonitor.value = null })
const { records, summaries, liveSamples, busy, error, states, continueLive, pauseLive, reconnect } = monitor
const search = ref(''), group = ref(''), status = ref(''), sort = ref('default')
const layout = ref('grid'), charts = ref(true)
watch(backends, sources => { const opts = sources.find(s => s.config)?.config.theme_options || {}; layout.value = opts.layout === 'table' ? 'table' : 'grid'; charts.value = opts.show_card_charts !== false }, { immediate: true })
const groups = computed(() => [...new Set(records.value.map(s => s.server_group || '').filter(Boolean))])
const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  const items = records.value.filter(s => (!keyword || `${s.name} ${s.tags} ${s.os} ${s.region}`.toLowerCase().includes(keyword)) && (!group.value || s.server_group === group.value) && (!status.value || (status.value === 'online') === online(s)))
  if (sort.value === 'name') items.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  if (sort.value === 'cpu') items.sort((a, b) => Number(b.cpu || 0) - Number(a.cpu || 0))
  return items
})
const systemImage = server => {
  const os = osIcon(server.os)
  return os ? assetUrl(server._base, '/os-icons/os-' + (os === 'almalinux' ? 'alma' : os) + (os === 'alpine' ? '.webp' : '.svg')) : ''
}
const renewalDate = server => server._sys.show_expire === true ? expiryInfo(server.expire_date)?.date : null
const renewalPrice = server => {
  if (server._sys.show_price !== true || !String(server.price ?? '').trim()) return null
  if (['0', '-1'].includes(String(server.price))) return t('免费', 'Free')
  const cycles = { month: t('月', 'month'), year: t('年', 'year'), quarter: t('季', 'quarter'), day: t('天', 'day') }
  return (server.currency || '') + server.price + (server.billing_cycle ? '/' + (cycles[server.billing_cycle] || server.billing_cycle) : '')
}
</script>
<template>
  <ConnectionNotice :states="states" @continue="continueLive" @pause="pauseLive" @reconnect="reconnect" />
  <div v-if="error" class="notice error-text" role="alert">{{ error }}</div>
  <Teleport to="#header-summary">
  <HeaderSummary :records="records" :samples="liveSamples" :busy="busy" />
  </Teleport>
  <TrafficInsights :records="records" :samples="liveSamples" :states="states" />
  <section class="servers-panel">
    <div class="filterbar"><label class="search-box"><Icon name="Search" :size="15" /><input v-model="search" :placeholder="t('搜索名称、标签、系统…', 'Search name, tag, OS…')" :aria-label="t('搜索服务器', 'Search servers')" /><button v-if="search" class="clear-search" :aria-label="t('清空搜索', 'Clear search')" @click="search = ''"><Icon name="X" :size="13" /></button></label><select v-model="group" :aria-label="t('分组筛选', 'Filter group')"><option value="">{{ t('所有分组', 'All groups') }}</option><option v-for="g in groups" :key="g" :value="g">{{ g }}</option></select><select v-model="status" :aria-label="t('状态筛选', 'Filter status')"><option value="">{{ t('全部状态', 'All statuses') }}</option><option value="online">{{ t('在线', 'Online') }}</option><option value="offline">{{ t('离线', 'Offline') }}</option></select><span class="filter-spacer"></span><div class="segmented"><button :class="{ active: layout === 'grid' }" :aria-label="t('卡片视图', 'Grid view')" :aria-pressed="layout === 'grid'" @click="layout = 'grid'"><Icon name="LayoutGrid" :size="15" /></button><button :class="{ active: layout === 'table' }" :aria-label="t('表格视图', 'Table view')" :aria-pressed="layout === 'table'" @click="layout = 'table'"><Icon name="List" :size="15" /></button></div><select v-model="sort" :aria-label="t('排序', 'Sort')"><option value="default">{{ t('默认排序', 'Default order') }}</option><option value="name">{{ t('按名称排序', 'Name') }}</option><option value="cpu">{{ t('CPU 从高到低', 'CPU descending') }}</option></select></div>
    <div v-if="busy" class="empty"><span class="loading-dot"></span>{{ t('正在连接你的服务器…', 'Connecting to your servers…') }}</div>
    <div v-else-if="!filtered.length" class="empty"><Icon name="Server" :size="30" /><strong>{{ records.length ? t('没有匹配的服务器', 'No matching servers') : t('暂无服务器', 'No servers yet') }}</strong><p>{{ records.length ? t('试试其他关键词或筛选条件。', 'Try another search or filter.') : t('连接成功后，节点状态将在这里展示。', 'Node status will appear here when available.') }}</p><button v-if="records.length" @click="search = ''; group = ''; status = ''">{{ t('清除筛选', 'Clear filters') }}</button></div>
    <div v-else-if="layout === 'grid'" class="server-grid"><ServerCard v-for="server in filtered" :key="server._key" :server="server" :show-charts="charts" /></div>
    <div v-else class="table-wrap server-list-table"><table><thead><tr><th>{{ t('服务器', 'Server') }}</th><th>{{ t('系统', 'System') }}</th><th>{{ t('续期价格', 'Renewal') }}</th><th>CPU</th><th>{{ t('内存', 'Memory') }}</th><th>{{ t('磁盘', 'Storage') }}</th><th>↓ {{ t('下载', 'Download') }}</th><th>↑ {{ t('上传', 'Upload') }}</th><th></th></tr></thead><tbody><tr v-for="server in filtered" :key="server._key"><td><RouterLink :to="{ path: `/server/${encodeURIComponent(server.id)}`, query: { site: server._base } }"><ServerIdentity :server="server" :show-system="false" :show-status="false" /></RouterLink></td><td class="list-system"><span><img v-if="systemImage(server)" :src="systemImage(server)" alt="" />{{ server.os || '—' }} · {{ server.cpu_cores || '—' }} {{ t('核', 'cores') }}</span></td><td class="list-renewal"><time v-if="renewalDate(server)" :datetime="renewalDate(server)">{{ renewalDate(server) }}</time><span v-if="renewalDate(server) && renewalPrice(server)" class="renewal-divider">·</span><span v-if="renewalPrice(server)">{{ renewalPrice(server) }}</span><span v-if="!renewalDate(server) && !renewalPrice(server)">—</span></td><td>{{ pct(server.cpu) }}</td><td>{{ pct(percent(server.ram_used, server.ram_total)) }}</td><td>{{ pct(percent(server.disk_used, server.disk_total)) }}</td><td>{{ bytes(server.net_in_speed, true) }}</td><td>{{ bytes(server.net_out_speed, true) }}</td><td><RouterLink :to="{ path: `/server/${encodeURIComponent(server.id)}`, query: { site: server._base } }" :aria-label="t('查看详情', 'View details')"><Icon name="ChevronRight" :size="15" /></RouterLink></td></tr></tbody></table></div>
    <div class="panel-footnote"><span>{{ t('共', 'Showing') }} {{ filtered.length }} / {{ records.length }} {{ t('台服务器', 'servers') }}</span><span><Icon name="Activity" :size="12" />{{ t('WebSocket 实时同步', 'Live via WebSocket') }}</span></div>
  </section>
</template>
