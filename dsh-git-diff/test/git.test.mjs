import assert from 'node:assert/strict'
import test from 'node:test'
import { isBinary, parsePatch, summarize, untrackedEntry } from '../lib/git.js'

test('解析修改文件的 hunk 与行数', () => {
  const patch = [
    'diff --git a/src/a.js b/src/a.js',
    'index de98044..7be73ce 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1,3 +1,3 @@',
    ' a',
    '-b',
    '+B',
    ' c',
    '',
  ].join('\n')

  const files = parsePatch(patch)
  assert.equal(files.length, 1)
  assert.equal(files[0].path, 'src/a.js')
  assert.equal(files[0].status, 'modified')
  assert.equal(files[0].additions, 1)
  assert.equal(files[0].deletions, 1)
  assert.equal(files[0].hunks.length, 1)
  assert.deepEqual(files[0].hunks[0].lines, [' a', '-b', '+B', ' c'])
  assert.equal(files[0].hunks[0].oldStart, 1)
  assert.equal(files[0].hunks[0].newLines, 3)
})

test('新增与删除文件走 /dev/null', () => {
  const patch = [
    'diff --git a/added.txt b/added.txt',
    'new file mode 100644',
    'index 0000000..3e75765',
    '--- /dev/null',
    '+++ b/added.txt',
    '@@ -0,0 +1 @@',
    '+new',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    'index 286c5f5..0000000',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-old',
    '',
  ].join('\n')

  const files = parsePatch(patch)
  assert.equal(files.length, 2)
  assert.deepEqual(
    files.map((file) => [file.path, file.status, file.additions, file.deletions]),
    [
      ['added.txt', 'added', 1, 0],
      ['gone.txt', 'deleted', 0, 1],
    ],
  )
})

test('重命名取 rename 行并保留原路径', () => {
  const patch = [
    'diff --git a/old/name.js b/new/name.js',
    'similarity index 100%',
    'rename from old/name.js',
    'rename to new/name.js',
    '',
  ].join('\n')

  const [file] = parsePatch(patch)
  assert.equal(file.status, 'renamed')
  assert.equal(file.path, 'new/name.js')
  assert.equal(file.previousPath, 'old/name.js')
  assert.equal(file.hunks.length, 0)
})

test('仅权限变化时从 diff 头取路径', () => {
  const patch = ['diff --git a/bin/run.sh b/bin/run.sh', 'old mode 100644', 'new mode 100755', ''].join('\n')

  const [file] = parsePatch(patch)
  assert.equal(file.path, 'bin/run.sh')
  assert.equal(file.status, 'modified')
  assert.equal(file.additions, 0)
  assert.equal(file.deletions, 0)
})

test('二进制文件不产生 hunk', () => {
  const patch = [
    'diff --git a/blob.bin b/blob.bin',
    'new file mode 100644',
    'index 0000000..7989678',
    'Binary files /dev/null and b/blob.bin differ',
    '',
  ].join('\n')

  const [file] = parsePatch(patch)
  assert.equal(file.binary, true)
  assert.equal(file.hunks.length, 0)
})

test('多 hunk 与缺失换行标记', () => {
  const patch = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1,2 +1,2 @@',
    ' one',
    '-two',
    '+TWO',
    '@@ -10,2 +10,3 @@',
    ' ten',
    '+inserted',
    ' eleven',
    '\\ No newline at end of file',
    '',
  ].join('\n')

  const [file] = parsePatch(patch)
  assert.equal(file.hunks.length, 2)
  assert.equal(file.additions, 2)
  assert.equal(file.deletions, 1)
  assert.equal(file.hunks[1].oldStart, 10)
  assert.deepEqual(file.hunks[1].lines, [' ten', '+inserted', ' eleven', '\\ No newline at end of file'])
})

test('未跟踪文件包装成新增条目', () => {
  const file = untrackedEntry('docs/new.md', Buffer.from('# 标题\n\n正文\n'))
  assert.equal(file.status, 'added')
  assert.equal(file.untracked, true)
  assert.equal(file.additions, 3)
  assert.equal(file.deletions, 0)
  assert.deepEqual(file.hunks[0].lines, ['+# 标题', '+', '+正文'])
})

test('空的未跟踪文件没有 hunk', () => {
  const file = untrackedEntry('empty.txt', Buffer.from(''))
  assert.equal(file.additions, 0)
  assert.equal(file.hunks.length, 0)
})

test('未跟踪二进制文件只保留条目', () => {
  const file = untrackedEntry('blob.bin', Buffer.from([0x62, 0x00, 0x01]))
  assert.equal(file.binary, true)
  assert.equal(file.hunks.length, 0)
  assert.equal(isBinary(Buffer.from('plain text')), false)
})

test('汇总增删行数', () => {
  const totals = summarize([
    { additions: 3, deletions: 1 },
    { additions: 0, deletions: 2 },
  ])
  assert.deepEqual(totals, { files: 2, additions: 3, deletions: 3 })
})
