import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// 统计库位置在 apply 时由 DSH_HOME 决定，导入插件前先隔离到临时目录。
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-token-stats-test-'))
process.env.DSH_HOME = home

const { apply, API_PATH, CLEAR_API_PATH } = await import('../lib/index.js')

const baseTime = Date.now() - 60_000
const header = { id: 'session-a', createdAt: baseTime - 1000, cwd: '/tmp/a', origin: 'main' }

function usageEvent(seq, time, inputTokens, outputTokens) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      usage: { inputTokens, outputTokens },
      message: { source: { kind: 'model', provider: 'p', model: 'm' } },
    },
  }
}

/** 最小 Host 上下文：只实现插件实际用到的服务与路由注册。 */
function createHarness(state) {
  const routes = new Map()
  const disposers = []
  const warnings = []
  const ctx = {
    logger: {
      warn: (...args) => warnings.push(args.map(String).join(' ')),
      info() {},
    },
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    inject(_names, callback) {
      // 模拟 Cordis 子上下文：继承父上下文的会话服务，并额外提供 connection。
      callback(
        Object.assign(Object.create(ctx), {
          connection: {
            fetch: {
              register(route) {
                routes.set(route.path, route)
                return async () => {
                  routes.delete(route.path)
                }
              },
            },
          },
        }),
      )
    },
    sessions: { list: () => state.live },
    sessionPersistence: {
      list: async () => state.snapshots,
      open: async (id) => {
        const events = state.events.get(id)
        if (events === undefined) throw new Error(`missing session ${id}`)
        return {
          header,
          inheritedEventCount: 0,
          read: async () => ({ events }),
          close: async () => {},
        }
      },
    },
  }
  apply(ctx)
  return {
    routes,
    warnings,
    dispose: async () => {
      for (const dispose of disposers.reverse()) await dispose()
    },
  }
}

async function request(route, url, init = {}) {
  const response = await route.fetch(new Request(`http://127.0.0.1${url}`, init))
  return { status: response.status, body: await response.json() }
}

const state = {
  live: [],
  snapshots: [{ header, revision: 'rev-1', eventCount: 1, sizeBytes: 256 }],
  events: new Map([['session-a', [usageEvent(0, baseTime, 100, 10)]]]),
}
let harness = createHarness(state)
let getRoute = harness.routes.get(API_PATH)
let clearRoute = harness.routes.get(CLEAR_API_PATH)

/** 重新应用插件，模拟 Host 进程重启（统计库从磁盘重新加载）。 */
async function restartHarness() {
  await harness.dispose()
  harness = createHarness(state)
  getRoute = harness.routes.get(API_PATH)
  clearRoute = harness.routes.get(CLEAR_API_PATH)
}

test.after(async () => {
  await harness.dispose()
  await fs.rm(home, { recursive: true, force: true })
})

test('删除会话后统计保留，清理后只累计新调用', async () => {
  assert.ok(getRoute !== undefined)
  assert.ok(clearRoute !== undefined)
  assert.deepEqual([...clearRoute.methods], ['POST'])

  const first = await request(getRoute, API_PATH)
  assert.equal(first.status, 200, harness.warnings.join('\n'))
  assert.equal(first.body.ok, true)
  assert.equal(first.body.totals.totalTokens, 110)
  assert.equal(first.body.totals.sessions, 1)
  assert.equal(first.body.sessions[0].deleted, false)
  assert.equal(first.body.resetAt, 0)

  // Host 重启后统计库仍应存在。
  await restartHarness()
  const reloaded = await request(getRoute, API_PATH)
  assert.equal(reloaded.status, 200)
  assert.equal(reloaded.body.totals.totalTokens, 110)

  // 模拟会话目录被删除：持久化列表里不再有它，统计仍应保留。
  state.snapshots = []
  const afterDelete = await request(getRoute, API_PATH)
  assert.equal(afterDelete.status, 200)
  assert.equal(afterDelete.body.totals.totalTokens, 110)
  assert.equal(afterDelete.body.totals.sessions, 1)
  assert.equal(afterDelete.body.sessions[0].deleted, true)
  assert.equal(afterDelete.body.scanned.orphans, 1)

  // 孤儿条目也要落盘，Host 重启后继续保留。
  await restartHarness()
  const afterDeleteRestart = await request(getRoute, API_PATH)
  assert.equal(afterDeleteRestart.status, 200)
  assert.equal(afterDeleteRestart.body.totals.totalTokens, 110)
  assert.equal(afterDeleteRestart.body.sessions[0].deleted, true)

  // 清理后总量归零，并记录新的统计起点。
  const cleared = await request(clearRoute, CLEAR_API_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.ok, true)
  assert.ok(cleared.body.resetAt > 0)

  const emptied = await request(getRoute, API_PATH)
  assert.equal(emptied.status, 200)
  assert.equal(emptied.body.totals.totalTokens, 0)
  assert.equal(emptied.body.totals.sessions, 0)
  assert.equal(emptied.body.resetAt, cleared.body.resetAt)

  // 清理状态和统计起点同样要跨重启保留。
  await restartHarness()
  const emptiedRestart = await request(getRoute, API_PATH)
  assert.equal(emptiedRestart.status, 200)
  assert.equal(emptiedRestart.body.totals.totalTokens, 0)
  assert.equal(emptiedRestart.body.resetAt, cleared.body.resetAt)

  // 清理前的事件不计入，清理后新增的调用照常累计。
  state.events.set('session-a', [
    usageEvent(0, baseTime, 100, 10),
    usageEvent(1, Date.now() + 1000, 7, 3),
  ])
  state.snapshots = [{ header, revision: 'rev-2', eventCount: 2, sizeBytes: 512 }]
  const restarted = await request(getRoute, API_PATH)
  assert.equal(restarted.status, 200)
  assert.equal(restarted.body.totals.totalTokens, 10)
  assert.equal(restarted.body.totals.sessions, 1)
  assert.equal(restarted.body.sessions[0].deleted, false)
  assert.equal(restarted.body.sessions[0].inputTokens, 7)
  assert.equal(restarted.body.sessions[0].outputTokens, 3)
})
