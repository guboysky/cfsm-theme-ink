<script setup>
import { computed } from 'vue'
import { bytes, numeric, percent, pct } from '../utils/metrics.js'
import { expiryInfo, uptime, monthlyTraffic, trafficAllowance } from '../utils/serverPresentation.js'
import { t } from '../composables/useTheme.js'
import ResourceRing from './ResourceRing.vue'
import MetricChart from './MetricChart.vue'
import Icon from './Icon.vue'
const props = defineProps({ server: Object, rows: { type: Array, default: () => [] } })
const mb = value => numeric(value) ? bytes(Number(value) * 1048576) : '—'
const date = value => {
  if (!numeric(value) || Number(value) <= 0) return '—'
  const parsed = new Date(Number(value) < 1e11 ? Number(value) * 1000 : Number(value))
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString([], { hour12: false }) : '—'
}
const ram = computed(() => percent(props.server.ram_used, props.server.ram_total))
const swap = computed(() => percent(props.server.swap_used, props.server.swap_total))
const disk = computed(() => percent(props.server.disk_used, props.server.disk_total))
const allowance = computed(() => trafficAllowance(props.server.traffic_limit))
const quota = computed(() => Number.isFinite(allowance.value) ? percent(monthlyTraffic(props.server), allowance.value) : null)
const rate = computed(() => numeric(props.server.net_in_speed) && numeric(props.server.net_out_speed) ? (Number(props.server.net_in_speed) + Number(props.server.net_out_speed)) * 8 / 1000000 : null)
const downShare = computed(() => rate.value > 0 ? Number(props.server.net_in_speed) / (Number(props.server.net_in_speed) + Number(props.server.net_out_speed)) * 100 : rate.value === 0 ? 0 : null)
const available = computed(() => numeric(props.server.ram_total) && numeric(props.server.ram_used) ? Math.max(0, Number(props.server.ram_total) - Number(props.server.ram_used)) : null)
const fields = computed(() => {
  const s = props.server, running = uptime(s.boot_time), expiry = expiryInfo(s.expire_date), allowance = trafficAllowance(s.traffic_limit)
  const items = [
    ['Clock', t('运行时间', 'Uptime'), running ? t(`${running.days} 天 ${running.hours} 小时`, `${running.days}d ${running.hours}h`) : '—'],
    ...(s._sys.show_expire === true ? [['CalendarDays', t('剩余时间', 'Time remaining'), expiry ? expiry.days < 0 ? t(`已到期 ${Math.abs(expiry.days)} 天`, `Expired ${Math.abs(expiry.days)}d ago`) : t(`${expiry.days} 天`, `${expiry.days} days`) : '—']] : []),
    ['Server', t('操作系统 / 架构', 'OS / architecture'), `${s.os || '—'} / ${s.arch || '—'}`],
    ['Layers', t('内核版本', 'Kernel'), s.kernel_version || '—'],
    ['Cpu', t('CPU 信息', 'CPU information'), `${s.cpu_info || '—'} · ${s.cpu_cores || '—'} ${t('核', 'cores')}`],
    ['HardDrive', t('总磁盘 / 内存', 'Storage / memory'), `${mb(s.disk_total)} / ${mb(s.ram_total)}`],
    ['Activity', t('负载均值', 'Load average'), s.load_avg || '—'],
    ...(s._sys.show_tf === true ? [['Globe', t('总流量', 'Total traffic'), `↓ ${bytes(s.net_rx)} / ↑ ${bytes(s.net_tx)}`]] : []),
    ['Network', t('实时速度', 'Live throughput'), `↓ ${bytes(s.net_in_speed, true)} / ↑ ${bytes(s.net_out_speed, true)}`],
    ...(s._sys.show_tf === true ? [
      ['Network', t('月流量', 'Monthly traffic'), `↓ ${bytes(s.net_rx_monthly)} / ↑ ${bytes(s.net_tx_monthly)}`],
      ['HardDrive', t('月流量限制', 'Monthly allowance'), `${bytes(monthlyTraffic(s))} / ${allowance === Infinity ? '∞' : bytes(allowance)}`]
    ] : []),
    ['Clock', t('启动时间', 'Boot time'), date(s.boot_time)],
    ['Clock', t('最后更新', 'Last update'), date(s.last_updated)],
    ['Server', t('Agent 版本', 'Agent version'), s.agent_version || '—']

  ]

  return items
})
</script>
<template>
  <section class="machine-overview resource-overview">
    <div class="resource-cards detail-metrics">
      <section class="resource-card resource-cpu" style="--resource-color:#558bdf"><div class="resource-card-title"><span><i><Icon name="Cpu" :size="16" /></i>{{ t('处理器', 'Processor') }}</span><small>{{ server.cpu_cores || '—' }} {{ t('核心', 'cores') }}</small></div><div class="resource-card-body"><div><strong>{{ pct(server.cpu) }}</strong><p :title="server.cpu_info">{{ server.cpu_info || '—' }}</p></div><ResourceRing :value="numeric(server.cpu) ? Number(server.cpu) : undefined" text="CPU" color="#558bdf" :label="'CPU ' + pct(server.cpu)" /></div><div class="resource-card-bottom"><div><span>{{ t('所选时段', 'Selected range') }}</span><span>Load {{ server.load_avg || '—' }}</span></div><MetricChart :rows="rows" :series="[{ key: 'cpu', label: 'CPU', color: '#558bdf' }]" compact filled /></div></section>
      <section class="resource-card resource-ram" style="--resource-color:#558bdf"><div class="resource-card-title"><span><i><Icon name="MemoryStick" :size="16" /></i>{{ t('内存', 'Memory') }}</span><small>{{ t('总量', 'Total') }} {{ mb(server.ram_total) }}</small></div><div class="resource-card-body"><div><strong>{{ pct(ram) }}<small>RAM</small></strong><p>{{ t('已用', 'Used') }} {{ mb(server.ram_used) }}</p><p class="resource-swap">Swap {{ pct(swap) }} · {{ mb(server.swap_used) }} / {{ mb(server.swap_total) }}</p></div><ResourceRing :value="ram ?? undefined" :secondary="swap ?? undefined" text="RAM" color="#558bdf" :label="'RAM ' + pct(ram) + ' / Swap ' + pct(swap)" /></div><div class="resource-card-bottom"><div><span>{{ t('所选时段', 'Selected range') }}</span><span>{{ t('可用', 'Available') }} {{ mb(available) }}</span></div><MetricChart :rows="rows" :series="[{ key: 'ram', label: 'RAM', color: '#a477df', get: row => percent(row.ram_used, row.ram_total || server.ram_total) }]" compact filled /></div></section>
      <section class="resource-card resource-disk" style="--resource-color:#e5a11b"><div class="resource-card-title"><span><i><Icon name="HardDrive" :size="16" /></i>{{ t('硬盘', 'Disk') }}</span><small>{{ t('总量', 'Total') }} {{ mb(server.disk_total) }}</small></div><div class="resource-card-body"><div><strong>{{ pct(disk) }}</strong><p>{{ t('已用', 'Used') }} {{ mb(server.disk_used) }}</p></div><ResourceRing :value="disk ?? undefined" text="DISK" color="#e5a11b" :label="t('磁盘使用率', 'Disk usage') + ' ' + pct(disk)" /></div><div class="resource-card-bottom"><div><span>{{ t('所选时段', 'Selected range') }}</span><span>{{ t('总量', 'Total') }} {{ mb(server.disk_total) }}</span></div><MetricChart :rows="rows" :series="[{ key: 'disk', label: 'Disk', color: '#e5a11b', get: row => percent(row.disk_used, row.disk_total || server.disk_total) }]" compact filled /></div></section>
      <section class="resource-card resource-network" style="--resource-color:#22a788"><div class="resource-card-title"><span><i><Icon name="Network" :size="16" /></i>{{ t('网络流量', 'Network traffic') }}</span></div><div class="resource-card-body"><div class="resource-network-rates"><p>↓ <b>{{ bytes(server.net_in_speed, true) }}</b></p><p>↑ <b>{{ bytes(server.net_out_speed, true) }}</b></p></div><ResourceRing :value="downShare ?? undefined" :text="numeric(rate) ? Number(rate.toFixed(1)).toString() : '—'" caption="Mbps" color="#22a788" :label="t('上下行总速率；圆弧表示下载占比', 'Combined throughput; arc shows download share')" /></div><div class="resource-card-bottom resource-quota" v-if="server._sys.show_tf === true"><div><span>{{ t('月度', 'Monthly') }} · {{ allowance === Infinity ? '∞' : bytes(allowance) }}</span><span>{{ bytes(monthlyTraffic(server)) }} / {{ allowance === Infinity ? '∞' : bytes(allowance) }}</span></div><div><span>↓ {{ bytes(server.net_rx) }}</span><span>↑ {{ bytes(server.net_tx) }}</span></div><div class="resource-quota-track"><i :style="{ width: (quota || 0) + '%' }"></i></div></div></section>
    </div>
    <details class="machine-extra"><summary>{{ t('更多节点信息', 'More server information') }}</summary><dl class="machine-facts"><div v-for="[icon, label, value] in fields" :key="label" class="machine-fact"><dt><Icon :name="icon" :size="13" />{{ label }}</dt><dd>{{ value }}</dd></div></dl></details>
  </section>
</template>
