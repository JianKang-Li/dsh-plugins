/**
 * Host 半侧：把所有本机会话的 Token 用量聚合成一个只读 HTTP API，并提供清理接口。
 *
 * 统计结果独立持久化到 $DSH_HOME/storages/session-token-stats/stats.v2.json：
 * 会话被删除后，它在统计库里的记录仍会保留并继续计入总量。活动会话直接读
 * ctx.sessions 的内存快照；历史会话通过 sessionPersistence 的只读句柄读取。
 * 读取结果按 sessionPersistence 的 revision 缓存到统计库，冷启动后只有新增
 * 或变化的会话需要重新解析。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  aggregateSession,
  aggregateSessions,
  normalizeRange,
  STORE_VERSION,
} from './stats.js'

export const name = 'session-token-stats'
export const inject = ['sessions', 'sessionPersistence']

/** 浏览器半侧读取的精确路由，位于 Connection 的认证 /api 前缀下。 */
export const API_PATH = '/api/session-token-stats'

/** 清理统计的精确路由；POST 清空统计库并记录新的统计起点。 */
export const CLEAR_API_PATH = '/api/session-token-stats/clear'

/** 同时解析的会话数；过大会争抢事件循环与磁盘。 */
const READ_CONCURRENCY = 4

/** 统计库写盘防抖；清理与进程退出时会立即落盘。 */
const SAVE_DELAY_MS = 800

/** 扫描期间统计库被清理时的重试次数。 */
const COLLECT_ATTEMPTS = 3

/** 展开 `$DSH_HOME` 支持的 `~`、`~/`、`~\` 前缀，与 DSH 自身的 home 解析保持一致。 */
function expandHomePath(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

function resolveDshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') {
    return path.resolve(expandHomePath(configured.trim()))
  }
  return path.join(os.homedir(), '.dsh')
}

function storeFilePath() {
  return path.join(resolveDshHome(), 'storages', 'session-token-stats', `stats.v${STORE_VERSION}.json`)
}

function errorMessage(error) {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return 'unknown error'
  }
}

function firstLine(value, max = 300) {
  return errorMessage(value).replace(/\s+/g, ' ').trim().slice(0, max)
}

function timestampOf(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}

/**
 * 持久化快照的变更签名。revision 是后端定义的变更令牌；eventCount/sizeBytes
 * 用于跨进程重启时保守判断文件是否变化。
 */
function signatureOf(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return null
  const revision = snapshot.revision
  const eventCount = snapshot.eventCount
  const sizeBytes = snapshot.sizeBytes
  if (revision === undefined && eventCount === undefined && sizeBytes === undefined) return null
  return JSON.stringify([String(revision ?? ''), eventCount ?? null, sizeBytes ?? null])
}

function validEntry(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    (entry.signature === null || typeof entry.signature === 'string') &&
    entry.byDay !== null &&
    typeof entry.byDay === 'object'
  )
}

