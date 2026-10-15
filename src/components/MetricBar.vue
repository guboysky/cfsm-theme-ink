<script setup>
defineProps({ label: String, value: Number, detail: String, unlimited: Boolean, green: Boolean })
</script>
<template><div class="metric" :class="{ 'metric-green': green }"><div class="metric-heading"><span>{{ label }}</span><strong>{{ unlimited ? '∞' : Number.isFinite(value) ? value.toFixed(1) + '%' : '—' }}</strong></div><div class="track"><i :style="{ width: `${Math.min(100, Math.max(0, value || 0))}%` }" :class="{ danger: value > 90 }"></i></div><p v-if="detail" class="metric-detail" :title="detail">{{ detail }}</p></div></template>
