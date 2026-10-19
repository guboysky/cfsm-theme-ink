<script setup>
import { useRouter } from 'vue-router'
import { computed } from 'vue'
import { bytes, percent, numeric, present, laneName, LANES, online, osIcon } from '../utils/metrics.js'
import { expiryInfo, uptime, trafficAllowance, monthlyTraffic, segmentState, cardProbePoints } from '../utils/serverPresentation.js'
import { assetUrl } from '../utils/config.js'
import { t } from '../composables/useTheme.js'
import Icon from './Icon.vue'
const props = defineProps({ server: Object, showCharts: Boolean })
const router = useRouter()
const detailTarget = computed(() => ({ path: `/server/${encodeURIComponent(props.server.id)}`, query: { site: props.server._base } }))
const isOnline = computed(() => online(props.server))
const running = computed(() => uptime(props.server.boot_time))
const expiry = computed(() => expiryInfo(props.server.expire_date))
const systemIcon = computed(() => {
  const os = osIcon(props.server.os)
  return os ? assetUrl(props.server._base, `/os-icons/os-${os === 'almalinux' ? 'alma' : os}.${os === 'alpine' ? 'webp' : 'svg'}`) : null
})
const allowance = computed(() => trafficAllowance(props.server.traffic_limit))
const usedTraffic = computed(() => monthlyTraffic(props.server))
const trafficPercent = computed(() => Number.isFinite(allowance.value) ? percent(usedTraffic.value, allowance.value) : null)
const mb = value => numeric(value) ? bytes(Number(value) * 1048576) : '—'
const formatPercent = value => numeric(value) ? `${Number(Number(value).toFixed(1))}%` : '—'
const resources = computed(() => [
  { key: 'cpu', label: `CPU ${props.server.cpu_cores || '—'} ${t('核', 'cores')}`, value: numeric(props.server.cpu) ? Number(props.server.cpu) : null, detail: props.server.load_avg || '—' },
  { key: 'memory', label: t('内存', 'Memory'), value: percent(props.server.ram_used, props.server.ram_total), detail: `${mb(props.server.ram_used)} / ${mb(props.server.ram_total)}` },
  { key: 'disk', label: t('磁盘', 'Storage'), value: percent(props.server.disk_used, props.server.disk_total), detail: `${mb(props.server.disk_used)} / ${mb(props.server.disk_total)}` },
  ...(props.server._sys.show_tf === true ? [{ key: 'traffic', label: t('流量', 'Traffic'), value: trafficPercent.value, unlimited: allowance.value === Infinity, detail: `${bytes(usedTraffic.value)} / ${allowance.value === Infinity ? '∞' : bytes(allowance.value)}` }] : [])
])
const lanes = computed(() => LANES.filter(lane => {
  const ping = props.server[`ping_${lane}`], loss = props.server[`loss_${lane}`]
  if (ping !== undefined || loss !== undefined) return present(ping) || present(loss)
  return [...(props.server.ping || []), ...(props.server.loss || [])].some(point => present(point[lane]))
}))
const price = computed(() => {
  const value = String(props.server.price ?? '').trim()
  return !value ? '' : ['0', '-1'].includes(value) ? t('免费', 'Free') : `${props.server.currency || ''}${value} / ${props.server.billing_cycle || ''}`
})
const pointValue = (lane, type) => {
  const value = props.server[`${type}_${lane}`]
  return value !== undefined ? value : props.server[type]?.findLast(point => present(point[lane]))?.[lane]
}
const points = (lane, type) => props.server[`${type}_${lane}`] === false ? [] : cardProbePoints(props.server[type], lane)
const probeText = (value, unit) => value === null ? t('超时', 'Timeout') : numeric(value) ? `${value}${unit}` : '—'
function expiryText(info) {
  if (info.days < 0) return t(`已到期 ${Math.abs(info.days)} 天`, `Expired ${Math.abs(info.days)}d ago`)
  if (info.days === 0) return t('今天到期', 'Expires today')
  return t(`${info.days} 天后到期`, `Expires in ${info.days}d`)
}
</script>

