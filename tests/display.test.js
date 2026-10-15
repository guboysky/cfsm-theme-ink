import { test } from 'node:test'
import assert from 'node:assert/strict'
import { traffic, windowValues, loadValues, billing, probeTone, uptimeDays } from '../src/utils/display.js'
import { probeText, timestamp } from '../src/utils/metrics.js'
test('traffic quota is in GiB, monthly counters and calculation mode are respected', () => {
  const server = { traffic_limit: 2, net_rx: 100e9, net_tx: 100e9, net_rx_monthly: 1024 ** 3, net_tx_monthly: 0 }
  assert.equal(traffic(server).percentage, 50)
  assert.equal(traffic({ ...server, traffic_calc_type: 'ul' }).percentage, 0)
  assert.equal(traffic({ ...server, traffic_calc_type: 'max' }).percentage, 50)
  assert.equal(traffic({ net_rx: 1024, net_tx: 2048 }).used, 3072)
  assert.equal(traffic({ traffic_limit: 0 }).limit, 0)
})
test('probe windows keep absent and timeout buckets, including zero measurements', () => {
  assert.deepEqual(windowValues({ ping: [{ ct: false }, { ct: null }, { ct: 0, cu: 10 }, { cm: 0 }] }, 'ping'), [false, null, 5, 0])
  assert.equal(probeTone(false), 'absent'); assert.equal(probeTone(null), 'bad')
  assert.equal(probeTone(0, true), 'good')
})
test('uptime, pricing and load render only provided information', () => {
  assert.equal(billing({ price: '0' }, 'zh'), '免费')
  assert.equal(billing({ price: '-1' }, 'en'), 'Free')
  assert.equal(billing({ price: '' }, 'zh'), '')
  assert.equal(billing({ price: '33.15', currency: '$', billing_cycle: 'month' }, 'zh'), '$33.15 / 月')
  assert.deepEqual(loadValues('0.07, 0.03, 0.00'), [0.07, 0.03, 0])
  assert.equal(uptimeDays(undefined), null)
  assert.equal(timestamp('1700000000'), 1700000000000)
  assert.equal(timestamp('1700000000000'), 1700000000000)
  assert.equal(uptimeDays('1700000000', 1700000000000 + 5 * 86400000), 5)
  assert.equal(probeText(20.3333333333333, ' ms'), '20.3 ms')
})
