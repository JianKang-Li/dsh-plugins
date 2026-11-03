/**
 * 删除目标解析：把会话持久化后端给出的日志路径收敛成一个可安全删除的会话目录。
 *
 * jsonl 后端把每个会话放在 <root>/<项目目录>/<编码后的会话 id>/ 下，日志文件名
 * 形如 session.v4.jsonl.zstd。目录删除是破坏性操作，所以只接受这一形状，并要
 * 求目录里确实存在会话日志；否则宁可拒绝，也不把根目录或项目目录当成会话目录。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/** jsonl 后端写出的会话日志文件名，覆盖历史 generation 与压缩后缀。 */
const SESSION_LOG_FILE = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/

/**
 * 判断一个文件名是否是会话日志文件。
 * @param {string} name - 目录项名称。
 * @returns {boolean} 是否匹配 jsonl 后端的日志文件命名。
 */
export function isSessionLogFile(name) {
  return typeof name === 'string' && SESSION_LOG_FILE.test(name)
}

/**
 * 判断相对路径是否已经离开基准目录。
 * @param {string} relative - path.relative 的结果。
 * @returns {boolean} 空路径、`..` 开头或绝对路径都算离开基准目录。
 */
function escapesRoot(relative) {
  return relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

/**
 * 校验日志路径并返回应删除的会话目录。
 * @param {unknown} root - 会话持久化后端的根目录。
 * @param {unknown} logPath - 后端给出的当前 generation 日志绝对路径。
 * @param {readonly { name: string, isFile: () => boolean }[] | undefined} entries -
 *   日志路径所在目录的只读目录项；目录不存在时为 undefined。
 * @returns {{ ok: true, directory: string } | { ok: false, reason: string }}
 *   ok 时 directory 是已解析的会话目录；否则 reason 说明拒绝原因。
 */
export function resolveSessionDirectory(root, logPath, entries) {
  if (typeof root !== 'string' || root === '') {
    return { ok: false, reason: 'root-unknown' }
  }
  if (typeof logPath !== 'string' || logPath === '' || !path.isAbsolute(logPath)) {
    return { ok: false, reason: 'log-path-unknown' }
  }

  const resolvedRoot = path.resolve(root)
  const directory = path.resolve(path.dirname(logPath))
  const relative = path.relative(resolvedRoot, directory)
  if (escapesRoot(relative)) {
    return { ok: false, reason: 'outside-root' }
  }
  // 只接受 <root>/<项目目录>/<会话目录> 两层，任何更浅或更深的目录都不属于单个会话。
  if (relative.split(path.sep).length !== 2) {
    return { ok: false, reason: 'unexpected-layout' }
  }

  const files = Array.isArray(entries) ? entries : []
  if (!files.some((entry) => entry?.isFile?.() === true && isSessionLogFile(entry.name))) {
    return { ok: false, reason: 'no-session-log' }
  }

  return { ok: true, directory }
}

/**
 * 校验会话目录的真实路径仍位于会话根内。
 *
 * 形状校验是纯字符串比较，项目目录若是指向会话根之外的符号链接，字符串仍在
 * 根内而真实目录已经逃逸；删除前用 realpath 再确认一次，避免误删根外数据。
 * @param {string} root - 会话持久化后端的根目录。
 * @param {string} directory - 已通过形状校验的会话目录。
 * @returns {Promise<boolean>} 真实路径是否仍在根目录之下；无法解析时返回 false。
 */
export async function isRealPathInside(root, directory) {
  try {
    const realRoot = await fs.realpath(root)
    const realDirectory = await fs.realpath(directory)
    const relative = path.relative(realRoot, realDirectory)
    return !escapesRoot(relative)
  } catch {
    return false
  }
}
