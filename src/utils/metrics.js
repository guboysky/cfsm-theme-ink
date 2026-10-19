export const HOURS = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168]
export const LANES = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4']
export const present = value => value !== false && value !== undefined
export const numeric = value => value !== null && value !== false && value !== undefined && value !== '' && Number.isFinite(Number(value))
export function bytes(value, speed = false) {
  if (!numeric(value)) return '—'
  const n = Math.max(0, Number(value))
  const i = n ? Math.min(4, Math.floor(Math.log(n) / Math.log(1024))) : 0
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}${speed ? '/s' : ''}`
}
export const percent = (used, total) => numeric(used) && Number(total) > 0 ? Math.max(0, Math.min(100, Number(used) / Number(total) * 100)) : null
export const pct = value => numeric(value) ? `${Number(value).toFixed(1)}%` : '—'
export const online = (server, now = Date.now()) => numeric(server.last_updated) && now - Number(server.last_updated) < 300000
export function gpu(value) {
  try { const result = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(result) ? result : [] } catch { return [] }
}
const fields = new Set(('name server_group tags price currency billing_cycle auto_renewal expire_date traffic_limit traffic_calc_type reset_day report_interval wss_report_interval is_hidden sort_order cpu load_avg net_in_speed net_out_speed net_rx net_tx net_rx_monthly net_tx_monthly processes tcp_conn udp_conn ram_total ram_used swap_total swap_used disk_total disk_used disk cpu_cores cpu_info gpu_info arch os kernel_version region ip_v4 ip_v6 boot_time last_updated timestamp agent_version').split(' ').concat(LANES.flatMap(lane => [`ping_${lane}`, `loss_${lane}`])))
export function mergeMetrics(previous, patch) {
  const result = { ...previous }
  for (const [key, value] of Object.entries(patch || {})) {
    if (fields.has(key) && value !== undefined) result[key] = key === 'disk' && value && typeof value === 'object' ? { ...previous.disk, ...value } : value
  }
  return result
}
export function collectBatch(message, pending, ids) {
  if (message.type !== 'batchUpdate') return
  for (const update of message.updates || []) {
    if (!ids.has(update.serverId)) continue
    for (const sample of update.samples || []) {
      const patch = sample.data || sample.payload || sample.metrics || {}
      const old = pending.get(update.serverId) || {}
      if (Number(sample.ts) < Number(old.timestamp || 0)) continue
      pending.set(update.serverId, mergeMetrics(old, { ...patch, timestamp: sample.ts, last_updated: patch.last_updated ?? update.reportTs ?? sample.ts }))
    }
  }
}
export function laneName(config, lane, t) {
  if (lane.startsWith('node_')) return config[`${lane}_name`] || `Node ${lane.slice(-1)}`
  return config[`custom_${lane}_name`] || ({ ct: t('电信', 'CT'), cu: t('联通', 'CU'), cm: t('移动', 'CM'), bd: 'BGP' })[lane]
}
export const osIcon = os => {
  const name = String(os || '').toLowerCase()
  return ['ubuntu', 'debian', 'centos', 'alpine', 'fedora', 'arch', 'windows', 'rocky', 'almalinux'].find(s => name.includes(s))
}
