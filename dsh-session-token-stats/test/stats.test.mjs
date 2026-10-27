import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateSession,
  aggregateSessions,
  localDayKey,
  normalizeRange,
  usageTotal,
} from '../lib/stats.js'

const day1 = new Date(2026, 9, 1, 23, 50).getTime()
const day2 = new Date(2026, 9, 2, 0, 10).getTime()
const key1 = localDayKey(day1)
const key2 = localDayKey(day2)

function fixture(overrides = {}) {
  const header = {
    id: 'session-test',
    createdAt: new Date(2026, 9, 1, 23, 0).getTime(),
    cwd: '/tmp/project',
    isSeeded: true,
    ...overrides,
  }
  const events = [
    {
      type: 'assistant/message',
      seq: 0,
      time: day1,
      data: {
        usage: { inputTokens: 999, outputTokens: 999 },
        message: { source: { kind: 'model', provider: 'inherited', model: 'parent' } },
      },
    },
    { type: 'request/header', seq: 1, time: day1, data: { header: { config: { provider: 'p', model: 'm1' } } } },
    {
      type: 'user/message',
      seq: 2,
      time: day1,
      data: { content: [{ type: 'text', text: '  hello   world ' }] },
    },
    {
      type: 'assistant/message',
      seq: 3,
      time: day1,
      data: {
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheWriteTokens: 5,
          reasoningTokens: 7,
        },
        message: { source: { kind: 'model', provider: 'p', model: 'm1' } },
      },
    },
    {
      type: 'assistant/message',
      seq: 4,
      time: day2,
      data: {
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        message: { source: { kind: 'model', provider: 'q', model: 'm2' } },
      },
    },
    { type: 'session/title', seq: 5, time: day2, data: { title: '  My title  ' } },
  ]
  return { header, events }
}

test('usageTotal 使用互不重叠的字段，并兼容仅上报 totalTokens', () => {
  assert.equal(
    usageTotal({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 999 }),
    10,
  )
  assert.equal(usageTotal({ totalTokens: 42 }), 42)
  assert.equal(usageTotal(null), 0)
})

test('aggregateSession 跳过 fork 继承前缀并按本地日期分桶', () => {
  const { header, events } = fixture()
  const entry = aggregateSession(header, events, 1)

  assert.equal(entry.title, 'My title')
  assert.equal(entry.titleSource, 'title')
  assert.equal(entry.firstAt, day1)
  assert.equal(entry.lastAt, day2)

  assert.deepEqual(Object.keys(entry.byDay).sort(), [key1, key2].sort())
  assert.equal(entry.byDay[key1].calls, 1)
  assert.equal(entry.byDay[key1].totalTokens, 155)
  assert.equal(entry.byDay[key1].reasoningTokens, 7)
  assert.equal(entry.byDay[key2].calls, 1)
  assert.equal(entry.byDay[key2].totalTokens, 12)

  const models = Object.values(entry.byDay[key1].models)
  assert.equal(models.length, 1)
  assert.equal(models[0].provider, 'p')
  assert.equal(models[0].model, 'm1')
  assert.equal(models[0].totalTokens, 155)
})

test('没有标题时回退到首条用户消息', () => {
  const { header, events } = fixture()
  const entry = aggregateSession(header, events.filter((event) => event.type !== 'session/title'), 1)
  assert.equal(entry.title, 'hello world')
  assert.equal(entry.titleSource, 'prompt')
})

test('aggregateSessions 按本地日期范围过滤并汇总模型', () => {
  const { header, events } = fixture()
  const entry = aggregateSession(header, events, 1)

  const all = aggregateSessions([entry], { fromMs: null, toMs: null })
  assert.equal(all.totals.calls, 2)
  assert.equal(all.totals.sessions, 1)
  assert.equal(all.totals.totalTokens, 167)
  assert.equal(all.byDay.length, 2)
  assert.equal(all.byModel.length, 2)

  const secondDay = normalizeRange('2026-10-02', '2026-10-02')
  assert.equal(secondDay.ok, true)
  const filtered = aggregateSessions([entry], secondDay)
  assert.equal(filtered.totals.calls, 1)
  assert.equal(filtered.totals.totalTokens, 12)
  assert.equal(filtered.sessions[0].models.length, 1)
  assert.equal(filtered.sessions[0].models[0].model, 'm2')
  assert.deepEqual(filtered.byDay.map((day) => day.day), [key2])

  const emptyRange = normalizeRange('2026-10-03', '2026-10-03')
  const empty = aggregateSessions([entry], emptyRange)
  assert.equal(empty.totals.calls, 0)
  assert.equal(empty.sessions.length, 0)
})

test('normalizeRange 拒绝非法日期和倒置范围', () => {
  assert.equal(normalizeRange('2026-02-30', null).ok, false)
  assert.equal(normalizeRange('2026-10-02', '2026-10-01').ok, false)
  assert.equal(normalizeRange(null, null).ok, true)
  const range = normalizeRange('2026-10-01', '2026-10-02')
  assert.equal(range.ok, true)
  assert.equal(range.toMs - range.fromMs, 2 * 24 * 60 * 60 * 1000)
})
