import { numeric } from './metrics.js'

export function expiryInfo(value, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(String(value || '').trim())
  if (!match) return null
  const [, year, month, day] = match
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day)), parsed = new Date(timestamp)
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) return null
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return { date: `${year}-${month}-${day}`, timestamp, days: Math.round((timestamp - today) / 86400000) }
}
export function expiryRanking(records, now = new Date()) {
  return records.filter(server => server._sys?.show_expire === true).map(server => ({ server, expiry: expiryInfo(server.expire_date, now) })).filter(item => item.expiry).sort((a, b) => a.expiry.timestamp - b.expiry.timestamp || String(a.server.name || '').localeCompare(String(b.server.name || '')))
}
export function uptime(value, now = Date.now()) {
  if (!numeric(value) || Number(value) <= 0) return null
  const boot = Number(value) < 1e11 ? Number(value) * 1000 : Number(value)
  if (boot > now) return null
  const hours = Math.floor((now - boot) / 3600000)
  return { days: Math.floor(hours / 24), hours: hours % 24 }
}
export function trafficAllowance(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  if (numeric(value)) return Number(value) > 0 ? Number(value) * 1024 ** 3 : Infinity
  const match = /^(\d+(?:\.\d+)?)\s*(B|[KMGT]I?B)$/i.exec(String(value).trim())
  if (!match) return null
  return Number(match[1]) * 1024 ** ('BKMGT'.indexOf(match[2][0].toUpperCase()))
}
export function monthlyTraffic(server) {
  const rx = numeric(server.net_rx_monthly) ? Number(server.net_rx_monthly) : null
  const tx = numeric(server.net_tx_monthly) ? Number(server.net_tx_monthly) : null
  if (server.traffic_calc_type === 'dl') return rx
  if (server.traffic_calc_type === 'ul') return tx
  if (rx === null || tx === null) return null
  return server.traffic_calc_type === 'max' ? Math.max(rx, tx) : rx + tx
}
export function segmentState(value, type) {
  if (value === null) return 'timeout'
  if (!numeric(value)) return 'gap'
  const number = Number(value)
  if (type === 'loss') return number === 0 ? 'good' : number <= 5 ? 'warn' : 'bad'
  return number < 100 ? 'good' : number < 300 ? 'warn' : 'bad'
}

// Cards use only the supplied dashboard window, restricted to the latest hour.
export function cardProbePoints(points, lane, now = Date.now()) {
  return (Array.isArray(points) ? points : []).flatMap(point => {
    if (!numeric(point?.ts) || Number(point.ts) <= 0) return []
    const ts = Number(point.ts) < 1e11 ? Number(point.ts) * 1000 : Number(point.ts)
    return ts >= now - 3600000 && ts <= now ? [{ ts, value: point[lane] }] : []
  }).sort((a, b) => a.ts - b.ts)
}
