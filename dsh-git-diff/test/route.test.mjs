import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply } from '../lib/index.js'

/**
 * 建一个带三种改动的临时仓库：已暂存、未暂存、未跟踪。
 * @returns {string} 仓库绝对路径。
 */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-diff-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '.')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'one\ntwo\n')
  git('add', '-A')
  git('commit', '-qm', 'init')

  fs.writeFileSync(path.join(root, 'staged.txt'), 'staged\n')
  git('add', 'staged.txt')
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'one\nTWO\n')
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'fresh\n')
  return root
}

/**
 * 装一个只提供所需服务的假上下文。
 * @param {string} cwd - 会话工作目录。
 * @returns {{routes: Array<object>, ctx: object}} 路由表与上下文。
 */
function mount(cwd) {
  const routes = []
  const ctx = {
    effect: (fn) => fn(),
    connection: { fetch: { register: (route) => { routes.push(route); return async () => {} } } },
    sessions: { get: (id) => (id === 's1' ? { id: 's1' } : undefined) },
    workingDirectory: { get: () => cwd },
  }
  apply(ctx)
  return { routes, ctx }
}

test('各范围返回预期的文件与状态', async (t) => {
  const repo = makeRepo()
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const { routes } = mount(repo)
  assert.equal(routes.length, 1)
  assert.deepEqual(routes[0].methods, ['GET'])

  const call = async (query) => {
    const response = await routes[0].fetch(new Request(`http://host/api/git-diff/diff?${query}`))
    return { status: response.status, body: await response.json() }
  }

  const staged = await call('session=s1&scope=staged')
  assert.equal(staged.status, 200)
  assert.equal(staged.body.ok, true)
  assert.deepEqual(
    staged.body.value.files.map((file) => [file.path, file.status, file.additions]),
    [['staged.txt', 'added', 1]],
  )
  assert.equal(staged.body.value.totals.files, 1)

  const unstaged = await call('session=s1&scope=unstaged')
  assert.deepEqual(
    unstaged.body.value.files.map((file) => [file.path, file.status]),
    [['tracked.txt', 'modified']],
  )

  const untracked = await call('session=s1&scope=untracked')
  assert.deepEqual(
    untracked.body.value.files.map((file) => [file.path, file.untracked]),
    [['untracked.txt', true]],
  )

  const all = await call('session=s1&scope=all')
  assert.deepEqual(
    all.body.value.files.map((file) => file.path).sort(),
    ['staged.txt', 'tracked.txt', 'untracked.txt'],
  )
  assert.equal(all.body.value.untracked, 1)
  assert.equal(all.body.value.detached, false)
  assert.equal(all.body.value.root, fs.realpathSync(repo))
})

test('参数与会话错误返回稳定错误码', async (t) => {
  const repo = makeRepo()
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const { routes } = mount(repo)

  const call = async (query) => {
    const response = await routes[0].fetch(new Request(`http://host/api/git-diff/diff?${query}`))
    return { status: response.status, body: await response.json() }
  }

  const missing = await call('scope=all')
  assert.equal(missing.status, 400)
  assert.equal(missing.body.error.code, 'missing-session')

  const scope = await call('session=s1&scope=bogus')
  assert.equal(scope.status, 400)
  assert.equal(scope.body.error.code, 'invalid-scope')

  const unknown = await call('session=other&scope=all')
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.error.code, 'session-not-found')
})

test('非 Git 目录返回 not-a-checkout', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-diff-plain-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { routes } = mount(dir)

  const response = await routes[0].fetch(new Request('http://host/api/git-diff/diff?session=s1&scope=all'))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'not-a-checkout')
})
