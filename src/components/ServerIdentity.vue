<script setup>
import { online, osIcon } from '../utils/metrics.js'
import { assetUrl } from '../utils/config.js'
import { t } from '../composables/useTheme.js'
import Icon from './Icon.vue'
defineProps({ server: Object, showSystem: { type: Boolean, default: true }, showStatus: { type: Boolean, default: true } })
</script>
<template>
  <div class="server-identity">
    <div class="server-symbol"><img v-if="/^[a-z]{2}$/i.test(server.region || '')" :src="assetUrl(server._base, `/flags/${server.region.toLowerCase()}.svg`)" :alt="server.region" /><Icon v-else name="Server" :size="19" /></div>
    <div class="server-name"><strong>{{ server.name || server.id }}</strong><small v-if="showSystem"><img v-if="osIcon(server.os)" :src="assetUrl(server._base, `/os-icons/os-${osIcon(server.os) === 'almalinux' ? 'alma' : osIcon(server.os)}.${osIcon(server.os) === 'alpine' ? 'webp' : 'svg'}`)" alt="" />{{ server.os || '—' }}<span>·</span>{{ server.cpu_cores || '—' }} {{ t('核', 'cores') }}<slot name="metadata"></slot></small></div>
    <span v-if="showStatus" class="status" :class="{ offline: !online(server) }"><i></i>{{ online(server) ? t('在线', 'Online') : t('离线', 'Offline') }}</span>
  </div>
</template>
