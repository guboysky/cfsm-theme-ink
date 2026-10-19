<script setup>
import { computed, shallowRef, ref, watch } from 'vue'
import { bytes, numeric, online } from '../utils/metrics.js'
import { TrafficSession, rankedNodes, distribution } from '../utils/traffic.js'
import { t } from '../composables/useTheme.js'
import ExpiryRanking from './ExpiryRanking.vue'
import Icon from './Icon.vue'

const props = defineProps({ records: Array, samples: Array, states: Object })
const session = new TrafficSession()
const events = shallowRef([])
const node = ref(''), direction = ref('down'), range = ref(10), rankingMetric = ref('net_in_speed')
const hovered = ref(null)
const colors = ['#d8775c', '#558bca', '#35896c', '#dfbd61', '#9c8aba', '#87b4b7']
const trafficField = computed(() => direction.value === 'down' ? 'net_rx' : 'net_tx')
const trafficRecords = computed(() => props.records.filter(server => server._sys.show_tf === true))
const showTraffic = computed(() => trafficRecords.value.length > 0)
const showExpiry = computed(() => props.records.some(server => server._sys.show_expire === true))
const byteField = computed(() => direction.value === 'down' ? 'downBytes' : 'upBytes')
const trafficRank = computed(() => rankedNodes(trafficRecords.value, trafficField.value))
const speedRank = computed(() => rankedNodes(props.records.filter(s => online(s)), rankingMetric.value))
const flow = computed(() => distribution(trafficRank.value))
const speedTotal = computed(() => speedRank.value.reduce((sum, item) => sum + item.value, 0))
const recent = computed(() => {
  const cutoff = (events.value.at(-1)?.timestamp || Date.now()) - range.value * 60000
  const bins = new Map()
  for (const event of events.value) {
    if (event.timestamp < cutoff || (node.value && event.key !== node.value) || !numeric(event[byteField.value])) continue
    const timestamp = Math.floor(event.timestamp / 10000) * 10000
    bins.set(timestamp, (bins.get(timestamp) || 0) + event[byteField.value])
  }
  return [...bins].sort(([a], [b]) => a - b).map(([timestamp, value]) => ({ timestamp, value }))
})
const barMax = computed(() => Math.max(1, ...recent.value.map(row => row.value)))
const barSpan = computed(() => Math.max(10000, (recent.value.at(-1)?.timestamp || 0) - (recent.value[0]?.timestamp || 0) + 10000))
const sessionTotal = computed(() => recent.value.reduce((sum, row) => sum + row.value, 0))
const time = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const nodeLink = item => ({ path: `/server/${encodeURIComponent(item.id)}`, query: { site: item.base } })
const ringSegments = computed(() => {
  let offset = 0
  return flow.value.slices.map((item, index) => {
    const result = { ...item, color: colors[index], offset, length: item.percent }
    offset += item.percent
    return result
  })
})
watch(() => props.states, (states, previous = {}) => {
  for (const base of new Set([...Object.keys(previous), ...Object.keys(states)])) if (states[base] !== 'live') session.disconnect(base)
})
watch(() => props.samples, samples => {
  if (!samples.length) return
  const allowed = new Set(trafficRecords.value.map(server => server._key))
  session.push(samples.filter(sample => allowed.has(sample.key)))
  events.value = [...session.events]
}, { flush: 'post' })
</script>