function createStore(file, logger) {
  const entries = new Map()
  let loading = null
  let saveTimer = null
  let saveChain = Promise.resolve()
  /** 统计起点；清理后早于它的模型调用不再计入。 */
  let resetAt = 0
  /** 清理会递增；扫描提交时用于丢弃清理前的结果。 */
  let generation = 0

  async function load() {
    try {
      const text = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || parsed.version !== STORE_VERSION) {
        return
      }
      if (parsed.entries === null || typeof parsed.entries !== 'object') {
        return
      }
      resetAt = timestampOf(parsed.resetAt)
      for (const [id, entry] of Object.entries(parsed.entries)) {
        // 进程重启后不再有活动会话，live 只按当前会话列表重新计算。
        if (validEntry(entry)) entries.set(id, { ...entry, live: false })
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        logger?.warn('[session-token-stats] statistics read failed: %s', firstLine(error))
      }
    }
  }

  function ensure() {
    if (loading === null) loading = load()
    return loading
  }

  /** 读取统计起点与版本；两者只在清理时一起变化。 */
  function state() {
    return { generation, resetAt }
  }

  function get(id) {
    return entries.get(id)
  }

  function snapshot() {
    return Array.from(entries.values())
  }

  /** 合并一次扫描结果；generation 变化说明期间执行过清理，调用方应重新扫描。 */
  function commit(next, expectedGeneration) {
    if (expectedGeneration !== generation) return false
    for (const [id, entry] of next) entries.set(id, entry)
    scheduleSave()
    return true
  }

  async function save() {
    const payload = {
      version: STORE_VERSION,
      savedAt: Date.now(),
      resetAt,
      entries: Object.fromEntries(entries),
    }
    const directory = path.dirname(file)
    const temporary = `${file}.tmp-${process.pid}`
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(temporary, JSON.stringify(payload), 'utf8')
    await fs.rename(temporary, file)
  }

  function scheduleSave() {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveChain = saveChain.then(save).catch((error) => {
        logger?.warn('[session-token-stats] statistics write failed: %s', firstLine(error))
      })
    }, SAVE_DELAY_MS)
    saveTimer.unref?.()
  }

  /**
   * 清空统计并记录新的统计起点。
   * 写盘失败时恢复内存状态，避免界面显示与重启后的数据不一致。
   * @returns {Promise<number>} 新的统计起点毫秒时间戳。
   */
  async function clear() {
    await ensure()
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await saveChain

    const previous = new Map(entries)
    const previousResetAt = resetAt
    // 清空与起点在同一段同步代码内完成，进行中的扫描只能重试或看到清理后的状态。
    entries.clear()
    resetAt = Date.now()
    generation += 1

    const write = saveChain.then(save)
    saveChain = write.catch((error) => {
      logger?.warn('[session-token-stats] statistics write failed: %s', firstLine(error))
    })
    try {
      await write
    } catch (error) {
      entries.clear()
      for (const [id, entry] of previous) entries.set(id, entry)
      resetAt = previousResetAt
      generation += 1
      throw error
    }
    return resetAt
  }

  async function dispose() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    try {
      await saveChain
      await save()
    } catch (error) {
      logger?.warn('[session-token-stats] statistics flush failed: %s', firstLine(error))
    }
  }

  return { ensure, state, get, snapshot, commit, clear, dispose }
}

async function mapLimit(items, limit, worker) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

/**
 * 扫描一次会话并合并进统计库。
 * @returns {Promise<object | null>} 统计结果；扫描期间执行过清理时返回 null。
 */
