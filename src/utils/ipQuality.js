// Read archived reports only. No IP lookups or platform probes run in the theme.
export const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
export const available = value => value !== null && value !== undefined && value !== '' && !['null', 'undefined', 'n/a'].includes(String(value).toLowerCase())
export const reportText = value => available(value) && ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '—'
export function parseReports(input) {
  const items = Array.isArray(input) ? input : [input]
  if (!items.length || items.length > 100) throw new Error('report-count')
  return items.map(item => {
    const raw = object(item)
    if (!Object.keys(object(raw.Head)).length || !available(raw.Head.IP) ||
      !['Info', 'Score', 'Factor', 'Media', 'Mail'].some(key => Object.keys(object(raw[key])).length)) throw new Error('report-format')
    return raw
  }).sort((a, b) => String(b.Head.Time || '').localeCompare(String(a.Head.Time || '')))
}
export function embeddedReports(server) {
  return server?.ip_quality_reports ?? server?._config?.theme_options?.ip_quality_reports?.[server.id]
}
export function factorState(value) {
  if (value === true || value === 'true') return 'detected'
  if (value === false || value === 'false') return 'clear'
  return 'unknown'
}
export function mediaState(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'yes') return 'available'
  if (['no', 'block', 'blocked'].includes(text)) return 'blocked'
  if (/original|partial|自制|部分/.test(text)) return 'partial'
  return 'unknown'
}
export function maskedIp(ip) {
  const text = reportText(ip)
  if (text.includes('*')) return text
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(text)) return text.split('.').slice(0, 2).join('.') + '.*.*'
  if (text.includes(':')) return text.split(':').slice(0, 2).join(':') + ':*:*'
  return text
}
