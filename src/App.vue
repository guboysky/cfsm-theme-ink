<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { state, initialize, setPage, onVisibility, dispose, continueLive } from './composables/useMonitor.js'
import { firstConfig, t, applyAppearance, themeOptions } from './composables/useTheme.js'
import { meta } from './utils/config.js'
import { saveOptions } from './utils/api.js'
import TurnstileGate from './components/TurnstileGate.vue'
import Icon from './components/Icon.vue'
const route = useRoute(), settings = ref(false), saving = ref(false), saved = ref(false)
const density = ref(false), network = ref(true), favicon = ref('')
const title = computed(() => firstConfig.value.site_title || meta('siteTitle') || 'CF-Server-Monitor')
const status = computed(() => state.sites.every(site => site.status === 'live') ? 'live' : 'disconnected')
watch(() => [state.ready, route.fullPath], () => { if (state.ready) setPage(route.params.id ? { id: String(route.params.id), site: Number(route.query.site || 0) } : {}) })
watch(settings, open => { if (open) { density.value = themeOptions.value.density === 'compact'; network.value = themeOptions.value.show_network !== false; saved.value = false } })
async function save() {
  saving.value = true
  try {
    const site = state.sites[0]
    const options = { ...site.config.theme_options, density: density.value ? 'compact' : 'comfortable', show_network: network.value }
    await saveOptions(site, options); site.config.theme_options = options; saved.value = true
  } catch (error) { state.error = error.message }
  finally { saving.value = false }
}
function resourceError(event) { if (event.target !== window) state.error = `Resource failed to load: ${event.target.src || event.target.href || event.target.tagName}` }
const toggleAppearance = () => document.documentElement.classList.toggle('dark')
onMounted(async () => {
  document.addEventListener('visibilitychange', onVisibility); window.addEventListener('error', resourceError, true)
  await initialize()
  if (state.ready) {
    applyAppearance(firstConfig.value)
    favicon.value = firstConfig.value.favicon || document.querySelector('link[rel~="icon"]')?.href || ''
  }
})
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('error', resourceError, true); dispose() })
</script>
<template>
  <header class="site-header"><div class="header-inner"><RouterLink to="/" class="brand"><img v-if="favicon" :src="favicon" alt="" class="brand-avatar"><span v-else class="brand-emblem"><Icon name="pulse" :size="23"/></span><span>{{ title }}</span></RouterLink><nav><span class="connection" :class="{ connected: status === 'live' }"><i></i>{{ t(status === 'live' ? 'realtime' : status) }}</span><button class="icon-button" @click="toggleAppearance" :aria-label="t('toggleAppearance')" :title="t('toggleAppearance')"><Icon name="sun" :size="20"/></button><button class="icon-button" @click="settings = true" :aria-label="t('settings')" :title="t('settings')"><Icon name="settings" :size="19"/></button></nav></div></header>
  <main><div v-if="state.error" role="alert" class="error-banner">{{ state.error }}</div><template v-for="site in state.sites" :key="site.base"><div v-if="site.expired" class="timeout-banner"><div><strong>{{ t('paused') }}</strong><p>{{ t('budget') }}</p><small v-if="state.sites.length > 1">{{ site.base }}</small></div><button @click="continueLive(site)">{{ t('continue') }}</button></div></template><RouterView v-if="state.ready"/><p v-else-if="!state.error" class="empty">{{ t('loading') }}</p></main>
  <footer><span>ink <span class="separator">/</span> CFSM Edition</span><a href="https://github.com/huilang-me/CF-Server-Monitor/" target="_blank" rel="noopener">Powered by CF-Server-Monitor <span v-if="firstConfig.version">{{ firstConfig.version }}</span> ↗</a></footer>
  <div v-if="settings" class="overlay" @click.self="settings = false"><section class="dialog" role="dialog" aria-modal="true" :aria-label="t('settings')"><div class="section-heading"><h2>{{ t('settings') }}</h2><button @click="settings = false" :aria-label="t('close')">×</button></div><label class="option"><span>{{ t('density') }}</span><input type="checkbox" v-model="density"></label><label class="option"><span>{{ t('network') }}</span><input type="checkbox" v-model="network"></label><p class="settings-note muted">{{ t('preferencesNote') }}</p><p class="settings-note muted">{{ t('backgroundHint') }}</p><div class="actions"><span v-if="saved" role="status" class="success-text">{{ t('saved') }}</span><button :disabled="saving" @click="save">{{ saving ? t('loading') : t('save') }}</button></div></section></div><TurnstileGate/>
</template>
