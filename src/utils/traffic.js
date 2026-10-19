import { numeric } from './metrics.js'

// Only explicit counter reports establish baselines; missing incremental fields
// never become artificial zero-traffic measurements.
export class TrafficSession {
  constructor() { this.baselines = new Map(); this.events = [] }
  disconnect(base) {
    for (const [key, value] of this.baselines) if (value.base === base) this.baselines.delete(key)
  }
  push(samples) {
    const events = []
    for (const sample of samples) {
      const { key, base, timestamp, data } = sample
      const prior = this.baselines.get(key) || { base }
      const next = { ...prior }
      const event = { key, base, timestamp }
      for (const [field, result] of [['net_rx', 'downBytes'], ['net_tx', 'upBytes']]) {
        if (!numeric(data[field]) || Number(data[field]) < 0) continue
        const value = Number(data[field]), previous = prior[field]
        if (previous && timestamp > previous.timestamp && timestamp - previous.timestamp <= 300000 && value >= previous.value) event[result] = value - previous.value
        if (!previous || timestamp > previous.timestamp) next[field] = { value, timestamp }
      }
      this.baselines.set(key, next)
      if (numeric(event.downBytes) || numeric(event.upBytes)) events.push(event)
    }
    this.events = [...this.events, ...events].filter(event => event.timestamp >= Date.now() - 1800000).slice(-10000)
    return events
  }
}
export function rankedNodes(records, field) {
  return records.filter(server => numeric(server[field]) && Number(server[field]) >= 0).map(server => ({ key: server._key, base: server._base, id: server.id, name: server.name || server.id, value: Number(server[field]) })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}
export function distribution(items) {
  const positive = items.filter(item => item.value > 0)
  const total = positive.reduce((sum, item) => sum + item.value, 0)
  const slices = positive.slice(0, 5)
  const rest = positive.slice(5).reduce((sum, item) => sum + item.value, 0)
  if (rest) slices.push({ key: 'other', name: '', value: rest, other: true })
  return { total, slices: slices.map(item => ({ ...item, percent: item.value / total * 100 })) }
}
