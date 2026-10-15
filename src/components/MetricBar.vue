<script setup>
defineProps({ label: String, value: Number })
</script>
<template><div class="metric"><div class="metric-heading"><span>{{ label }}</span><strong>{{ Number.isFinite(value) ? value.toFixed(1) : '—' }}<small>%</small></strong></div><div class="track"><i :style="{ width: `${Math.min(100, Math.max(0, value || 0))}%` }" :class="{ danger: value > 90 }"></i></div></div></template>
