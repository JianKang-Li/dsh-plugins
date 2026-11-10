/**
 * Host 半侧：按会话的工作目录读取本地 Git 差异，供右侧栏面板展示。
 *
 * 只读：执行的都是 `git rev-parse`、`git diff`、`git ls-files` 一类不写索引、
 * 不改工作区的命令。基准始终来自本地（HEAD 或索引），不识别远程托管平台，
 * 因此 gitolite、自建仓库、detached HEAD 都能用。
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MAX_UNTRACKED_FILE_BYTES, parsePatch, summarize, untrackedEntry } from './git.js'

export const name = 'git-diff'

/** 需要的服务：认证 Fetch 通道、按 id 取会话、取会话工作目录。 */
export const inject = ['connection', 'sessions', 'workingDirectory']

/** 浏览器半侧读取的精确路由，位于 Connection 的认证 /api 前缀下。 */
const API_PATH = '/api/git-diff/diff'

const SCOPES = new Set(['all', 'staged', 'unstaged', 'untracked'])

/** 单次响应的补丁上限，超过时要求用户缩小范围。 */
const MAX_PATCH_BYTES = 4 * 1024 * 1024

/** 单次响应最多列出的文件数，其余计入 omitted。 */
const MAX_FILES = 500

/** 未跟踪文件最多列出多少个。 */
const MAX_UNTRACKED_FILES = 200

const GIT_TIMEOUT_MS = 15000

/** git 全局参数：关闭路径引号，保证非 ASCII 路径可读。 */
const GIT_GLOBAL = ['-c', 'core.quotePath=false']

/**
 * 统一的 JSON 响应。
 * @param {number} status - HTTP 状态码。
 * @param {object} body - 响应体。
 * @returns {Response} Fetch 响应。
 */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * 失败响应。
 * @param {number} status - HTTP 状态码。
 * @param {string} code - 稳定的错误码。
 * @param {string} message - 人类可读的原因。
 * @returns {Response} Fetch 响应。
 */
function failure(status, code, message) {
  return jsonResponse(status, { ok: false, error: { code, message } })
}

/**
 * 取错误的第一行文本。
 * @param {unknown} value - 任意错误值。
 * @param {number} max - 截断长度。
 * @returns {string} 单行描述。
 */
function firstLine(value, max = 300) {
  const text = value instanceof Error ? value.message : String(value ?? '')
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * 在指定目录运行 git，返回原始字节。
 * @param {string} cwd - 运行目录。
 * @param {Array<string>} args - 子命令与参数。
 * @returns {Promise<{ok: true, stdout: Buffer} | {ok: false, message: string, overflow: boolean}>} 结果。
 */
function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      [...GIT_GLOBAL, ...args],
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_PATCH_BYTES + 1024 * 1024, encoding: 'buffer' },
      (error, stdout, stderr) => {
        if (error === null || error === undefined) {
          resolve({ ok: true, stdout })
          return
        }
        const overflow = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        const reason = firstLine(stderr) || firstLine(error)
        resolve({ ok: false, message: reason === '' ? 'git 执行失败' : reason, overflow })
      },
    )
  })
}

/**
 * 运行 git 并返回去掉结尾换行的 UTF-8 文本。
 * @param {string} cwd - 运行目录。
 * @param {Array<string>} args - 子命令与参数。
 * @returns {Promise<string | null>} 失败时为 null。
 */
async function runGitText(cwd, args) {
  const result = await runGit(cwd, args)
  if (!result.ok) {
    return null
  }
  return result.stdout.toString('utf8').replace(/\r?\n$/, '')
}

/**
 * 读取会话所在仓库的根目录与当前引用。
 * @param {string} cwd - 会话工作目录。
 * @returns {Promise<{ok: true, root: string, branch: string, head: string, detached: boolean} | {ok: false, message: string}>} 检出信息。
 */
