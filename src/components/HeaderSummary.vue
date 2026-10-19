<script setup>
import { computed, shallowRef, watch } from 'vue'
import { bytes, numeric, online } from '../utils/metrics.js'
import { t } from '../composables/useTheme.js'
import Icon from './Icon.vue'
import MetricChart from './MetricChart.vue'
const props = defineProps({ records: Array, samples: Array, busy: Boolean })
const active = computed(() => props.records.filter(server => online(server)))
const nodeSpeed = server => (numeric(server.net_in_speed) ? Number(server.net_in_speed) : 0) + (numeric(server.net_out_speed) ? Number(server.net_out_speed) : 0)
const busiest = computed(() => active.value.filter(server => numeric(server.net_in_speed) || numeric(server.net_out_speed)).reduce((best, server) => !best || nodeSpeed(server) > nodeSpeed(best) ? server : best, null))
const speeds = computed(() => ({ down: props.records.reduce((sum, server) => sum + Number(server.net_in_speed || 0), 0), up: props.records.reduce((sum, server) => sum + Number(server.net_out_speed || 0), 0) }))
const monthly = computed(() => { const nodes = props.records.filter(server => server._sys.show_tf === true && numeric(server.net_rx_monthly) && numeric(server.net_tx_monthly)); return { count: nodes.length, down: nodes.reduce((sum, server) => sum + Number(server.net_rx_monthly), 0), up: nodes.reduce((sum, server) => sum + Number(server.net_tx_monthly), 0) } })
const trend = shallowRef([])
watch(() => props.samples, samples => {
  if (samples.some(sample => numeric(sample.data.net_in_speed) || numeric(sample.data.net_out_speed))) trend.value = [...trend.value, { timestamp: Date.now(), ...speeds.value }].slice(-30)
})
</script>
<template>
  <section class="summary-grid eight-summary compact-summary" :aria-label="t('资源汇总', 'Resource summary')">
    <div class="summary-card summary-total"><div class="summary-title"><span><Icon name="Server" />{{ t('节点总览', 'Node overview') }}</span><small class="summary-offline-count">{{ busy ? '—' : records.length - active.length }} {{ t('台离线', 'offline') }}</small></div><strong>{{ busy ? '—' : active.length }}<small>/ {{ busy ? '—' : records.length }}</small></strong></div>
    <div class="summary-card summary-busiest" :title="busiest?.name"><div class="summary-title"><span><Icon name="Activity" />{{ t('最忙节点', 'Busiest node') }}</span><small class="summary-busiest-name" :title="busiest?.name">{{ busiest?.name || '—' }}</small></div><strong :title="t('当前下载与上传速率之和', 'Current download + upload throughput')">{{ busy || !busiest ? '—' : bytes(nodeSpeed(busiest), true) }}</strong></div>
    <div class="summary-card summary-month"><div class="summary-title"><span><Icon name="Network" />{{ t('本月总流量', 'Monthly traffic') }}</span></div><strong>{{ busy || !monthly.count ? '—' : bytes(monthly.down + monthly.up) }}</strong><div class="summary-pair muted"><span>↓ {{ monthly.count ? bytes(monthly.down) : '—' }}</span><span>↑ {{ monthly.count ? bytes(monthly.up) : '—' }}</span></div></div>
    <div class="summary-card summary-speed"><div class="summary-title"><span><Icon name="Activity" />{{ t('实时网速', 'Live network') }}</span></div><div class="summary-pair"><b>↓ {{ busy ? '—' : bytes(speeds.down, true) }}</b><b>↑ {{ busy ? '—' : bytes(speeds.up, true) }}</b></div><MetricChart :rows="trend" :series="[{ key: 'down', label: t('下载', 'Download'), color: 'var(--ink)' }, { key: 'up', label: t('上传', 'Upload'), color: 'var(--muted)' }]" unit="B/s" compact filled /></div>
  </section>
</template>
