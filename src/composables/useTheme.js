import { computed } from 'vue'
import { state } from './useMonitor.js'
import { meta } from '../utils/config.js'
export const firstConfig = computed(() => state.sites[0]?.config || {})
export const themeOptions = computed(() => ({ density: 'comfortable', show_network: true, ...firstConfig.value.theme_options }))
const words = {
  zh: { overview: '总览', fleet: '服务器监控', intro: '所有节点，尽在掌握。', total: '全部节点', online: '在线', offline: '离线', search: '搜索节点、地区或分组…', all: '全部分组', cpu: 'CPU', ram: '内存', disk: '磁盘', swap: '交换内存', download: '下载', upload: '上传', history: '历史趋势', back: '返回总览', admin: '管理', loading: '正在载入…', empty: '没有匹配的节点', timeout: '超时', paused: '实时连接已暂停', continue: '继续实时监控', budget: '已达到站点设置的实时连接时长，最后一次数据已保留。', settings: '主题选项', save: '保存至站点', density: '紧凑卡片', network: '显示网络图表', saved: '已保存', latency: '延迟', loss: '丢包', traffic: '累计流量', details: '节点详情', live: '实时连接', disconnected: '连接已断开', emptyStatus: '暂无节点', verify: '完成验证以继续', cancel: '取消', retry: '重试验证', noHistory: '暂无历史数据', updated: '最近上报', groups: '节点分组', free: '免费' },
  en: { overview: 'Overview', fleet: 'Server monitor', intro: 'Every node. One clear view.', total: 'Total nodes', online: 'Online', offline: 'Offline', search: 'Search nodes, regions or groups…', all: 'All groups', cpu: 'CPU', ram: 'Memory', disk: 'Disk', swap: 'Swap', download: 'Download', upload: 'Upload', history: 'History', back: 'Back to overview', admin: 'Admin', loading: 'Loading…', empty: 'No matching nodes', timeout: 'Timeout', paused: 'Live connection paused', continue: 'Continue monitoring', budget: 'The configured connection duration was reached. Last received data is preserved.', settings: 'Theme options', save: 'Save to site', density: 'Compact cards', network: 'Show network charts', saved: 'Saved', latency: 'Latency', loss: 'Loss', traffic: 'Total traffic', details: 'Node details', live: 'Live', disconnected: 'Disconnected', emptyStatus: 'No nodes', verify: 'Complete verification to continue', cancel: 'Cancel', retry: 'Retry verification', noHistory: 'No history yet', updated: 'Last report', groups: 'Node groups', free: 'Free' }
}
words.es = { overview: 'Resumen', fleet: 'Monitor de servidores', intro: 'Todos los nodos, en una sola vista.', total: 'Nodos totales', online: 'En línea', offline: 'Sin conexión', search: 'Buscar nodos, regiones o grupos…', all: 'Todos los grupos', cpu: 'CPU', ram: 'Memoria', disk: 'Disco', swap: 'Intercambio', download: 'Descarga', upload: 'Subida', history: 'Historial', back: 'Volver al resumen', admin: 'Administración', loading: 'Cargando…', empty: 'No hay nodos coincidentes', timeout: 'Tiempo agotado', paused: 'Conexión en vivo pausada', continue: 'Continuar monitorizando', budget: 'Se alcanzó la duración configurada. Se conservan los últimos datos.', settings: 'Opciones del tema', save: 'Guardar en el sitio', density: 'Tarjetas compactas', network: 'Mostrar gráficos de red', saved: 'Guardado', latency: 'Latencia', loss: 'Pérdida', traffic: 'Tráfico total', details: 'Detalles del nodo', live: 'En vivo', disconnected: 'Desconectado', emptyStatus: 'Sin nodos', verify: 'Completa la verificación para continuar', cancel: 'Cancelar', retry: 'Reintentar', noHistory: 'Sin historial', updated: 'Último informe', groups: 'Grupos de nodos', free: 'Gratis' }
export const language = computed(() => {
  const configured = firstConfig.value.default_language || 'auto'
  return configured === 'auto' ? (navigator.language.startsWith('zh') ? 'zh' : 'en') : configured
})
export const t = key => (words[language.value] || words.en)[key] || key
export function applyAppearance(config) {
  document.title = config.site_title || meta('siteTitle') || document.title
  const media = matchMedia('(prefers-color-scheme: dark)')
  const apply = () => document.documentElement.classList.toggle('dark', config.preferred_theme === 'dark' || ((!config.preferred_theme || config.preferred_theme === 'auto') && media.matches))
  apply(); media.addEventListener('change', apply)
  document.documentElement.lang = language.value
  const background = () => {
    const value = matchMedia('(max-width: 640px)').matches && config.custom_bg_mobile ? config.custom_bg_mobile : config.custom_bg || meta('backgroundImage')
    document.body.style.backgroundImage = value ? `linear-gradient(var(--veil),var(--veil)),url(${JSON.stringify(value)})` : ''
  }
  background(); window.addEventListener('resize', background)
  // Only backend administrator supplied HTML/scripts are inserted here.
  const scriptElement = element => {
    const script = document.createElement('script')
    for (const attr of element.attributes) script.setAttribute(attr.name, attr.value)
    script.textContent = element.textContent
    script.onerror = () => { state.error = `Failed to load custom script: ${script.src}` }
    return script
  }
  const appendHtml = (html, target) => {
    const template = document.createElement('template')
    template.innerHTML = html
    for (const element of template.content.querySelectorAll('script')) element.replaceWith(scriptElement(element))
    target.append(template.content)
  }
  if (config.custom_head) appendHtml(config.custom_head, document.head)
  if (config.custom_script) {
    if (/<script\b/i.test(config.custom_script)) appendHtml(config.custom_script, document.body)
    else {
      const source = document.createElement('script')
      source.textContent = config.custom_script
      document.body.append(scriptElement(source))
    }
  }
}
