import { themeOptions } from './useTheme.js'
import { state } from './useMonitor.js'
export const nodeKey = (siteIndex, id) => `${siteIndex}:${id}`
export const favorite = (siteIndex, id) => Array.isArray(themeOptions.value.favorites) && themeOptions.value.favorites.includes(nodeKey(siteIndex, id))
export function patchPreferences(patch) {
  const site = state.sites[0]
  if (site.config) site.config.theme_options = { ...site.config.theme_options, ...patch }
}
export function toggleFavorite(siteIndex, id) {
  const key = nodeKey(siteIndex, id)
  const values = Array.isArray(themeOptions.value.favorites) ? themeOptions.value.favorites : []
  patchPreferences({ favorites: values.includes(key) ? values.filter(value => value !== key) : [...values, key] })
}
