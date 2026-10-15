<script setup>
import { computed } from 'vue'
const props = defineProps({ values: { type: Array, default: () => [] }, max: Number, height: { type: Number, default: 110 }, label: String })
const area = path => {
  const points = path.split(' ')
  return `${points[0].split(',')[0]},${props.height} ${path} ${points.at(-1).split(',')[0]},${props.height}`
}
const paths = computed(() => {
  const valid = props.values.filter(value => typeof value === 'number' && Number.isFinite(value))
  const max = props.max || Math.max(1, ...valid)
  const segments = []; let segment = []
  props.values.forEach((value, index) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) { if (segment.length) segments.push(segment.join(' ')); segment = []; return }
    segment.push(`${index / Math.max(1, props.values.length - 1) * 600},${props.height - 6 - Math.min(1, Math.max(0, value / max)) * (props.height - 12)}`)
  })
  if (segment.length) segments.push(segment.join(' '))
  return segments
})
</script>
<template><svg :viewBox="`0 0 600 ${height}`" preserveAspectRatio="none" role="img" :aria-label="label || 'Trend'" class="sparkline"><title>{{ label }}</title><line v-for="n in 3" :key="n" x1="0" x2="600" :y1="height * n / 4" :y2="height * n / 4" class="gridline"/><polygon v-for="(path, i) in paths" :key="`area-${i}`" :points="area(path)" fill="currentColor" opacity=".065"/><polyline v-for="(path, i) in paths" :key="i" :points="path" fill="none" stroke="currentColor" stroke-width="1.8" vector-effect="non-scaling-stroke"/><circle v-if="values.length === 1 && typeof values[0] === 'number'" cx="300" :cy="height / 2" r="1.5" fill="currentColor"/></svg></template>