<template>
  <div class="server-card reference-card">
    <div class="card-corner-tools"><span class="card-status" :class="{ offline: !isOnline }"><i></i>{{ isOnline ? t('在线', 'Online') : t('离线', 'Offline') }}</span><button class="card-popup-button" :aria-label="t('打开节点详情弹窗', 'Open server details')" :title="t('打开节点详情弹窗', 'Open server details')" @click="router.push(detailTarget)"><Icon name="Expand" :size="13" /></button></div>
    <RouterLink :to="detailTarget" class="card-main-link" aria-haspopup="dialog">
    <div class="reference-card-heading">
      <img v-if="/^[a-z]{2}$/i.test(server.region || '')" class="reference-flag" :src="assetUrl(server._base, `/flags/${server.region.toLowerCase()}.svg`)" :alt="server.region" />
      <Icon v-else name="Globe" :size="20" />
      <img v-if="systemIcon" class="reference-os" :src="systemIcon" :alt="server.os" :title="server.os" />
      <strong :title="server.name || server.id">{{ server.name || server.id }}</strong>
    </div>
    <div class="reference-badges">
      <span class="uptime-badge" :class="{ offline: !isOnline }"><i></i>{{ isOnline ? t('在线', 'Online') : t('离线', 'Offline') }}<template v-if="isOnline && running"> {{ t(`${running.days} 天 ${running.hours} 小时`, `${running.days}d ${running.hours}h`) }}</template></span>
      <span v-if="server._sys.show_expire === true && expiry" class="expiry-badge" :class="{ urgent: expiry.days <= 7 }">{{ expiryText(expiry) }}</span>
      <span v-if="server._sys.show_price === true && price" class="price-badge">{{ price }}</span>
    </div>
    <div class="reference-resources">
      <div v-for="resource in resources" :key="resource.key" class="reference-resource" :data-resource="resource.key">
        <div class="reference-resource-heading"><span>{{ resource.label }}</span><b>{{ resource.unlimited ? '∞' : formatPercent(resource.value) }}</b></div>
        <div class="reference-meter"><i :style="{ width: `${numeric(resource.value) ? Math.min(100, Math.max(0, resource.value)) : 0}%` }"></i></div>
        <small>{{ resource.detail }}</small>
      </div>
    </div>
    <div class="reference-network">
      <div class="network-download"><div class="network-current"><span><Icon name="ArrowDownLeft" :size="12" />{{ t('下载', 'Download') }}</span><strong>{{ bytes(server.net_in_speed, true) }}</strong></div><small v-if="server._sys.show_tf === true"><span>{{ t('累计', 'Total') }}</span><b>{{ bytes(server.net_rx) }}</b></small></div>
      <div class="network-upload"><div class="network-current"><span><Icon name="ArrowUpRight" :size="12" />{{ t('上传', 'Upload') }}</span><strong>{{ bytes(server.net_out_speed, true) }}</strong></div><small v-if="server._sys.show_tf === true"><span>{{ t('累计', 'Total') }}</span><b>{{ bytes(server.net_tx) }}</b></small></div>
    </div>
    <div v-if="server._sys.show_three_net_details === true && lanes.length" class="reference-probes" data-hours="1" :aria-label="t('最近 1 小时延迟与丢包', 'Latency and loss over the last hour')">
      <div v-for="lane in lanes" :key="lane" class="reference-probe" :data-lane="lane">
        <div class="probe-heading"><span>{{ laneName(server._config, lane, t) }}</span><b v-if="present(pointValue(lane, 'ping'))" :class="'probe-' + segmentState(pointValue(lane, 'ping'), 'ping')">{{ probeText(pointValue(lane, 'ping'), ' ms') }}</b><small v-if="present(pointValue(lane, 'loss'))" :class="'probe-' + segmentState(pointValue(lane, 'loss'), 'loss')">{{ probeText(pointValue(lane, 'loss'), '%') }} {{ t('丢包', 'loss') }}</small></div>
        <div v-if="showCharts && (points(lane, 'ping').some(point => present(point.value)) || points(lane, 'loss').some(point => present(point.value)))" class="probe-segments">
          <div><span v-for="(point, index) in points(lane, 'ping')" :key="point.ts + ':' + index" :class="'segment-' + segmentState(point.value, 'ping')" :title="laneName(server._config, lane, t) + ' · ' + probeText(point.value, ' ms')"></span></div>
          <div><span v-for="(point, index) in points(lane, 'loss')" :key="point.ts + ':' + index" :class="'segment-' + segmentState(point.value, 'loss')" :title="laneName(server._config, lane, t) + ' · ' + probeText(point.value, '%')"></span></div>
        </div>
      </div>
    </div>
    </RouterLink>
  </div>
</template>