async function readCheckout(cwd) {
  const root = await runGitText(cwd, ['rev-parse', '--show-toplevel'])
  if (root === null || root === '') {
    return { ok: false, message: '当前目录不在 Git 检出中' }
  }

  const branch = await runGitText(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const head = await runGitText(root, ['rev-parse', '--short', 'HEAD'])
  return {
    ok: true,
    root,
    branch: branch ?? '',
    head: head ?? '',
    detached: branch === null || branch === 'HEAD',
  }
}

/**
 * 列出未跟踪文件并逐个读成「新增文件」条目。
 * @param {string} root - 仓库根目录。
 * @returns {Promise<{files: Array<object>, oversized: number, omitted: number}>} 条目与统计。
 */
async function readUntracked(root) {
  const listed = await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (!listed.ok) {
    return { files: [], oversized: 0, omitted: 0 }
  }

  const names = listed.stdout
    .toString('utf8')
    .split('\0')
    .filter((item) => item !== '')

  const omitted = Math.max(0, names.length - MAX_UNTRACKED_FILES)
  const files = []
  let oversized = 0

  for (const name of names.slice(0, MAX_UNTRACKED_FILES)) {
    const absolute = path.resolve(root, name)
    let stat = null
    try {
      stat = await fs.stat(absolute)
    } catch {
      continue
    }
    if (!stat.isFile()) {
      continue
    }
    if (stat.size > MAX_UNTRACKED_FILE_BYTES) {
      oversized += 1
      files.push({
        path: name,
        previousPath: null,
        status: 'added',
        binary: false,
        untracked: true,
        oversized: true,
        additions: 0,
        deletions: 0,
        hunks: [],
      })
      continue
    }
    try {
      files.push(untrackedEntry(name, await fs.readFile(absolute)))
    } catch {
      continue
    }
  }

  return { files, oversized, omitted }
}

/**
 * 按范围收集差异。
 * @param {string} root - 仓库根目录。
 * @param {string} scope - `all`、`staged`、`unstaged` 或 `untracked`。
 * @returns {Promise<{ok: true, files: Array<object>, extra: object} | {ok: false, code: string, message: string}>} 差异。
 */
async function readDiff(root, scope) {
  const diffArgs = ['-M', '--no-color', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty']

  if (scope === 'untracked') {
    const untracked = await readUntracked(root)
    return { ok: true, files: untracked.files, extra: untracked }
  }

  let args
  if (scope === 'staged') {
    args = ['diff', '--cached', ...diffArgs]
  } else if (scope === 'unstaged') {
    args = ['diff', ...diffArgs]
  } else {
    args = ['diff', 'HEAD', ...diffArgs]
  }

  const patch = await runGit(root, args)
  if (!patch.ok) {
    if (scope === 'all' && /unknown revision|ambiguous argument|not a valid object name/i.test(patch.message)) {
      return { ok: false, code: 'no-commits', message: '仓库还没有提交，无法以 HEAD 为基准；可先查看「已暂存」' }
    }
    if (patch.overflow) {
      return { ok: false, code: 'diff-too-large', message: '差异内容超过 4 MB，请先提交部分改动或缩小范围' }
    }
    return { ok: false, code: 'git-failed', message: patch.message }
  }

  if (patch.stdout.length > MAX_PATCH_BYTES) {
    return { ok: false, code: 'diff-too-large', message: '差异内容超过 4 MB，请先提交部分改动或缩小范围' }
  }

  const files = parsePatch(patch.stdout.toString('utf8'))
  if (scope === 'all') {
    const untracked = await readUntracked(root)
    return {
      ok: true,
      files: [...files, ...untracked.files],
      extra: { oversized: untracked.oversized, omitted: untracked.omitted },
    }
  }

  return { ok: true, files, extra: { oversized: 0, omitted: 0 } }
}

/**
 * 处理一次差异请求。
 * @param {object} ctx - 插件上下文。
 * @param {Request} request - 已认证的请求。
 * @returns {Promise<Response>} 响应。
 */
async function handle(ctx, request) {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('session') ?? ''
  const scope = url.searchParams.get('scope') ?? 'all'

  if (sessionId === '') {
    return failure(400, 'missing-session', '缺少 session 参数')
  }
  if (!SCOPES.has(scope)) {
    return failure(400, 'invalid-scope', `不支持的范围：${scope}`)
  }

  const session = ctx.sessions.get(sessionId)
  if (session === undefined) {
    return failure(404, 'session-not-found', '会话不存在或已关闭')
  }

  const cwd = ctx.workingDirectory.get(session)
  const checkout = await readCheckout(cwd)
  if (!checkout.ok) {
    return failure(409, 'not-a-checkout', checkout.message)
  }

  const diff = await readDiff(checkout.root, scope)
  if (!diff.ok) {
    const status = diff.code === 'diff-too-large' ? 413 : 500
    return failure(status, diff.code, diff.message)
  }

  const omitted = Math.max(0, diff.files.length - MAX_FILES) + (diff.extra.omitted ?? 0)
  const files = diff.files.slice(0, MAX_FILES)

  return jsonResponse(200, {
    ok: true,
    value: {
      root: checkout.root,
      branch: checkout.branch,
      head: checkout.head,
      detached: checkout.detached,
      scope,
      files,
      totals: summarize(files),
      untracked: files.filter((file) => file.untracked).length,
      oversized: diff.extra.oversized ?? 0,
      omitted,
    },
  })
}

/**
 * 注册路由。
 * @param {object} ctx - 插件上下文。
 * @returns {void}
 */
export function apply(ctx) {
  const logger = ctx.logger
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: API_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            return await handle(ctx, request)
          } catch (error) {
            logger?.warn?.('[git-diff] %s failed: %s', request.url, firstLine(error))
            return failure(500, 'internal-error', firstLine(error))
          }
        },
      }),
    'git-diff: diff route',
  )
  logger?.info?.('[git-diff] GET %s ready', API_PATH)
}
