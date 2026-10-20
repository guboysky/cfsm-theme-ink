import { getConfig, request } from './http.js'
import { HOURS } from './metrics.js'
export { getConfig }
export const getServers = (base, config) => request(base, config, '/api/servers')
export const getServer = (base, config, id) => request(base, config, `/api/server?id=${encodeURIComponent(id)}`)
export const getIpQuality = (base, config, id, date = '') => request(base, config, `/api/ip-quality?id=${encodeURIComponent(id)}${date ? '&date=' + encodeURIComponent(date) : ''}`)
export const setupIpQuality = (base, config, id) => request(base, config, `/api/ip-quality/setup?id=${encodeURIComponent(id)}`, { method: 'POST' })
export function getHistory(base, config, id, hours = 0.167) {
  if (!HOURS.includes(Number(hours))) throw new Error('Unsupported history range')
  return request(base, config, `/api/history/all?id=${encodeURIComponent(id)}&hours=${hours}`)
}
export function saveOptions(base, config, options) {
  if (!options || Array.isArray(options) || typeof options !== 'object') throw new Error('theme_options must be an object')
  return request(base, config, '/api/theme_options', { method: 'POST', body: { theme_options: options } })
}
