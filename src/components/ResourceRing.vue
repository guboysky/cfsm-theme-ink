<script setup>
import { computed } from 'vue'
import { numeric } from '../utils/metrics.js'
const props = defineProps({ value: Number, secondary: Number, text: String, caption: String, color: String, label: String })
const progress = computed(() => numeric(props.value) ? Math.min(100, Math.max(0, props.value)) : 0)
</script>
<template><svg class="resource-ring" viewBox="0 0 100 100" role="img" :aria-label="label"><circle class="ring-track" cx="50" cy="50" r="40" fill="none" stroke-width="7" /><circle v-if="progress > 0" cx="50" cy="50" r="40" pathLength="100" fill="none" :stroke="color" stroke-width="7" stroke-linecap="round" :stroke-dasharray="progress + ' 100'" transform="rotate(-90 50 50)" /><template v-if="numeric(secondary)"><circle class="ring-track" cx="50" cy="50" r="30" fill="none" stroke-width="4" /><circle v-if="secondary > 0" cx="50" cy="50" r="30" pathLength="100" fill="none" stroke="#e6a326" stroke-width="4" stroke-linecap="round" :stroke-dasharray="Math.min(100, Math.max(0, secondary)) + ' 100'" transform="rotate(-90 50 50)" /></template><text x="50" :y="caption ? 46 : 54" text-anchor="middle" :fill="color">{{ text }}</text><text v-if="caption" x="50" y="62" text-anchor="middle" :fill="color" class="ring-caption">{{ caption }}</text></svg></template>
