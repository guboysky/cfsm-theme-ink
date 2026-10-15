<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import Icon from './Icon.vue'
import { bytes, timestamp } from '../utils/metrics.js'
import { t } from '../composables/useTheme.js'
const props = defineProps({ title: String, icon: String, series: { type: Array, default: () => [] }, times: { type: Array, default: () => [] }, summary: String, max: Number, unit: String })
const hidden = ref([]), hovered = ref(null)
const plot = ref(null), size = ref({ width: 600, height: 180 })
let observer
onMounted(() => {
  observer = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect
    if (width > 0 && height > 0) size.value = { width: Math.round(width), height: Math.round(height) }
  })
  observer.observe(plot.value)
})
onBeforeUnmount(() => observer?.disconnect())
const colors = ['#4d86c4', '#95b6dc', '#71859e', '#c2d0e1', '#3971b1', '#a8c6e7', '#6585a8', '#89a0bc']
const visible = computed(() => props.series.map((series, index) => ({ ...series, index, color: series.color || colors[index % colors.length] })).filter(series => !hidden.value.includes(series.index)))
const numeric = value => typeof value === 'number' && Number.isFinite(value)
const ceiling = values => { const largest = Math.max(1, ...values); const power = 10 ** Math.floor(Math.log10(largest)); return Math.ceil(largest / power / 2) * power * 2 }
const limits = computed(() => ({ left: props.max || ceiling(visible.value.filter(series => !series.right).flatMap(series => series.values.filter(numeric))), right: ceiling(visible.value.filter(series => series.right).flatMap(series => series.values.filter(numeric))) }))
const timesMs = computed(() => props.times.map(timestamp))
const x = index => timesMs.value.length > 1 && timesMs.value.at(-1) > timesMs.value[0] ? 52 + (timesMs.value[index] - timesMs.value[0]) / (timesMs.value.at(-1) - timesMs.value[0]) * (size.value.width - 94) : 52 + index / Math.max(1, props.times.length - 1) * (size.value.width - 94)
const paths = computed(() => visible.value.map(series => {
  let path = '', connected = false
  series.values.forEach((value, index) => {
    if (!numeric(value)) { connected = false; return }
    path += `${connected ? 'L' : 'M'}${x(index).toFixed(2)},${(size.value.height - 32 - Math.max(0, Math.min(1, value / limits.value[series.right ? 'right' : 'left'])) * (size.value.height - 52)).toFixed(2)} `
    connected = true
  })
  return { ...series, path }
}))
const format = value => props.unit === 'bytes' ? bytes(value) : `${Number(value.toFixed(value < 1 && value > 0 ? 2 : 1))}${props.unit || ''}`
const time = value => timestamp(value) ? new Date(timestamp(value)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
const ticks = computed(() => {
  const count = Math.min(5, props.times.length)
  return Array.from({ length: count }, (_, index) => Math.round(index * (props.times.length - 1) / Math.max(1, count - 1)))
})
function hover(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const position = (event.clientX - rect.left) / rect.width * size.value.width
  let best = 0
  for (let index = 1; index < props.times.length; index++) if (Math.abs(x(index) - position) < Math.abs(x(best) - position)) best = index
  hovered.value = props.times.length ? best : null
}
function toggle(index) { hidden.value = hidden.value.includes(index) ? hidden.value.filter(value => value !== index) : [...hidden.value, index] }
</script>
<template><article class="chart-card panel"><div class="chart-heading"><h3><span class="chart-icon"><Icon :name="icon || 'pulse'" :size="17"/></span>{{ title }}</h3><span>{{ summary }}</span></div><div class="chart-subtitle">{{ unit === 'bytes' ? t('capacity') : unit || t('samples') }}<span v-if="series.some(series => series.right)">{{ t('load') }}</span></div><div ref="plot" class="history-plot" @pointerleave="hovered = null"><svg :viewBox="`0 0 ${size.width} ${size.height}`" preserveAspectRatio="none" role="img" :aria-label="title" @pointermove="hover"><g v-for="n in 5" :key="n"><line x1="52" :x2="size.width - 42" :y1="20 + (n - 1) * (size.height - 52) / 4" :y2="20 + (n - 1) * (size.height - 52) / 4" class="gridline"/><text x="44" :y="24 + (n - 1) * (size.height - 52) / 4" text-anchor="end">{{ format(limits.left * (5 - n) / 4) }}</text><text v-if="series.some(series => series.right)" :x="size.width - 32" :y="24 + (n - 1) * (size.height - 52) / 4">{{ Number((limits.right * (5 - n) / 4).toFixed(1)) }}</text></g><path v-for="series in paths" :key="series.index" :d="series.path" fill="none" :stroke="series.color" :stroke-dasharray="series.dashed ? '5 3' : undefined" stroke-width="1.6" vector-effect="non-scaling-stroke"/><text v-for="index in ticks" :key="index" :x="x(index)" :y="size.height - 7" text-anchor="middle">{{ time(times[index]) }}</text><line v-if="hovered !== null" :x1="x(hovered)" :x2="x(hovered)" y1="15" :y2="size.height - 32" class="hover-line"/></svg><div v-if="!times.length" class="plot-empty">{{ t('noHistory') }}</div><div v-if="hovered !== null" class="chart-tooltip"><strong>{{ time(times[hovered]) }}</strong><div v-for="series in visible.filter(series => series.values[hovered] !== false && series.values[hovered] !== undefined)" :key="series.index"><i :style="{ background: series.color }"></i>{{ series.label }} <b>{{ series.values[hovered] === null ? t('timeout') : series.right ? series.values[hovered] : format(series.values[hovered]) }}</b></div></div></div><div class="chart-legend"><button v-for="(series, index) in series" :key="index" :class="{ 'legend-hidden': hidden.includes(index) }" @click="toggle(index)"><i :style="{ background: series.color || colors[index % colors.length] }"></i>{{ series.label }}</button></div></article></template>
