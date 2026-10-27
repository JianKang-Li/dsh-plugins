/**
 * Host 半侧：把所有本机会话的 Token 用量聚合成一个只读 HTTP API。
 *
 * 活动会话直接读 ctx.sessions 的内存快照；历史会话通过 sessionPersistence
 * 的只读句柄读取。用量来自日志中的 assistant/message.usage。读取结果按
 * sessionPersistence 的 revision 缓存到磁盘，冷启动后只有新增或变化的会话
 * 需要重新解析。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  aggregateSession,
  aggregateSessions,
  CACHE_VERSION,
  normalizeRange,
} from './stats.js'

export const name = 'session-token-stats'
export const inject = ['sessions', 'sessionPersistence']

/** 浏览器半侧读取的精确路由，位于 Connection 的认证 /api 前缀下。 */
export const API_PATH = '/api/session-token-stats'

/** 同时解析的会话数；过大会争抢事件循环与磁盘。 */
const READ_CONCURRENCY = 4

function resolveDshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') {
    return path.resolve(configured.trim())
  }
  return path.join(os.homedir(), '.dsh')
}

function cacheFilePath() {
  return path.join(resolveDshHome(), 'storages', 'session-token-stats', `cache.v${CACHE_VERSION}.json`)
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
    typeof entry.signature === 'string' &&
    entry.byDay !== null &&
    typeof entry.byDay === 'object'
  )
}

function createStore(file, logger) {
  const entries = new Map()
  let loading = null
  let saveTimer = null
  let saveChain = Promise.resolve()

  async function load() {
    try {
      const text = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || parsed.version !== CACHE_VERSION) return
      if (parsed.entries === null || typeof parsed.entries !== 'object') return
      for (const [id, entry] of Object.entries(parsed.entries)) {
        if (validEntry(entry)) entries.set(id, entry)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        logger?.warn('[session-token-stats] cache read failed: %s', firstLine(error))
      }
    }
  }

  function ensure() {
    if (loading === null) loading = load()
    return loading
  }

  function get(id) {
    return entries.get(id)
  }

  function set(id, entry) {
    entries.set(id, entry)
  }

  function prune(ids) {
    for (const id of entries.keys()) {
      if (!ids.has(id)) entries.delete(id)
    }
  }

  async function save() {
    const payload = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
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
        logger?.warn('[session-token-stats] cache write failed: %s', firstLine(error))
      })
    }, 800)
    saveTimer.unref?.()
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
      logger?.warn('[session-token-stats] cache flush failed: %s', firstLine(error))
    }
  }

  return { ensure, get, set, prune, scheduleSave, dispose }
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

async function collect(ctx, store, range, signal, logger) {
  await store.ensure()

  const liveSessions = ctx.sessions.list()
  const liveIds = new Set(liveSessions.map((session) => String(session.header.id)))
  const snapshots = await ctx.sessionPersistence.list({ signal })
  const snapshotById = new Map()
  for (const snapshot of snapshots) {
    snapshotById.set(String(snapshot.header.id), snapshot)
  }
  store.prune(new Set(snapshotById.keys()))

  const entries = []
  let failed = 0
  let cacheHits = 0

  // 活动会话的事件已在内存中，直接折叠可拿到最新用量，也无需磁盘 I/O。
  for (const session of liveSessions) {
    try {
      const entry = aggregateSession(session.header, session.ownEvents(), 0)
      entry.live = true
      entry.signature = null
      entries.push(entry)
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
        entries.push({ ...cached, live: false })
        return
      }
    }

    let handle
    try {
      handle = await ctx.sessionPersistence.open(snapshot.header.id, 'read', { signal })
      const result = await handle.read(0, undefined, { signal })
      if (signal?.aborted) return
      const entry = aggregateSession(handle.header, result.events, Number(handle.inheritedEventCount) || 0)
      entry.live = false
      entry.signature = signature
      if (signature !== null) store.set(id, entry)
      entries.push(entry)
    } catch (error) {
      failed += 1
      if (failed <= 5) {
        logger?.warn('[session-token-stats] session %s read failed: %s', id, firstLine(error))
      }
    } finally {
      await handle?.close().catch(() => {})
    }
  })

  const summary = aggregateSessions(entries, range)
  store.scheduleSave()

  return {
    version: CACHE_VERSION,
    generatedAt: Date.now(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    range: { from: range.from ?? null, to: range.to ?? null },
    scanned: {
      sessions: new Set([...liveIds, ...snapshotById.keys()]).size,
      live: liveSessions.length,
      failed,
      cacheHits,
    },
    ...summary,
  }
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

export function apply(ctx) {
  const logger = ctx.logger
  const store = createStore(cacheFilePath(), logger)
  void store.ensure()

  ctx.effect(() => () => store.dispose(), 'session-token-stats: flush cache')

  ctx.inject(['connection'], (connectionCtx) => {
    return connectionCtx.connection.fetch.register({
      path: API_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) => handle(connectionCtx, store, request, logger),
    })
  })

  logger?.info?.('[session-token-stats] GET %s ready', API_PATH)
}
