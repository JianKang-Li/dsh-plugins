/**
 * Host 半侧：删除单个会话的全部本地数据。
 *
 * DSH 的 sessionPersistence seam 没有删除能力，日志会一直累积，所以这里在确认
 * 会话未在运行后，直接删除 jsonl 后端为它写出的会话目录，并同步清理 Workspace
 * 记账、归档/置顶集合与投影缓存。删除是破坏性操作：任何前置校验失败都不会
 * 改动磁盘，也不会改动 Workspace 记账。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { isRealPathInside, resolveSessionDirectory } from './delete-target.js'

export const name = 'session-manager'
export const inject = ['connection', 'sessionPersistence']

/** 浏览器半侧读取的精确路由，位于 Connection 的认证 /api 前缀下。 */
export const API_PATH = '/api/session-manager/delete'

const MAX_SESSION_ID_LENGTH = 512

/** 投影缓存域在存储根下的位置（per-record 布局：每个会话一个文档）。 */
const PROJECTION_CACHE_DIR = ['storages', 'session_projcache', 'sessions']

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function failure(status, code, message) {
  return jsonResponse(status, { ok: false, error: { code, message } })
}

function messageOf(error) {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return 'unknown error'
  }
}

function firstLine(value, max = 300) {
  return messageOf(value).replace(/\s+/g, ' ').trim().slice(0, max)
}

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

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

/** 目录不存在时返回 undefined，让“已被并发删除”走幂等路径。 */
async function readDirectory(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * 从 Workspace 注册表移除会话记账，并同步清掉归档与置顶集合。
 *
 * 只改注册表自己的数据，绝不触碰会话日志；失败时抛错，调用方在删文件之前
 * 中止，保证“记账还在 = 数据还在”。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host 插件上下文。
 * @param {string} sessionId - 要移除的会话 id。
 * @returns {Promise<void>} 注册表写入完成后解析。
 */
async function detachFromWorkspace(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return

  for (const workspace of registry.list()) {
    if (!workspace.sessionIds.includes(sessionId)) continue
    await workspace.detachSession(sessionId)
    break
  }
  if (registry.archivedSessionIds.includes(sessionId)) await registry.unarchiveSession(sessionId)
  if (registry.pinnedSessionIds.includes(sessionId)) await registry.unpinSession(sessionId)
}

/**
 * 删除投影缓存里该会话的文档。缓存是派生数据，清理失败只记日志。
 * @param {string} sessionId - 已删除的会话 id。
 * @param {import('@deepseek-ai/cordis').Context['logger']} logger - Host 日志。
 * @returns {Promise<void>} 清理完成后解析。
 */
async function removeProjectionCache(sessionId, logger) {
  // 本记录以会话 id 作为文件名；不安全的名字不可能由该存储写出，跳过即可。
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return
  const file = path.join(resolveDshHome(), ...PROJECTION_CACHE_DIR, `${sessionId}.json`)
  try {
    await fs.rm(file, { force: true })
  } catch (error) {
    logger?.warn?.('[session-manager] projection cache cleanup failed: %s', firstLine(error))
  }
}

/**
 * 执行一次删除请求。
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host 插件上下文。
 * @param {Request} request - Connection 已认证的 POST 请求。
 * @param {import('@deepseek-ai/cordis').Context['logger']} logger - Host 日志。
 * @returns {Promise<Response>} JSON 响应；成功时 body 为 { ok: true, sessionId }。
 */
async function removeSession(ctx, request, logger) {
  const payload = await readJson(request)
  const sessionId = payload?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > MAX_SESSION_ID_LENGTH) {
    return failure(400, 'invalid-request', 'sessionId must be a non-empty string')
  }

  const persistence = ctx.sessionPersistence
  if (typeof persistence.locate !== 'function') {
    return failure(501, 'backend-unsupported', 'the configured session store does not expose session artifacts')
  }

  // Host 会把打开过的会话长期留在内存里（空闲也算），因此只拒绝正在跑回合的会话；
  // 已加载但空闲的会话可以删除，“当前窗口正在显示”由客户端侧另行拦截。
  const agents = ctx.get('agents')
  if (agents?.get(sessionId)?.status === 'running') {
    return failure(409, 'session-running', `session '${sessionId}' is running a turn`)
  }

  const snapshot = await persistence.stat(sessionId)
  if (snapshot === undefined) {
    return failure(404, 'session-not-found', `no stored session '${sessionId}'`)
  }

  const activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
  if (Array.isArray(activity) && activity.length > 0) {
    const kinds = activity.map((item) => item?.kind).filter((kind) => typeof kind === 'string')
    return failure(409, 'session-busy', `session '${sessionId}' still runs work: ${kinds.join(', ') || 'unknown'}`)
  }

  // 先校验目标形状，再改动 Workspace 记账：校验失败时磁盘与记账都保持原样。
  const location = persistence.locate(snapshot.header)
  const entries = await readDirectory(path.dirname(location.path))
  let directory = null
  if (entries !== undefined) {
    const target = resolveSessionDirectory(persistence.root, location.path, entries)
    if (!target.ok) {
      logger?.warn?.('[session-manager] refusing to delete %s: %s', location.path, target.reason)
      return failure(500, 'unexpected-layout', `refusing to delete session artifacts: ${target.reason}`)
    }
    if (!(await isRealPathInside(persistence.root, target.directory))) {
      logger?.warn?.('[session-manager] refusing to delete %s: directory escapes the session root', location.path)
      return failure(500, 'unexpected-layout', 'refusing to delete session artifacts: directory escapes the session root')
    }
    directory = target.directory
  }

  await detachFromWorkspace(ctx, sessionId)
  // Windows 上日志目录可能被杀毒或索引进程短暂占用，重试几次再放弃。
  if (directory !== null) {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
  await removeProjectionCache(sessionId, logger)

  logger?.info?.('[session-manager] deleted session %s', sessionId)
  return jsonResponse(200, { ok: true, sessionId })
}

async function handle(ctx, request, logger) {
  try {
    return await removeSession(ctx, request, logger)
  } catch (error) {
    logger?.warn?.('[session-manager] delete %s failed: %s', request.url, firstLine(error))
    return failure(500, 'delete-failed', firstLine(error))
  }
}

export function apply(ctx) {
  const logger = ctx.logger
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: API_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handle(ctx, request, logger),
      }),
    'session-manager: delete route',
  )
  logger?.info?.('[session-manager] POST %s ready', API_PATH)
}
