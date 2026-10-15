<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Icon from './Icon.vue'
import MetricBar from './MetricBar.vue'
import ProbeBuckets from './ProbeBuckets.vue'
import NodeInformation from './NodeInformation.vue'
import { online, percent, bytes, present, probes, probeLabel, probeText } from '../utils/metrics.js'
import { osIcon, validRegion, uptimeText, daysLeft, expiryDate, traffic, billing, loadValues, windowValues, probeTone } from '../utils/display.js'
import { favorite, toggleFavorite } from '../composables/usePreferences.js'
import { t, language } from '../composables/useTheme.js'
const props = defineProps({ server: Object, site: Object, siteIndex: Number, now: Number })
const router = useRouter()
const isOnline = computed(() => online(props.server, props.now))
const transfer = computed(() => traffic(props.server))
const price = computed(() => props.site.sysConfig.show_price === true ? billing(props.server, language.value) : '')
const uptime = computed(() => uptimeText(props.server.boot_time, props.now, language.value))
const expiry = computed(() => daysLeft(props.server.expire_date, props.now))
const rows = computed(() => probes.filter(key => present(props.server[`ping_${key}`]) || present(props.server[`loss_${key}`])))
const three = computed(() => rows.value.filter(key => ['ct', 'cu', 'cm'].includes(key)))
const windows = computed(() => props.site.sysConfig.show_three_net_details === true && (props.server.ping?.length || props.server.loss?.length))
const ping = computed(() => windowValues(props.server, 'ping'))
const loss = computed(() => windowValues(props.server, 'loss'))
const latest = values => [...values].reverse().find(present)
const loads = computed(() => loadValues(props.server.load_avg).map(value => value.toFixed(2)).join(', '))
const open = () => router.push({ path: `/server/${props.server.id}`, query: { site: props.siteIndex } })
</script>
<template>
  <article class="server-card" :class="{ 'is-offline': !isOnline }" role="link" tabindex="0" @click="open" @keydown.enter.self="open">
    <div class="card-heading">
      <span class="state-dot" :class="{ offline: !isOnline }" :title="t(isOnline ? 'online' : 'offline')"></span>
      <img v-if="osIcon(server.os)" class="os-icon" :src="`${site.base}/os-icons/${osIcon(server.os)}`" :alt="server.os">
      <h3 class="node-name" :title="server.name || server.id">{{ server.name || server.id }}</h3>
      <button class="favorite-button" :class="{ selected: favorite(siteIndex, server.id) }" :aria-label="t('favorite')" :aria-pressed="favorite(siteIndex, server.id)" @click.stop="toggleFavorite(siteIndex, server.id)"><Icon name="star" :size="17"/></button>
      <img v-if="validRegion(server.region)" class="flag-icon" :src="`${site.base}/flags/${server.region.toLowerCase()}.svg`" :alt="server.region">
    </div>
    <div class="card-subtitle"><span class="card-uptime" :title="`${t(isOnline ? 'online' : 'offline')} ${uptime}`">{{ t(isOnline ? 'online' : 'offline') }} {{ uptime }}</span><span class="ip-facts"><span v-if="server.ip_v4 === '1'">IPv4</span><span v-if="server.ip_v6 === '1'">IPv6</span></span></div>
    <div class="resources">
      <MetricBar :label="t('cpu')" :value="Number(server.cpu)" :detail="loads || `${server.cpu_cores || '—'} vCPU`"/>
      <MetricBar :label="t('ram')" :value="percent(server.ram_used, server.ram_total)" :detail="`${bytes(Number(server.ram_used) * 1048576)} / ${bytes(Number(server.ram_total) * 1048576)}`"/>
      <MetricBar :label="t('disk')" :value="percent(server.disk_used, server.disk_total)" :detail="`${bytes(Number(server.disk_used) * 1048576)} / ${bytes(Number(server.disk_total) * 1048576)}`"/>
      <MetricBar v-if="site.sysConfig.show_tf !== false" :label="t('transfer')" :value="transfer.percentage" :unlimited="!transfer.limit" :detail="transfer.detail" green/>
    </div>
    <div class="card-facts">
      <div><Icon name="upload" :size="13"/><strong>{{ bytes(server.net_out_speed) }}/s</strong></div>
      <div><Icon name="upload" :size="13"/><span>{{ bytes(server.net_tx) }}</span></div>
      <div class="expiry-fact" :title="site.sysConfig.show_expire === true && expiry !== null ? `${t('remaining')} ${expiry} ${t('days')}` : ''"><Icon name="calendar" :size="13"/><span :class="{ warning: expiry !== null && expiry <= 14 }">{{ site.sysConfig.show_expire === true ? expiryDate(server.expire_date) : '—' }}</span></div>
      <div><Icon name="download" :size="13"/><strong>{{ bytes(server.net_in_speed) }}/s</strong></div>
      <div><Icon name="download" :size="13"/><span>{{ bytes(server.net_rx) }}</span></div>
      <div class="price-fact"><Icon name="wallet" :size="13"/><span>{{ price || '—' }}</span></div>
    </div>
    <div v-if="rows.length" class="probe-list">
      <div v-if="three.length" class="three-net-line"><span>{{ t('threeNet') }}</span><div><span v-for="key in three" :key="key" class="probe-row" :class="probeTone(server[`ping_${key}`])" :title="probeLabel(site.config, key)"><template v-if="present(server[`ping_${key}`])">{{ probeText(server[`ping_${key}`], ' ms', t('timeout')) }}</template><small v-if="present(server[`loss_${key}`]) && (server[`loss_${key}`] === null || !windows || !present(server[`ping_${key}`]))" class="probe-loss" :class="probeTone(server[`loss_${key}`], true)"> · {{ probeText(server[`loss_${key}`], '%', t('timeout')) }}</small></span></div></div>
      <div v-if="windows" class="probe-panels"><div v-for="field in ['ping', 'loss']" :key="field" class="probe-panel"><div><span>{{ t(field === 'ping' ? 'latency' : 'loss') }}</span><strong :class="probeTone(latest(field === 'ping' ? ping : loss), field === 'loss')">{{ probeText(latest(field === 'ping' ? ping : loss), field === 'ping' ? ' ms' : '%', t('timeout')) }}</strong></div><ProbeBuckets :values="field === 'ping' ? ping : loss" :loss="field === 'loss'"/></div></div>
      <div v-for="key in rows.filter(key => !three.includes(key))" :key="key" class="extra-probe"><span>{{ probeLabel(site.config, key) }}</span><strong v-if="present(server[`ping_${key}`])">{{ probeText(server[`ping_${key}`], ' ms', t('timeout')) }}</strong><small v-if="present(server[`loss_${key}`])">{{ probeText(server[`loss_${key}`], '%', t('timeout')) }}</small></div>
    </div>
    <NodeInformation :server="server" :site="site" notes-only/>
  </article>
</template>
