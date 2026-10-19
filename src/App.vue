<script setup>
import { ref, shallowRef, computed, onMounted, provide, watch } from 'vue'
import { useRoute } from 'vue-router'
import { backends, boot } from './composables/useMonitor.js'
import { t, title, toggleTheme } from './composables/useTheme.js'
import { adminUrl } from './utils/config.js'
import Dashboard from './views/Dashboard.vue'
import { monitorContext } from './composables/monitorContext.js'
import Icon from './components/Icon.vue'
import ChallengeGate from './components/ChallengeGate.vue'
const route = useRoute()
const homeMonitor = shallowRef(null)
provide(monitorContext, homeMonitor)
const dashboardActive = ref(false)
watch(() => [route.path, route.matched.length], ([path, matched]) => {
  if (!matched) return
  if (path === '/') dashboardActive.value = true
  else if (!path.startsWith('/server/')) dashboardActive.value = false
}, { immediate: true })
const isDetail = computed(() => route.path.startsWith('/server/'))
const error = ref('')
const base = computed(() => backends.value.find(b => b.config)?.base || location.origin)
const version = computed(() => backends.value.find(b => b.config)?.config.version || '')
onMounted(() => boot().catch(e => { error.value = e.message }))
</script>
<template>
  <div class="shell" :inert="isDetail || undefined">
    <header class="header" :class="{ 'has-summary': dashboardActive }">
      <RouterLink to="/" class="brand"><span class="brand-icon"><Icon name="Activity" :size="21" /></span><span><strong>{{ title }}</strong><small>SERVER MONITOR</small></span></RouterLink>
      <div id="header-summary" class="header-summary" :class="{ 'is-dashboard': dashboardActive }"></div>
      <div class="header-tools"><button class="icon-button" :aria-label="t('切换明暗主题', 'Toggle color theme')" :title="t('切换明暗主题', 'Toggle color theme')" @click="toggleTheme"><Icon name="Sun" /></button><a class="admin-link" :href="adminUrl(base)"><Icon name="Settings2" :size="14" /><span>{{ t('管理后台', 'Admin') }}</span><Icon name="ArrowUpRight" :size="12" /></a></div>
    </header>
    <main><div v-if="error" class="notice error-text" role="alert">{{ error }}</div><template v-else><Dashboard v-if="dashboardActive" /><RouterView v-if="route.path !== '/'" v-slot="{ Component }"><component :is="Component" :key="route.fullPath" /></RouterView></template></main>
    <footer><span><a href="https://github.com/huilang-me/CF-Server-Monitor/" target="_blank" rel="noopener">Powered by CF-Server-Monitor</a><span v-if="version"> · {{ version }}</span></span><span>Terracotta <span class="footer-dot">/</span> {{ t('每一刻，尽在掌握', 'A clear view of every moment') }}</span></footer>
  </div>
  <ChallengeGate />
</template>
