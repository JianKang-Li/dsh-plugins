import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { isRealPathInside, resolveSessionDirectory } from '../lib/delete-target.js'

// 路径全部用 node:path 构造，POSIX 与 Windows（分隔符、盘符）下都能运行。
const root = path.resolve('/srv/sessions')
const sessionDir = (...segments) => path.join(root, '--home-user--', ...segments)

const file = (name) => ({ name, isFile: () => true })
const directoryEntry = (name) => ({ name, isFile: () => false })

test('接受会话根下的会话目录与任意 generation 日志', () => {
  for (const name of ['session.jsonl', 'session.v4.jsonl', 'session.v4.jsonl.zstd', 'session.v12.jsonl.zstd']) {
    const directory = sessionDir('session-1')
    const result = resolveSessionDirectory(root, path.join(directory, name), [directoryEntry('tmp'), file(name)])
    assert.equal(result.ok, true)
    assert.equal(result.directory, directory)
  }
})

test('拒绝会话根与项目目录本身', () => {
  assert.deepEqual(resolveSessionDirectory(root, path.join(root, 'session.v4.jsonl'), [file('session.v4.jsonl')]), {
    ok: false,
    reason: 'outside-root',
  })
  assert.deepEqual(
    resolveSessionDirectory(root, path.join(root, '--home-user--', 'session.v4.jsonl'), [file('session.v4.jsonl')]),
    { ok: false, reason: 'unexpected-layout' },
  )
})

test('拒绝更深层目录与带 .. 的逃逸路径', () => {
  const nested = path.join(root, '--home-user--', 'session-1', 'extra', 'session.v4.jsonl')
  assert.deepEqual(resolveSessionDirectory(root, nested, [file('session.v4.jsonl')]), {
    ok: false,
    reason: 'unexpected-layout',
  })
  // 手工拼接而不是 path.join：join 会把 `..` 规范化掉，失去被解析的机会。
  const escaped = [root, '--home-user--', '..', '..', 'etc', 'session.v4.jsonl'].join(path.sep)
  assert.deepEqual(resolveSessionDirectory(root, escaped, [file('session.v4.jsonl')]), {
    ok: false,
    reason: 'outside-root',
  })
})

test('目录里没有会话日志时拒绝删除', () => {
  const logPath = path.join(sessionDir('session-1'), 'session.v4.jsonl')
  assert.deepEqual(resolveSessionDirectory(root, logPath, []), { ok: false, reason: 'no-session-log' })
  assert.deepEqual(resolveSessionDirectory(root, logPath, [file('notes.json')]), {
    ok: false,
    reason: 'no-session-log',
  })
  assert.deepEqual(resolveSessionDirectory(root, logPath, [directoryEntry('session.v4.jsonl')]), {
    ok: false,
    reason: 'no-session-log',
  })
  assert.deepEqual(resolveSessionDirectory(root, logPath, undefined), { ok: false, reason: 'no-session-log' })
})

test('拒绝缺失或非绝对路径', () => {
  const absolute = path.join(root, 'a', 'b', 'session.v4.jsonl')
  assert.deepEqual(resolveSessionDirectory('', absolute, []), { ok: false, reason: 'root-unknown' })
  assert.deepEqual(resolveSessionDirectory(root, '', []), { ok: false, reason: 'log-path-unknown' })
  assert.deepEqual(resolveSessionDirectory(root, path.join('a', 'b', 'session.v4.jsonl'), []), {
    ok: false,
    reason: 'log-path-unknown',
  })
})

test('真实路径必须仍在会话根内', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-delete-target-'))
  try {
    const sessions = path.join(base, 'root')
    const session = path.join(sessions, '--home-user--', 'session-1')
    await fs.mkdir(session, { recursive: true })
    assert.equal(await isRealPathInside(sessions, session), true)

    const outside = path.join(base, 'outside', 'session-2')
    await fs.mkdir(outside, { recursive: true })
    try {
      // junction 让 Windows 无需开发者模式也能建目录链接；POSIX 忽略 type。
      await fs.symlink(path.join(base, 'outside'), path.join(sessions, 'escape'), 'junction')
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(error?.code)) {
        t.skip(`symlink unsupported: ${error.code}`)
        return
      }
      throw error
    }
    // 字符串形状仍在根内，但真实路径已被符号链接带到根外。
    assert.equal(await isRealPathInside(sessions, path.join(sessions, 'escape', 'session-2')), false)

    assert.equal(await isRealPathInside(sessions, path.join(sessions, 'missing')), false)
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
})
