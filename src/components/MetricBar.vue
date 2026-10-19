<script setup>
import { pct, numeric } from '../utils/metrics.js'
defineProps({ label: String, value: [Number, String], color: { type: String, default: 'var(--accent)' } })
</script>
<template><div class="metric-bar"><div><span>{{ label }}</span><b>{{ pct(value) }}</b></div><div class="track"><i :style="{ width: `${numeric(value) ? Math.min(100, Math.max(0, Number(value))) : 0}%`, background: color }"></i></div></div></template>
