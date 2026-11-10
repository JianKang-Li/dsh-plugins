/**
 * 纯函数层：把 `git diff` 的补丁文本与未跟踪文件内容解析成面板使用的结构。
 * 不依赖 cordis 与 node 进程，便于 node --test 直接覆盖。
 */

/** hunk 头：`@@ -旧起点,旧行数 +新起点,新行数 @@`，行数省略时为 1。 */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** 单个未跟踪文件超过这个字节数就不再读取内容，只保留条目。 */
export const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024

/** 判定二进制时检查的前缀字节数。 */
const BINARY_PROBE_BYTES = 8000

/**
 * 去掉补丁路径上的 `a/`、`b/` 前缀，`/dev/null` 归一为空串。
 * @param {string} value - 补丁中的路径。
 * @returns {string} 仓库相对路径。
 */
function stripPrefix(value) {
  if (value === '/dev/null') {
    return ''
  }
  return value.replace(/^[ab]\//, '')
}

/**
 * 从 `diff --git a/x b/x` 中猜出路径，仅在缺少 `---`/`+++` 行（纯模式变更）时使用。
 * @param {string} line - `diff --git ` 开头的整行。
 * @returns {string} 仓库相对路径，猜不出时为空串。
 */
function pathFromDiffHeader(line) {
  const rest = line.slice('diff --git '.length)
  const marker = rest.lastIndexOf(' b/')
  if (marker <= 0) {
    return ''
  }
  return stripPrefix(rest.slice(marker + 1))
}

/**
 * 创建一个解析中的条目。
 * @param {string} line - `diff --git` 头。
 * @returns {object} 条目与头部状态。
 */
function createEntry(line) {
  return {
    headerPath: pathFromDiffHeader(line),
    oldPath: '',
    newPath: '',
    renameFrom: '',
    renameTo: '',
    deleted: false,
    created: false,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  }
}

/**
 * 解析一个补丁文本。
 * @param {string} text - `git diff --no-color` 的输出。
 * @returns {Array<object>} 文件条目，顺序与补丁一致。
 */
export function parsePatch(text) {
  const entries = []
  let entry = null
  let hunk = null
  let oldLeft = 0
  let newLeft = 0

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      entry = createEntry(line)
      entries.push(entry)
      hunk = null
      continue
    }

    if (entry === null) {
      continue
    }

    // 「文件末尾无换行」标记紧跟最后一行，行数已经消费完也要收下。
    if (hunk !== null && line.startsWith('\\')) {
      hunk.lines.push(line)
      continue
    }

    // hunk 体内按行数消费，正文出现类似头部的内容也不会误判。
    if (hunk !== null && (oldLeft > 0 || newLeft > 0)) {
      const sign = line[0]
      if (sign === '+') {
        hunk.lines.push(line)
        entry.additions += 1
        newLeft -= 1
        continue
      }
      if (sign === '-') {
        hunk.lines.push(line)
        entry.deletions += 1
        oldLeft -= 1
        continue
      }
      if (sign === ' ') {
        hunk.lines.push(line)
        oldLeft -= 1
        newLeft -= 1
        continue
      }
      if (sign === '\\') {
        hunk.lines.push(line)
        continue
      }
      hunk = null
    }

    if (line.startsWith('new file mode ')) {
      entry.created = true
      continue
    }
    if (line.startsWith('deleted file mode ')) {
      entry.deleted = true
      continue
    }
    if (line.startsWith('rename from ')) {
      entry.renameFrom = line.slice('rename from '.length)
      continue
    }
    if (line.startsWith('rename to ')) {
      entry.renameTo = line.slice('rename to '.length)
      continue
    }
    if (line.startsWith('--- ')) {
      entry.oldPath = stripPrefix(line.slice(4))
      continue
    }
    if (line.startsWith('+++ ')) {
      entry.newPath = stripPrefix(line.slice(4))
      continue
    }
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      entry.binary = true
      hunk = null
      continue
    }

    const header = HUNK_HEADER.exec(line)
    if (header !== null) {
      oldLeft = header[2] === undefined ? 1 : Number(header[2])
      newLeft = header[4] === undefined ? 1 : Number(header[4])
      hunk = {
        oldStart: Number(header[1]),
        oldLines: oldLeft,
        newStart: Number(header[3]),
        newLines: newLeft,
        lines: [],
      }
      entry.hunks.push(hunk)
    }
  }

  return entries.map(finalize)
}

/**
 * 把解析中的条目收敛成对外结构；路径优先取 `+++`/`---`，重命名取 rename 行。
 * @param {object} entry - 解析中的条目。
 * @returns {object} 文件条目。
 */
function finalize(entry) {
  let path = entry.newPath || entry.oldPath || entry.headerPath
  let previousPath = null
  let status = 'modified'

  if (entry.created) {
    status = 'added'
  } else if (entry.deleted) {
    status = 'deleted'
    path = entry.oldPath || path
  } else if (entry.renameFrom !== '' || entry.renameTo !== '') {
    status = 'renamed'
    path = entry.renameTo || entry.newPath || path
    previousPath = entry.renameFrom || entry.oldPath || null
  } else if (entry.oldPath !== '' && entry.newPath !== '' && entry.oldPath !== entry.newPath) {
    status = 'renamed'
    path = entry.newPath
    previousPath = entry.oldPath
  }

  if (previousPath === path) {
    previousPath = null
  }

  return {
    path,
    previousPath,
    status,
    binary: entry.binary,
    untracked: false,
    oversized: false,
    additions: entry.additions,
    deletions: entry.deletions,
    hunks: entry.hunks,
  }
}

/**
 * 判断一段内容是否为二进制。
 * @param {Buffer} buffer - 文件内容。
 * @returns {boolean} 前 8000 字节含 NUL 时视为二进制。
 */
export function isBinary(buffer) {
  const probe = buffer.subarray(0, Math.min(buffer.length, BINARY_PROBE_BYTES))
  return probe.includes(0)
}

/**
 * 把一个未跟踪文件包装成「新增文件」条目。
 * @param {string} path - 仓库相对路径。
 * @param {Buffer} buffer - 文件内容。
 * @returns {object} 文件条目。
 */
export function untrackedEntry(path, buffer) {
  if (isBinary(buffer)) {
    return {
      path,
      previousPath: null,
      status: 'added',
      binary: true,
      untracked: true,
      oversized: false,
      additions: 0,
      deletions: 0,
      hunks: [],
    }
  }

  const text = buffer.toString('utf8')
  const lines = text === '' ? [] : text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }

  return {
    path,
    previousPath: null,
    status: 'added',
    binary: false,
    untracked: true,
    oversized: false,
    additions: lines.length,
    deletions: 0,
    hunks:
      lines.length === 0
        ? []
        : [
            {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: lines.length,
              lines: lines.map((line) => `+${line}`),
            },
          ],
  }
}

/**
 * 汇总文件条目的增删行数。
 * @param {Array<object>} files - 文件条目。
 * @returns {{files: number, additions: number, deletions: number}} 汇总。
 */
export function summarize(files) {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }
  return { files: files.length, additions, deletions }
}
