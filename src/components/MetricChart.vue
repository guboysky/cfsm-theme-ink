<script setup>
import { computed, ref } from 'vue'
import { numeric, bytes } from '../utils/metrics.js'
import { t } from '../composables/useTheme.js'
const props = defineProps({ rows: { type: Array, default: () => [] }, series: { type: Array, default: () => [] }, unit: { type: String, default: '%' }, compact: Boolean, filled: Boolean, maxValue: Number })
const hovered = ref(null)
const colors = ['#d8775c', '#558bca', '#35896c', '#b58742', '#8c78aa', '#b57691', '#659b9e', '#918063']
const valueOf = (row, series) => series.get ? series.get(row) : row[series.key]
const lines = computed(() => props.series.map((s, i) => ({ ...s, color: s.color || colors[i % colors.length], values: props.rows.map(row => valueOf(row, s)) })).filter(s => s.values.some(v => v === null || numeric(v))))
const ymax = computed(() => props.maxValue > 0 ? props.maxValue : Math.max(props.unit === '%' ? 100 : 1, ...lines.value.flatMap(s => s.values.filter(numeric).map(Number))) * (props.unit === '%' ? 1 : 1.15))
const start = computed(() => Number(props.rows[0]?.timestamp ?? props.rows[0]?.ts ?? 0))
const end = computed(() => Number(props.rows.at(-1)?.timestamp ?? props.rows.at(-1)?.ts ?? 0))
const x = index => {
  const row = props.rows[index]
  const time = Number(row?.timestamp ?? row?.ts ?? 0)
  return 10 + (end.value > start.value ? (time - start.value) / (end.value - start.value) : index / Math.max(1, props.rows.length - 1)) * 580
}
function path(series) {
  let open = false
  return series.values.map((value, i) => {
    if (!numeric(value)) { open = false; return '' }
    const point = `${open ? 'L' : 'M'}${x(i).toFixed(2)},${(130 - Math.min(ymax.value, Number(value)) / ymax.value * 115).toFixed(2)}`
    open = true
    return point
  }).join(' ')
}
function area(series) {
  const segments = []; let points = []
  const flush = () => { if (points.length) segments.push('M' + points[0][0] + ',130 ' + points.map(([x, y]) => 'L' + x + ',' + y).join(' ') + ' L' + points.at(-1)[0] + ',130 Z'); points = [] }
  series.values.forEach((value, i) => {
    if (!numeric(value)) return flush()
    points.push([x(i).toFixed(2), (130 - Math.min(ymax.value, Number(value)) / ymax.value * 115).toFixed(2)])
  })
  flush(); return segments.join(' ')
}
const format = value => value === null ? t('超时', 'Timeout') : !numeric(value) ? '—' : ['B', 'B/s'].includes(props.unit) ? bytes(value, props.unit === 'B/s') : `${Number(value).toFixed(1)}${props.unit}`
const time = value => value ? new Date(Number(value)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
function hover(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  const target = (event.clientX - rect.left) / rect.width * 600
  hovered.value = props.rows.length ? props.rows.reduce((best, row, i) => Math.abs(x(i) - target) < Math.abs(x(best) - target) ? i : best, 0) : null
}
</script>
<template>
  <div class="chart" :class="{ compact }">
    <div v-if="!compact" class="chart-scale"><span>{{ format(ymax) }}</span><span>{{ format(ymax / 2) }}</span><span>0</span></div>
    <div class="chart-plot">
      <svg v-if="lines.length" viewBox="0 0 600 145" preserveAspectRatio="none" role="img" :aria-label="series.map(s => s.label).join(', ')" @mousemove="hover" @mouseleave="hovered = null">
        <path v-if="!compact" d="M10 15H590M10 72.5H590M10 130H590" stroke="var(--line)" stroke-dasharray="3 5" fill="none" />
        <template v-if="filled"><path v-for="line in lines" :key="line.key" :d="area(line)" :fill="line.color" fill-opacity="0.12" /></template>
        <path v-for="line in lines" :key="line.key" :d="path(line)" :stroke="line.color" stroke-width="1.8" fill="none" vector-effect="non-scaling-stroke" />
        <template v-for="line in lines" :key="`${line.key}-points`"><circle v-for="(v, i) in line.values" v-show="numeric(v)" :key="i" :cx="x(i)" :cy="130 - Math.min(ymax, Number(v || 0)) / ymax * 115" :r="rows.length === 1 ? 3 : 1" :fill="line.color" /></template>
        <line v-if="hovered !== null" :x1="x(hovered)" :x2="x(hovered)" y1="10" y2="132" stroke="var(--muted)" stroke-dasharray="3 3" />
      </svg>
      <div v-else class="chart-empty">{{ t('暂无采样数据', 'No samples yet') }}</div>
      <div v-if="!compact" class="chart-times"><span>{{ time(start) }}</span><span>{{ time(end) }}</span></div>
      <div v-if="hovered !== null && !compact" class="chart-tooltip"><b>{{ time(rows[hovered]?.timestamp ?? rows[hovered]?.ts) }}</b><span v-for="line in lines" :key="line.key">{{ line.label }} <strong>{{ format(line.values[hovered]) }}</strong></span></div>
    </div>
    <div v-if="!compact" class="chart-legend"><span v-for="line in lines" :key="line.key"><i :style="{ background: line.color }"></i>{{ line.label }} <b>{{ format(line.values.at(-1)) }}</b></span></div>
  </div>
</template>
