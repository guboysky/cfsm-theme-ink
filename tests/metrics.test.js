import { describe, expect, it } from 'vitest'
import { mergeMetrics, collectBatch, bytes, gpu, online, percent, present, numeric, HOURS, laneName } from '../src/utils/metrics.js'
describe('metric semantics', () => {
  it('preserves report fields across incremental samples', () => {
    const old = { id: 'a', disk_used: 240, gpu_info: [{ id: 0 }], ping_ct: null, loss_ct: 0, disk: { read_bps: 100, write_bps: 10 } }
    const result = mergeMetrics(old, { cpu: 20, ram_used: 500, disk: { read_bps: 50 }, ping_cu: false, name: undefined, secret: 'ignored' })
    expect(result).toEqual({ ...old, cpu: 20, ram_used: 500, disk: { read_bps: 50, write_bps: 10 }, ping_cu: false })
  })
  it('keeps false, null, and zero distinct', () => {
    expect(present(false)).toBe(false); expect(present(undefined)).toBe(false)
    expect(present(null)).toBe(true); expect(present(0)).toBe(true)
    expect(numeric(null)).toBe(false); expect(numeric(false)).toBe(false); expect(numeric(0)).toBe(true)
  })
  it('merges all samples but keeps the latest value and report fields', () => {
    const pending = new Map()
    collectBatch({ type: 'batchUpdate', updates: [{ serverId: 'a', samples: [{ ts: 1, data: { cpu: 1, ping_ct: null } }, { ts: 2, payload: { cpu: 2, disk_used: 4 } }, { ts: 3, metrics: { cpu: 0, loss_ct: 0 } }] }, { serverId: 'other', samples: [{ ts: 3, data: { cpu: 90 } }] }] }, pending, new Set(['a']))
    expect(pending.size).toBe(1)
    expect(pending.get('a')).toMatchObject({ cpu: 0, disk_used: 4, ping_ct: null, loss_ct: 0, last_updated: 3 })
    collectBatch({ type: 'batchUpdate', updates: [{ serverId: 'a', samples: [{ ts: 1, data: { cpu: 99 } }] }] }, pending, new Set(['a']))
    expect(pending.get('a').cpu).toBe(0)
  })
  it('uses five minutes for online status', () => {
    expect(online({ last_updated: 1000 }, 300999)).toBe(true)
    expect(online({ last_updated: 1000 }, 301000)).toBe(false)
    expect(online({})).toBe(false)
  })
  it('uses bytes and parses only gpu_info structure', () => {
    expect(bytes(1024, true)).toBe('1.0 KB/s')
    expect(bytes(0)).toBe('0 B'); expect(bytes(null)).toBe('—')
    expect(percent(2, 8)).toBe(25); expect(percent(0, 0)).toBeNull()
    expect(gpu('[{"id":"0","name":"RTX","info":0}]')[0].info).toBe(0)
    expect(gpu('invalid')).toEqual([])
    expect(HOURS).toEqual([0.167, 0.5, 1, 6, 12, 24, 48, 96, 168])
    expect(laneName({ custom_bd_name: 'My BGP' }, 'bd', z => z)).toBe('My BGP')
    expect(laneName({}, 'node_4', z => z)).toBe('Node 4')
  })
})
