import { describe, it, expect } from 'vitest'
import { parseReports, embeddedReports, factorState, mediaState, maskedIp, reportText } from '../src/utils/ipQuality.js'

const report = { Head: { IP: '192.0.2.1', Time: '2026-10-20 01:00:00 UTC' }, Factor: { Proxy: { IPQS: true, IPinfo: false } }, Media: { Netflix: { Status: 'Yes' } } }
describe('archived IP quality data', () => {
  it('preserves source results and orders archives without altering input', () => {
    const older = { ...report, Head: { ...report.Head, Time: '2026-10-19 01:00:00 UTC' } }
    const input = [older, report]
    expect(parseReports(input)).toEqual([report, older])
    expect(input[0]).toBe(older)
    expect(parseReports(report)[0]).toBe(report)
  })
  it('rejects unrelated JSON, empty archives and excessive lists', () => {
    for (const invalid of [null, {}, [], { Head: { IP: '192.0.2.1' } }, { Head: {}, Media: { Netflix: 'Yes' } }, Array(101).fill(report)]) expect(() => parseReports(invalid)).toThrow()
  })
  it('keeps missing values separate from negative and zero results', () => {
    expect(factorState(true)).toBe('detected')
    expect(factorState(false)).toBe('clear')
    for (const missing of [undefined, null, 'null', 0, 'timeout', '']) expect(factorState(missing)).toBe('unknown')
    expect(reportText(0)).toBe('0')
    expect(reportText('null')).toBe('—')
    expect(mediaState('Yes')).toBe('available')
    expect(mediaState('Block')).toBe('blocked')
    expect(mediaState('Originals Only')).toBe('partial')
    expect(mediaState('Timeout')).toBe('unknown')
  })
  it('selects reports only for the current backend node', () => {
    const server = { id: 'node-a', _config: { theme_options: { ip_quality_reports: { 'node-a': [report], 'node-b': [] } } } }
    expect(embeddedReports(server)).toEqual([report])
    expect(embeddedReports({ ...server, id: 'node-c' })).toBeUndefined()
    expect(embeddedReports({ ...server, ip_quality_reports: [] })).toEqual([])
  })
  it('masks full addresses in overview without modifying raw archives', () => {
    expect(maskedIp(report.Head.IP)).toBe('192.0.*.*')
    expect(maskedIp('2001:db8::1')).toBe('2001:db8:*:*')
    expect(maskedIp('38.105.*.*')).toBe('38.105.*.*')
    expect(report.Head.IP).toBe('192.0.2.1')
  })
})
