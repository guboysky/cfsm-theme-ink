import { describe, expect, it } from 'vitest'
import { expiryInfo, expiryRanking, uptime, trafficAllowance, monthlyTraffic, segmentState, cardProbePoints } from '../src/utils/serverPresentation.js'

describe('reference card and expiry data', () => {
  const now = new Date(2026, 9, 19, 16)
  it('calculates calendar days without hour-of-day rounding', () => {
    expect(expiryInfo('2026-10-27', now)).toMatchObject({ date: '2026-10-27', days: 8 })
    expect(expiryInfo('2026-10-19', now).days).toBe(0)
    expect(expiryInfo('2026-10-18', now).days).toBe(-1)
    expect(expiryInfo('2026-11-01T00:00:00Z', now).days).toBe(13)
  })
  it('rejects absent and invalid expiry dates', () => {
    for (const value of ['', null, undefined, 'not a date', '2026-02-30', '2026-13-01']) expect(expiryInfo(value, now)).toBeNull()
  })
  it('orders real dates, keeps backend identity and obeys show_expire', () => {
    const server = (name, date, enabled = true) => ({ name, _key: name, _base: name, expire_date: date, _sys: { show_expire: enabled } })
    const ranking = expiryRanking([server('late', '2026-11-08'), server('early', '2026-10-27'), server('none', ''), server('hidden', '2026-10-20', false)], now)
    expect(ranking.map(item => item.server._key)).toEqual(['early', 'late'])
    expect(ranking[0].server._base).toBe('early')
  })
  it('reads second or millisecond boot times and rejects unknown or future boot times', () => {
    const current = Date.now(), boot = current - (7 * 24 + 23) * 3600000
    expect(uptime(String(boot), current)).toEqual({ days: 7, hours: 23 })
    expect(uptime(Math.floor(boot / 1000), current)).toEqual({ days: 7, hours: 23 })
    expect(uptime(undefined, current)).toBeNull()
    expect(uptime(current + 1000, current)).toBeNull()
  })
  it('keeps unknown quotas distinct from explicitly unlimited and handles GB units', () => {
    expect(trafficAllowance('')).toBeNull()
    expect(trafficAllowance(undefined)).toBeNull()
    expect(trafficAllowance('bad')).toBeNull()
    expect(trafficAllowance('0')).toBe(Infinity)
    expect(trafficAllowance('1024')).toBe(1024 ** 4)
    expect(trafficAllowance('1TB')).toBe(1024 ** 4)
    expect(trafficAllowance('512 MiB')).toBe(512 * 1024 ** 2)
  })
  it('uses monthly counters according to the backend calculation mode', () => {
    const server = { net_rx_monthly: 20, net_tx_monthly: 30, net_rx: 99999 }
    expect(monthlyTraffic({ ...server, traffic_calc_type: 'dl' })).toBe(20)
    expect(monthlyTraffic({ ...server, traffic_calc_type: 'ul' })).toBe(30)
    expect(monthlyTraffic({ ...server, traffic_calc_type: 'max' })).toBe(30)
    expect(monthlyTraffic({ ...server, traffic_calc_type: 'total' })).toBe(50)
    expect(monthlyTraffic({ net_rx: 99999 })).toBeNull()
    expect(monthlyTraffic({ net_rx_monthly: 0, net_tx_monthly: 0 })).toBe(0)
  })
  it('does not draw unconfigured probes as zero or timeouts as successes', () => {
    expect(segmentState(false, 'ping')).toBe('gap')
    expect(segmentState(undefined, 'loss')).toBe('gap')
    expect(segmentState(null, 'ping')).toBe('timeout')
    expect(segmentState(0, 'ping')).toBe('good')
    expect(segmentState(0, 'loss')).toBe('good')
    expect(segmentState(212, 'ping')).toBe('warn')
    expect(segmentState(10, 'loss')).toBe('bad')
  })
})

describe('one-hour card probe window', () => {
  it('keeps the full hour, rejects older/future samples and preserves tri-state values', () => {
    const now = 1800000000000
    const points = [{ ts: now - 3600001, ct: 90 }, { ts: now - 3600000, ct: 0 }, { ts: now - 900000, ct: null }, { ts: now - 1000, ct: false }, { ts: now + 1, ct: 5 }]
    expect(cardProbePoints(points, 'ct', now).map(point => point.value)).toEqual([0, null, false])
    expect(cardProbePoints(Array.from({ length: 30 }, (_, i) => ({ ts: now - i * 60000, ct: i })), 'ct', now)).toHaveLength(30)
    expect(cardProbePoints([{ ts: (now - 60000) / 1000, ct: 2 }], 'ct', now)[0].ts).toBe(now - 60000)
    expect(cardProbePoints(undefined, 'ct', now)).toEqual([])
  })
})