async function collectOnce(ctx, store, range, signal, logger, state) {
  const liveSessions = ctx.sessions.list()
  const liveIds = new Set(liveSessions.map((session) => String(session.header.id)))
  const snapshots = await ctx.sessionPersistence.list({ signal })
  const currentIds = new Set(liveIds)
  for (const snapshot of snapshots) currentIds.add(String(snapshot.header.id))

  const fresh = new Map()
  let failed = 0
  let cacheHits = 0

  // 活动会话的事件已在内存中，直接折叠可拿到最新用量，也无需磁盘 I/O。
  for (const session of liveSessions) {
    try {
      const entry = aggregateSession(session.header, session.ownEvents(), 0, state.resetAt)
      entry.live = true
      entry.signature = null
      fresh.set(String(session.header.id), entry)
    } catch (error) {
      failed += 1
      if (failed <= 5) {
        logger?.warn('[session-token-stats] live session %s read failed: %s', String(session.header.id), firstLine(error))
      }
    }
  }

  const persisted = snapshots.filter((snapshot) => !liveIds.has(String(snapshot.header.id)))
  await mapLimit(persisted, READ_CONCURRENCY, async (snapshot) => {
    if (signal?.aborted) return
    const id = String(snapshot.header.id)
    const signature = signatureOf(snapshot)

    if (signature !== null) {
      const cached = store.get(id)
      if (cached !== undefined && cached.signature === signature) {
        cacheHits += 1
        fresh.set(id, cached)
        return
      }
    }

    let handle
    try {
      handle = await ctx.sessionPersistence.open(snapshot.header.id, 'read', { signal })
      const result = await handle.read(0, undefined, { signal })
      if (signal?.aborted) return
      const entry = aggregateSession(
        handle.header,
        result.events,
        Number(handle.inheritedEventCount) || 0,
        state.resetAt,
      )
      entry.live = false
      entry.signature = signature
      fresh.set(id, entry)
    } catch (error) {
      failed += 1
      if (failed <= 5) {
        logger?.warn('[session-token-stats] session %s read failed: %s', id, firstLine(error))
      }
    } finally {
      await handle?.close().catch(() => {})
    }
  })

  if (signal?.aborted) throw new Error('request aborted')
  if (!store.commit(fresh, state.generation)) {
    return null
  }

  const entries = []
  let orphans = 0
  for (const entry of store.snapshot()) {
    const id = String(entry.id)
    const deleted = !currentIds.has(id)
    if (deleted) orphans += 1
    entries.push({ ...entry, live: liveIds.has(id), deleted })
  }

  const summary = aggregateSessions(entries, range)

  return {
    version: STORE_VERSION,
    generatedAt: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    range: { from: range.from ?? null, to: range.to ?? null },
    resetAt: state.resetAt,
    scanned: {
      sessions: currentIds.size,
      live: liveSessions.length,
      failed,
      cacheHits,
      orphans,
    },
    ...summary,
  }
}

async function collect(ctx, store, range, signal, logger) {
  await store.ensure()
  for (let attempt = 0; attempt < COLLECT_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error('request aborted')
    const state = store.state()
    const result = await collectOnce(ctx, store, range, signal, logger, state)
    if (result !== null) {
      return result
    }
  }
  throw new Error('statistics changed during collection; please retry')
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function handle(ctx, store, request, logger) {
  const url = new URL(request.url)
  const range = normalizeRange(url.searchParams.get('from'), url.searchParams.get('to'))
  if (!range.ok) {
    return jsonResponse(400, {
      ok: false,
      error: { code: range.code, message: range.message },
    })
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  request.signal?.addEventListener('abort', abort, { once: true })
  try {
    const result = await collect(ctx, store, range, controller.signal, logger)
    return jsonResponse(200, { ok: true, ...result })
  } catch (error) {
    if (controller.signal.aborted) {
      return jsonResponse(499, {
        ok: false,
        error: { code: 'request-aborted', message: 'request aborted' },
      })
    }
    logger?.warn('[session-token-stats] aggregation failed: %s', firstLine(error))
    return jsonResponse(500, {
      ok: false,
      error: { code: 'aggregation-failed', message: firstLine(error) },
    })
  } finally {
    request.signal?.removeEventListener('abort', abort)
  }
}

async function handleClear(store, logger) {
  try {
    const clearedAt = await store.clear()
    logger?.info?.('[session-token-stats] statistics cleared')
    return jsonResponse(200, { ok: true, resetAt: clearedAt })
  } catch (error) {
    logger?.warn?.('[session-token-stats] clear failed: %s', firstLine(error))
    return jsonResponse(500, {
      ok: false,
      error: { code: 'clear-failed', message: firstLine(error) },
    })
  }
}

export function apply(ctx) {
  const logger = ctx.logger
  const store = createStore(storeFilePath(), logger)
  void store.ensure()

  ctx.effect(() => () => store.dispose(), 'session-token-stats: flush statistics')

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.fetch.register({
      path: API_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => handle(connectionCtx, store, request, logger),
    })
    connectionCtx.connection.fetch.register({
      path: CLEAR_API_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: () => handleClear(store, logger),
    })
  })

  logger?.info?.('[session-token-stats] GET %s, POST %s ready', API_PATH, CLEAR_API_PATH)
}
