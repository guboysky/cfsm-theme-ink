<script setup>
import { computed } from 'vue'
import { expiryRanking } from '../utils/serverPresentation.js'
import { assetUrl } from '../utils/config.js'
import { t } from '../composables/useTheme.js'
import Icon from './Icon.vue'
const props = defineProps({ records: Array })
const ranking = computed(() => expiryRanking(props.records))
const link = server => ({ path: `/server/${encodeURIComponent(server.id)}`, query: { site: server._base } })
const remaining = days => days < 0 ? t(`已过 ${Math.abs(days)} 天`, `${Math.abs(days)}d overdue`) : days === 0 ? t('今天到期', 'Today') : t(`剩 ${days} 天`, `${days}d left`)
</script>
<template>
  <section class="insight-panel expiry-panel">
    <div class="insight-heading"><h2><Icon name="CalendarDays" :size="15" />{{ t('到期时间排行榜', 'Expiration ranking') }}</h2><p>{{ t(`共 ${ranking.length} 台设置到期日`, `${ranking.length} nodes with expiry dates`) }}</p></div>
    <div v-if="ranking.length" class="expiry-table-wrap"><table class="expiry-table"><thead><tr><th>#</th><th>{{ t('节点', 'Node') }}</th><th>{{ t('到期日期', 'Expiry date') }}</th><th>{{ t('剩余时间', 'Time left') }}</th></tr></thead><tbody><tr v-for="({ server, expiry }, index) in ranking.slice(0, 5)" :key="server._key" :class="{ 'expiry-urgent': expiry.days <= 7 }"><td>{{ index + 1 }}</td><td><RouterLink :to="link(server)" :title="server.name || server.id"><img v-if="/^[a-z]{2}$/i.test(server.region || '')" :src="assetUrl(server._base, `/flags/${server.region.toLowerCase()}.svg`)" :alt="server.region" /><span>{{ server.name || server.id }}</span></RouterLink></td><td>{{ expiry.date }}</td><td>{{ remaining(expiry.days) }}</td></tr></tbody></table></div>
    <div v-if="ranking.length" class="rank-footer"><span>{{ t('前', 'Top') }} {{ Math.min(5, ranking.length) }} / {{ ranking.length }}</span></div>
    <div v-else class="rank-empty">{{ t('暂无设置到期日的节点', 'No nodes with expiry dates') }}</div>
  </section>
</template>
