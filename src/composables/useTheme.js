import { computed, ref } from 'vue'
import { meta } from '../utils/config.js'
export const siteConfig = ref({})
export const preference = ref(null)
export const language = computed(() => {
  const lang = siteConfig.value.default_language || 'auto'
  return lang === 'auto' ? (navigator.language.startsWith('zh') ? 'zh' : 'en') : lang
})
export const t = (zh, en) => language.value === 'zh' ? zh : en
export const title = computed(() => siteConfig.value.site_title || document.title)
const media = window.matchMedia('(prefers-color-scheme: dark)')
export function applyTheme() {
  const mode = preference.value || siteConfig.value.preferred_theme || 'auto'
  document.documentElement.dataset.theme = mode === 'auto' ? (media.matches ? 'dark' : 'light') : mode
}
media.addEventListener('change', applyTheme)
export function initAppearance(config) {
  siteConfig.value = config
  if (config.site_title) document.title = config.site_title
  document.documentElement.lang = language.value === 'zh' ? 'zh-CN' : 'en'
  const background = config.background_image || meta('backgroundImage')
  if (background) document.body.style.backgroundImage = `url(${JSON.stringify(background)})`
  applyTheme()
  // Same-origin Worker can inject appearance HTML before boot. For static hosting,
  // apply these optional fields if a backend exposes them, without extra endpoints.
  for (const [field, target] of [['custom_head', document.head]]) {
    if (!config[field]) continue
    const fragment = document.createElement('template')
    fragment.innerHTML = config[field]
    for (const child of [...fragment.content.childNodes]) {
      if (child.nodeName === 'SCRIPT') {
        const script = document.createElement('script')
        for (const attr of child.attributes) script.setAttribute(attr.name, attr.value)
        script.textContent = child.textContent
        target.append(script)
      } else target.append(child)
    }
  }
  if (config.custom_script) {
    const script = document.createElement('script')
    script.textContent = config.custom_script
    document.body.append(script)
  }
}
export function toggleTheme() {
  preference.value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  applyTheme()
}
