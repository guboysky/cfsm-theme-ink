<script setup>
import { computed, ref, inject, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { monitorContext } from '../composables/monitorContext.js'
import { useSharedDetail } from '../composables/useSharedDetail.js'
import { useMonitor } from '../composables/useMonitor.js'
import { security } from '../utils/http.js'
import { t } from '../composables/useTheme.js'
import { pct, gpu, present, LANES, laneName, online, osIcon } from '../utils/metrics.js'
import { assetUrl } from '../utils/config.js'
import Icon from '../components/Icon.vue'
import MachineOverview from '../components/MachineOverview.vue'
import MetricChart from '../components/MetricChart.vue'
import LatencyMonitor from '../components/LatencyMonitor.vue'
import ConnectionNotice from '../components/ConnectionNotice.vue'
import IpQuality from '../components/IpQuality.vue'
const props = defineProps({ id: String })
const route = useRoute()
const homeMonitor = inject(monitorContext)
const router = useRouter()
const shared = homeMonitor?.value
const { records, rows, hours, busy, historyBusy, error, states, continueLive, pauseLive, reconnect, changeHours } = shared ? useSharedDetail(shared, props.id, route.query.site) : useMonitor({ id: props.id, base: route.query.site })
const dialog = ref(null), expanded = ref(false), activeView = ref('latency')
const detailTabs = computed(() => [['latency', t('延迟监控', 'Latency monitoring')], ['machine', t('机器信息', 'Machine information')], ['quality', t('IP 质量', 'IP quality')]])
const viewLabel = computed(() => detailTabs.value.find(tab => tab[0] === activeView.value)?.[1])
function switchTab(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const index = detailTabs.value.findIndex(tab => tab[0] === activeView.value)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? detailTabs.value.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + detailTabs.value.length) % detailTabs.value.length
  activeView.value = detailTabs.value[next][0]
  nextTick(() => dialog.value?.querySelector('[role=tab][aria-selected=true]')?.focus())
}
const previousFocus = document.activeElement
const previousOverflow = document.body.style.overflow
const previousPadding = document.body.style.paddingRight
function close() { if (shared) router.back(); else router.replace('/') }
function keyboard(event) {
  if (security.challenge) return
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key !== 'Tab') return
  const controls = [...(dialog.value?.querySelectorAll('button, a[href], select, input, summary, [tabindex="0"]') || [])].filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length)
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first?.focus() }
}
onMounted(() => {
  const gutter = window.innerWidth - document.documentElement.clientWidth
  document.body.style.overflow = 'hidden'
  if (gutter) document.body.style.paddingRight = String(gutter) + 'px'
  dialog.value?.focus()
  document.addEventListener('keydown', keyboard)
})
onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow
  document.body.style.paddingRight = previousPadding
  document.removeEventListener('keydown', keyboard)
  nextTick(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
})
const server = computed(() => records.value[0])
const systemImage = computed(() => {
  const os = osIcon(server.value?.os)
  return os ? assetUrl(server.value._base, '/os-icons/os-' + (os === 'almalinux' ? 'alma' : os) + (os === 'alpine' ? '.webp' : '.svg')) : ''
})
const ranges = computed(() => [[0.167, t('10 分钟', '10 min')], [0.5, t('30 分钟', '30 min')], [1, t('1 小时', '1 hour')], [6, t('6 小时', '6 hours')], [12, t('12 小时', '12 hours')], [24, t('24 小时', '24 hours')], [48, t('2 天', '2 days')], [96, t('4 天', '4 days')], [168, t('7 天', '7 days')]])
const pingSeries = computed(() => LANES.map(lane => ({ key: `ping_${lane}`, label: laneName(server.value?._config || {}, lane, t) })).filter(s => present(server.value?.[s.key]) || rows.value.some(row => present(row[s.key]))))
const lossSeries = computed(() => LANES.map(lane => ({ key: `loss_${lane}`, label: laneName(server.value?._config || {}, lane, t) })).filter(s => present(server.value?.[s.key]) || rows.value.some(row => present(row[s.key]))))
const gpuSeries = computed(() => [...new Map([...gpu(server.value?.gpu_info), ...rows.value.flatMap(row => gpu(row.gpu_info))].map(device => [device.id, device])).values()].map(device => ({ key: `gpu_${device.id}`, label: device.name, get: row => gpu(row.gpu_info).find(g => g.id === device.id)?.info })))
const hasDisk = computed(() => server.value?.disk || rows.value.some(row => row.disk && typeof row.disk === 'object'))
</script>
<template>
  <Teleport to="body"><div class="detail-overlay" @click.self="close"><section ref="dialog" class="detail-dialog" :class="{ expanded }" role="dialog" aria-modal="true" aria-labelledby="detail-dialog-title" tabindex="-1">
    <div class="detail-dialog-toolbar"><div class="dialog-title-block"><img v-if="server && /^[a-z]{2}$/i.test(server.region || '')" class="dialog-region-flag" :src="assetUrl(server._base, '/flags/' + server.region.toLowerCase() + '.svg')" :alt="server.region" /><Icon v-else name="Globe" :size="18" /><div class="dialog-title-copy"><h2 id="detail-dialog-title">{{ server?.name || t('节点详情', 'Server details') }} · {{ viewLabel }}</h2><div v-if="server" class="dialog-machine-summary"><img v-if="systemImage" :src="systemImage" alt="" /><span>{{ server.os || '—' }} · {{ server.cpu_cores || '—' }} {{ t('核', 'cores') }}</span><span>{{ server.ip_v4 === '1' ? 'IPv4' : '' }} {{ server.ip_v6 === '1' ? 'IPv6' : '' }}</span><span>{{ t('进程', 'Processes') }} {{ server.processes ?? '—' }} · TCP {{ server.tcp_conn ?? '—' }} · UDP {{ server.udp_conn ?? '—' }}</span><span v-if="server._sys.show_price === true && String(server.price ?? '').trim()">{{ ['0', '-1'].includes(String(server.price)) ? t('免费', 'Free') : (server.currency || '') + server.price + ' / ' + (server.billing_cycle || '') }}</span></div></div></div><div class="dialog-window-tools"><span v-if="server" class="dialog-online-status" :class="{ offline: !online(server) }"><i></i>{{ online(server) ? t('在线', 'Online') : t('离线', 'Offline') }}</span><button class="icon-button" :aria-label="expanded ? t('还原窗口', 'Restore window') : t('放大窗口', 'Expand window')" @click="expanded = !expanded"><Icon :name="expanded ? 'Minimize2' : 'Maximize2'" :size="15" /></button><button class="icon-button back-link" :aria-label="t('关闭详情弹窗', 'Close server details')" @click="close"><Icon name="X" :size="18" /></button></div></div>
    <div class="detail-dialog-content">
  <ConnectionNotice :states="states" @continue="continueLive" @pause="pauseLive" @reconnect="reconnect" />
  <div v-if="error" class="notice error-text" role="alert">{{ error }}</div>
  <div v-if="busy" class="empty">{{ t('正在读取节点状态…', 'Loading server status…') }}</div>
  <template v-else-if="server">
    <div class="detail-view-switch">
      <div role="tablist" :aria-label="t('节点信息切换', 'Server views')" @keydown="switchTab"><button v-for="[key, label] in detailTabs" :id="key + '-tab'" :key="key" role="tab" :aria-controls="key + '-panel'" :aria-selected="activeView === key" :tabindex="activeView === key ? 0 : -1" @click="activeView = key">{{ label }}</button></div>
      <div v-show="activeView !== 'quality'" class="detail-range-tools"><div class="detail-range-presets"><button v-for="value in [1, 6, 12, 24, 168]" :key="value" :class="{ selected: hours === value }" :aria-pressed="hours === value" :disabled="historyBusy" @click="changeHours(value)">{{ ranges.find(range => range[0] === value)?.[1] }}</button></div><label class="range-label"><Icon name="Clock" :size="14" /><select :value="hours" :disabled="historyBusy" :aria-label="t('历史时间范围', 'History range')" @change="changeHours(Number($event.target.value))"><option v-for="[value, label] in ranges" :key="value" :value="value">{{ label }}</option></select><span v-if="historyBusy">{{ t('读取中…', 'Loading…') }}</span></label></div>
    </div>
    <section v-show="activeView === 'quality'" id="quality-panel" role="tabpanel" aria-labelledby="quality-tab"><IpQuality :server="server" /></section>
    <section v-show="activeView === 'latency'" id="latency-panel" role="tabpanel" aria-labelledby="latency-tab"><LatencyMonitor :server="server" :rows="rows" /></section>
    <section v-show="activeView === 'machine'" id="machine-panel" role="tabpanel" aria-labelledby="machine-tab">
    <MachineOverview :server="server" :rows="rows" />
    <div class="charts-grid machine-charts">
      <section class="chart-panel"><h3>{{ t('CPU 使用率', 'CPU usage') }}<span>{{ pct(server.cpu) }}</span></h3><MetricChart :rows="rows" :series="[{ key: 'cpu', label: 'CPU', color: '#35896c' }]" filled /></section>
      <section class="chart-panel"><h3>{{ t('内存与 Swap', 'Memory & swap') }}</h3><MetricChart :rows="rows" :series="[{ key: 'ram', label: t('内存', 'Memory'), color: '#558bca', get: row => row.ram_used == null ? undefined : row.ram_used * 1048576 }, { key: 'swap', label: 'Swap', get: row => row.swap_used == null ? undefined : row.swap_used * 1048576 }]" unit="B" :max-value="Number(server.ram_total) * 1048576 || undefined" filled /></section>
      <section class="chart-panel"><h3>{{ t('网络速率', 'Network throughput') }}</h3><MetricChart :rows="rows" :series="[{ key: 'net_in_speed', label: t('下载', 'Download') }, { key: 'net_out_speed', label: t('上传', 'Upload') }]" unit="B/s" filled /></section>
      <section v-if="hasDisk" class="chart-panel"><h3>{{ t('磁盘 IO', 'Disk IO') }}</h3><MetricChart :rows="rows" :series="[{ key: 'read', label: t('读取', 'Read'), get: row => row.disk?.read_bps }, { key: 'write', label: t('写入', 'Write'), get: row => row.disk?.write_bps }]" unit="B/s" /></section>
      <section v-if="pingSeries.length" class="chart-panel"><h3>{{ t('网络延时', 'Network latency') }}</h3><MetricChart :rows="rows" :series="pingSeries" unit="ms" /></section>
      <section v-if="lossSeries.length" class="chart-panel"><h3>{{ t('网络丢包', 'Packet loss') }}</h3><MetricChart :rows="rows" :series="lossSeries" unit="%" /></section>
      <section v-if="gpuSeries.length" class="chart-panel"><h3>{{ t('GPU 使用率', 'GPU usage') }}</h3><MetricChart :rows="rows" :series="gpuSeries" /></section>
    </div>

    </section>
  </template>
    </div></section></div></Teleport>
</template>