<template>
  <section class="traffic-insights" :class="{ 'no-traffic': !showTraffic }" :aria-label="t('流量与节点排行', 'Traffic and node rankings')">
    <div v-if="showTraffic" class="insight-top">
      <section v-if="showTraffic" class="insight-panel traffic-trend">
        <div class="insight-heading"><div><h2>{{ t('流量趋势', 'Traffic trend') }}</h2><p>{{ t('本次会话已观测', 'Observed this session') }} {{ recent.length ? bytes(sessionTotal) : '—' }} · {{ t('实际上报流量', 'Reported traffic') }}</p></div><div class="insight-controls"><select v-model="node" :aria-label="t('图表节点', 'Chart node')"><option value="">{{ t('全部节点', 'All nodes') }}</option><option v-for="server in records" :key="server._key" :value="server._key">{{ server.name || server.id }}</option></select><select v-model="direction" :aria-label="t('流量方向', 'Traffic direction')"><option value="down">{{ t('下载流量', 'Download traffic') }}</option><option value="up">{{ t('上传流量', 'Upload traffic') }}</option></select><select v-model.number="range" :aria-label="t('会话时间范围', 'Session range')"><option :value="10">{{ t('最近 10 分钟', 'Last 10 min') }}</option><option :value="30">{{ t('最近 30 分钟', 'Last 30 min') }}</option></select></div></div>
        <div v-if="recent.length" class="traffic-bars">
          <div class="traffic-axis"><span>{{ bytes(barMax) }}</span><span>{{ bytes(barMax / 2) }}</span><span>0 B</span></div>
          <div class="traffic-bar-plot"><svg viewBox="0 0 600 155" preserveAspectRatio="none" role="img" :aria-label="t('会话流量柱状图', 'Session traffic bar chart')" @mouseleave="hovered = null"><path d="M0 10H600M0 72H600M0 135H600" stroke="var(--line)" stroke-dasharray="3 5" /><rect v-for="row in recent" :key="row.timestamp" :x="(row.timestamp - recent[0].timestamp) / barSpan * 600 + 2" :y="135 - row.value / barMax * 125" :width="Math.min(48, Math.max(1, 10000 / barSpan * 600 - 5))" :height="Math.max(1, row.value / barMax * 125)" fill="var(--accent)" @mouseenter="hovered = row" /></svg><div class="chart-times"><span>{{ time(recent[0].timestamp) }}</span><span>{{ time(recent.at(-1).timestamp) }}</span></div><div v-if="hovered" class="chart-tooltip"><b>{{ time(hovered.timestamp) }}</b>{{ bytes(hovered.value) }}</div></div>
        </div>
        <div v-else class="insight-empty"><Icon name="Activity" :size="24" /><span>{{ t('等待连续两次流量上报', 'Waiting for two traffic counter reports') }}</span><small>{{ t('开始采样后展示本次会话趋势', 'Session trends appear after sampling starts') }}</small></div>
        <p class="insight-note">{{ t('仅记录本次会话，每 10 秒归集一次；断线、计数重置与缺失上报不补算。', 'Session data grouped every 10 seconds; no estimates across gaps or resets.') }}</p>
        <details v-if="recent.length" class="traffic-details"><summary>{{ t('采样明细', 'Sample details') }}</summary><div class="traffic-detail-scroll"><table><thead><tr><th>{{ t('归集时间', 'Grouped time') }}</th><th>{{ direction === 'down' ? t('下载增量', 'Download delta') : t('上传增量', 'Upload delta') }}</th></tr></thead><tbody><tr v-for="row in [...recent].reverse()" :key="row.timestamp"><td>{{ time(row.timestamp) }}</td><td>{{ bytes(row.value) }}</td></tr></tbody></table></div></details>
      </section>
      <section v-if="showTraffic" class="insight-panel flow-panel"><div class="insight-heading"><div><h2>{{ t('流量分布', 'Traffic distribution') }}</h2><p>{{ direction === 'down' ? t('按节点 · 累计下载流量', 'By node · total download') : t('按节点 · 累计上传流量', 'By node · total upload') }}</p></div></div><div class="traffic-donut"><svg viewBox="0 0 120 120" role="img" :aria-label="t('节点流量占比', 'Node traffic shares')"><circle cx="60" cy="60" r="48" fill="none" stroke="var(--soft)" stroke-width="14" /><circle v-for="slice in ringSegments" :key="slice.key" cx="60" cy="60" r="48" pathLength="100" fill="none" :stroke="slice.color" stroke-width="14" :stroke-dasharray="`${slice.length} ${100 - slice.length}`" :stroke-dashoffset="-slice.offset" transform="rotate(-90 60 60)" /></svg><div><small>{{ t('累计流量', 'Total traffic') }}</small><strong>{{ bytes(flow.total) }}</strong></div></div><div class="flow-legend"><div v-for="slice in ringSegments" :key="slice.key"><i :style="{ background: slice.color }"></i><span>{{ slice.other ? t('其他节点', 'Other nodes') : slice.name }}</span><b>{{ bytes(slice.value) }}</b><small>{{ slice.percent.toFixed(1) }}%</small></div><p v-if="!ringSegments.length" class="rank-empty">{{ t('暂无可分配的流量', 'No traffic to distribute') }}</p></div></section>
    </div>
    <div class="insight-bottom" :class="{ 'without-expiry': !showExpiry }">
      <section v-if="showTraffic" class="insight-panel"><div class="insight-heading"><div><h2>{{ t('节点流量排行', 'Node traffic ranking') }}</h2></div></div><div class="rank-head"><span>{{ t('名称', 'Name') }}</span><span>{{ t('累计流量', 'Total traffic') }}</span></div><RouterLink v-for="(item, index) in trafficRank.slice(0, 5)" :key="item.key" :to="nodeLink(item)" class="insight-rank-row"><span class="rank-title"><i>{{ index + 1 }}</i><b>{{ item.name }}</b></span><span class="rank-track"><i :style="{ width: `${trafficRank[0]?.value ? item.value / trafficRank[0].value * 100 : 0}%` }"></i></span><strong>{{ bytes(item.value) }}</strong></RouterLink><div v-if="!trafficRank.length" class="rank-empty">{{ t('暂无流量数据', 'No traffic data') }}</div><div class="rank-footer"><span>{{ t('前', 'Top') }} {{ Math.min(5, trafficRank.length) }} / {{ trafficRank.length }}</span><span>{{ t('合计', 'Total') }} {{ bytes(flow.total) }}</span></div></section>
      <section class="insight-panel"><div class="insight-heading"><div><h2>{{ t('节点实时排行', 'Live node ranking') }}</h2></div><select v-model="rankingMetric" :aria-label="t('实时排行指标', 'Live ranking metric')"><option value="net_in_speed">{{ t('下载速率', 'Download rate') }}</option><option value="net_out_speed">{{ t('上传速率', 'Upload rate') }}</option></select></div><div class="rank-head"><span>{{ t('名称', 'Name') }}</span><span>{{ t('实时速度', 'Live speed') }}</span></div><RouterLink v-for="(item, index) in speedRank.slice(0, 5)" :key="item.key" :to="nodeLink(item)" class="insight-rank-row speed-rank"><span class="rank-title"><i>{{ index + 1 }}</i><b>{{ item.name }}</b></span><span class="rank-track"><i :style="{ width: `${speedRank[0]?.value ? item.value / speedRank[0].value * 100 : 0}%` }"></i></span><strong>{{ bytes(item.value, true) }}</strong></RouterLink><div v-if="!speedRank.length" class="rank-empty">{{ t('暂无在线节点', 'No online nodes') }}</div><div class="rank-footer"><span>{{ t('前', 'Top') }} {{ Math.min(5, speedRank.length) }} / {{ speedRank.length }}</span><span>{{ t('合计', 'Total') }} {{ bytes(speedTotal, true) }}</span></div></section>
      <ExpiryRanking v-if="showExpiry" :records="records" />
    </div>
  </section>
</template>
