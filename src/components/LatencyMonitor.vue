<script setup>
import { computed, ref } from 'vue'
import { LANES, laneName, numeric, present } from '../utils/metrics.js'
import { t } from '../composables/useTheme.js'
import MetricChart from './MetricChart.vue'
const props = defineProps({ server: Object, rows: Array })
const excluded = ref([]), trimPeaks = ref(false)
const colors = ['#ee777b', '#50bdb9', '#a58be4', '#d6b252', '#558bca', '#35896c', '#b57691', '#918063']
const lanes = computed(() => LANES.filter(lane => present(props.server[`ping_${lane}`]) || props.rows.some(row => present(row[`ping_${lane}`]))).map((lane, i) => {
  const key = `ping_${lane}`, values = props.rows.map(row => row[key])
  const current = props.server[key] !== undefined ? props.server[key] : values.findLast(present)
  const differences = values.slice(1).flatMap((value, index) => numeric(value) && numeric(values[index]) ? [Math.abs(Number(value) - Number(values[index]))] : [])
  return { lane, key, label: laneName(props.server._config || {}, lane, t), color: colors[i % colors.length], current,
    loss: props.server[`loss_${lane}`] !== undefined ? props.server[`loss_${lane}`] : props.rows.map(row => row[`loss_${lane}`]).findLast(present),
    jitter: differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : undefined }
}))
const selected = computed(() => lanes.value.filter(lane => !excluded.value.includes(lane.key)))
const ceiling = computed(() => {
  if (!trimPeaks.value) return undefined
  const values = props.rows.flatMap(row => selected.value.map(lane => row[lane.key])).filter(numeric).map(Number).sort((a, b) => a - b)
  return values.length ? Math.max(1, values[Math.max(0, Math.ceil(values.length * .95) - 1)] * 1.15) : undefined
})
const format = (value, suffix) => value === null ? t('超时', 'Timeout') : numeric(value) ? `${Number(Number(value).toFixed(1))}${suffix}` : '—'
function toggle(key) { excluded.value = excluded.value.includes(key) ? excluded.value.filter(value => value !== key) : [...excluded.value, key] }
</script>
<template>
  <div class="latency-monitor">
    <div v-if="lanes.length" class="latency-summaries">
      <button v-for="lane in lanes" :key="lane.key" class="latency-lane" :class="{ excluded: excluded.includes(lane.key), timeout: lane.current === null }" :style="{ '--lane-color': lane.color }" :aria-pressed="!excluded.includes(lane.key)" @click="toggle(lane.key)">
        <span class="latency-lane-name">{{ lane.label }}</span><span class="latency-lane-values"><b>{{ format(lane.current, ' ms') }}</b><span>·</span><span>{{ format(lane.loss, '%') }} {{ t('丢包', 'loss') }}</span><span>·</span><span :title="t('所选历史中相邻有效延迟样本的平均变化', 'Mean absolute difference between consecutive valid latency samples')">{{ format(lane.jitter, ' ms') }} {{ t('波动', 'jitter') }}</span></span>
      </button>
    </div>
    <div class="latency-controls"><label :title="t('按有效样本的 95% 分位压缩纵轴，悬浮仍显示原始数值', 'Scale to the 95th percentile; tooltips retain original values')"><input v-model="trimPeaks" type="checkbox" role="switch" /><span>{{ t('裁剪峰值', 'Trim peaks') }}</span></label><div><button @click="excluded = []">{{ t('全选', 'Select all') }}</button><button @click="excluded = lanes.map(lane => lane.key)">{{ t('全不选', 'Select none') }}</button></div></div>
    <section class="latency-trend chart-panel"><h3>{{ t('延迟趋势', 'Latency trend') }}<span>{{ selected.length }} / {{ lanes.length }}</span></h3><MetricChart :rows="rows" :series="selected" :max-value="ceiling" unit="ms" /><p v-if="!lanes.length" class="latency-empty-note">{{ t('该节点暂无延迟监控数据', 'No latency monitoring data for this server') }}</p></section>
  </div>
</template>
