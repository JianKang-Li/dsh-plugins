/**
 * 浏览器半侧：右侧栏「本地差异」标签页。
 *
 * 数据全部来自 Host 的 GET api/git-diff/diff；这里只负责范围切换、文件折叠
 * 与补丁渲染。基准是本地 HEAD/索引，不依赖远程托管平台。
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-diff',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { Button, IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconRefreshOutlineRegular } = primitives

    const NS = 'git-diff'
    const TAB_ID = 'dsh-git-diff/changes'
    const TAB_KIND = 'git-diff'
    // 文档相对路径：DSH 可用 --public-url 把界面挂在子路径下，绝对 /api 会绕过该前缀。
    const API_PATH = 'api/git-diff/diff'
    const STYLE_ID = 'dsh-git-diff/panel.css'

    /** 自动展开的单文件行数上限。 */
    const FILE_AUTO_OPEN_LINES = 2000

    /** 自动展开的累计行数上限，超出的文件默认收起。 */
    const TOTAL_AUTO_OPEN_LINES = 8000

    //#region 文案

    const zh = {
      'tab.title': '本地差异',
      'guide.title': '本地差异',
      'guide.description': '按会话的工作目录查看已暂存、未暂存与未跟踪的改动',
      'scope.all': '全部',
      'scope.staged': '已暂存',
      'scope.unstaged': '未暂存',
      'scope.untracked': '未跟踪',
      'meta.detached': '分离 HEAD',
      'meta.branch': '分支',
      'action.refresh': '刷新',
      'action.retry': '重试',
      'status.loading': '正在读取差异…',
      'status.empty': '这个范围没有改动',
      'status.emptyHint': '切换上方范围，或在终端里改点东西再刷新',
      'badge.added': '新增',
      'badge.deleted': '删除',
      'badge.renamed': '重命名',
      'badge.binary': '二进制',
      'badge.untracked': '未跟踪',
      'badge.oversized': '过大',
      'notice.omitted': '还有 {count} 个文件未列出',
      'notice.oversized': '{count} 个未跟踪文件超过 1 MB，只列出名称',
      'notice.untracked': '含 {count} 个未跟踪文件',
      'notice.modeOnly': '仅权限或名称变化，没有内容差异',
      'error.not-a-checkout': '当前会话目录不在 Git 检出中',
      'error.no-commits': '仓库还没有提交，无法以 HEAD 为基准；可先查看「已暂存」',
      'error.diff-too-large': '差异超过 4 MB，请先提交部分改动或缩小范围',
      'error.session-not-found': '会话不存在或已关闭',
      'error.network': '读取失败：{message}',
      'error.git-failed': 'git 执行失败：{message}',
      'error.unknown': '读取失败（{code}）：{message}',
    }

    const en = {
      'tab.title': 'Local changes',
      'guide.title': 'Local changes',
      'guide.description': 'Staged, unstaged and untracked changes of this session’s working directory',
      'scope.all': 'All',
      'scope.staged': 'Staged',
      'scope.unstaged': 'Unstaged',
      'scope.untracked': 'Untracked',
      'meta.detached': 'detached HEAD',
      'meta.branch': 'branch',
      'action.refresh': 'Refresh',
      'action.retry': 'Retry',
      'status.loading': 'Reading changes…',
      'status.empty': 'No changes in this scope',
      'status.emptyHint': 'Switch the scope above, or edit something and refresh',
      'badge.added': 'added',
      'badge.deleted': 'deleted',
      'badge.renamed': 'renamed',
      'badge.binary': 'binary',
      'badge.untracked': 'untracked',
      'badge.oversized': 'too large',
      'notice.omitted': '{count} more files are not listed',
      'notice.oversized': '{count} untracked files exceed 1 MB and are listed by name only',
      'notice.untracked': 'includes {count} untracked files',
      'notice.modeOnly': 'mode or name change only, no content diff',
      'error.not-a-checkout': 'The session directory is not inside a Git checkout',
      'error.no-commits': 'The repository has no commit yet, so HEAD cannot be the base; try “Staged”',
      'error.diff-too-large': 'The diff exceeds 4 MB; commit part of the changes or narrow the scope',
      'error.session-not-found': 'The session does not exist or is closed',
      'error.network': 'Request failed: {message}',
      'error.git-failed': 'git failed: {message}',
      'error.unknown': 'Request failed ({code}): {message}',
    }

    //#endregion

    //#region 样式

    const CSS = `
.dgd-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.dgd-bar{display:flex;align-items:center;gap:6px;row-gap:4px;flex-wrap:wrap;min-height:38px;padding:4px 8px;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none}
.dgd-scopes{display:inline-flex;flex-wrap:wrap;gap:2px;flex:none}
.dgd-scope{height:26px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;white-space:nowrap}
.dgd-scope:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dgd-scope[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:500}
.dgd-spacer{flex:1;min-width:0}
.dgd-totals{display:inline-flex;gap:6px;flex:none;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-secondary)}
.dgd-add{color:var(--dsw-alias-state-success-primary)}
.dgd-del{color:var(--dsw-alias-state-error-primary)}
.dgd-meta{display:flex;gap:8px;align-items:center;min-height:26px;padding:0 12px;border-bottom:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);flex:none;font-family:var(--ds-font-family-code);white-space:nowrap;overflow:hidden}
.dgd-meta span{overflow:hidden;text-overflow:ellipsis}
.dgd-notice{padding:6px 12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none}
.dgd-files{flex:1;min-height:0;overflow:auto}
.dgd-file{border-bottom:.5px solid var(--dsw-alias-border-l3)}
.dgd-file-head{display:flex;align-items:center;gap:6px;min-height:32px;padding:0 8px;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-base);border:0;width:100%;text-align:left;cursor:pointer;font:inherit;color:inherit}
.dgd-file-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dgd-chevron{display:inline-flex;color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .12s}
.dgd-file[data-open="false"] .dgd-chevron{transform:rotate(-90deg)}
.dgd-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-family:var(--ds-font-family-code)}
.dgd-dir{color:var(--dsw-alias-label-tertiary)}
.dgd-badge{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dgd-counts{margin-left:auto;flex:none;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-tertiary);display:inline-flex;gap:4px}
.dgd-code{font:var(--dsw-font-markdown-code-block);overflow-x:auto;border-top:.5px solid var(--dsw-alias-border-l3)}
.dgd-line{display:grid;grid-template-columns:3.5em 3.5em 1.2em minmax(0,1fr);min-height:20px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.dgd-line[data-kind="add"]{background:var(--dsw-alias-file-diff-added-bg)}
.dgd-line[data-kind="del"]{background:var(--dsw-alias-file-diff-deleted-bg)}
.dgd-no{text-align:right;padding-right:6px;color:var(--dsw-alias-label-tertiary);user-select:none}
.dgd-sign{text-align:center;user-select:none;color:var(--dsw-alias-label-tertiary)}
.dgd-line[data-kind="add"] .dgd-sign{color:var(--dsw-alias-file-diff-added-marker)}
.dgd-line[data-kind="del"] .dgd-sign{color:var(--dsw-alias-file-diff-deleted-marker)}
.dgd-text{padding-right:12px;min-width:0}
.dgd-hunk,.dgd-note{min-height:20px;line-height:20px;padding:0 8px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);white-space:pre-wrap;overflow-wrap:anywhere}
.dgd-note{background:0 0}
.dgd-empty,.dgd-error{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;flex:1;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}
.dgd-error{color:var(--dsw-alias-state-error-primary)}
.dgd-hint{color:var(--dsw-alias-label-tertiary)}
`

    /**
     * 注入一次样式表，重复调用无副作用。
     * @returns {() => void} 移除样式。
     */
    function installStyle() {
      if (document.getElementById(STYLE_ID) !== null) {
        return () => {}
      }
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.dataset.plugin = 'dsh-git-diff'
      element.textContent = CSS
      document.head.append(element)
      return () => {
        element.remove()
      }
    }

    //#endregion

    //#region 补丁渲染

    /**
     * 把一个文件的行数算出来，用于判断默认展开。
     * @param {object} file - 文件条目。
     * @returns {number} hunk 正文行数。
     */
    function lineCount(file) {
      let total = 0
      for (const hunk of file.hunks) {
        total += hunk.lines.length
      }
      return total
    }

    /**
     * 把 hunk 展开成带行号的渲染行。
     * @param {object} file - 文件条目。
     * @returns {Array<object>} 渲染行。
     */
    function buildRows(file) {
      const rows = []
      for (const hunk of file.hunks) {
        const range =
          hunk.oldLines === 0 && hunk.newLines > 0
            ? `@@ -0,0 +${hunk.newStart},${hunk.newLines} @@`
            : `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
        rows.push({ kind: 'hunk', text: range })
        let oldNo = hunk.oldStart
        let newNo = hunk.newStart
        for (const line of hunk.lines) {
          const sign = line[0]
          const text = line.slice(1)
          if (sign === '+') {
            rows.push({ kind: 'add', old: '', next: newNo, text })
            newNo += 1
            continue
          }
          if (sign === '-') {
            rows.push({ kind: 'del', old: oldNo, next: '', text })
            oldNo += 1
            continue
          }
          if (sign === '\\') {
            rows.push({ kind: 'note', text })
            continue
          }
          rows.push({ kind: 'ctx', old: oldNo, next: newNo, text })
          oldNo += 1
          newNo += 1
        }
      }
      return rows
    }

    /**
     * 拆分路径，目录部分用浅色显示。
     * @param {string} value - 仓库相对路径。
     * @returns {{dir: string, base: string}} 目录与文件名。
     */
    function splitPath(value) {
      const index = value.lastIndexOf('/')
      if (index < 0) {
        return { dir: '', base: value }
      }
      return { dir: value.slice(0, index + 1), base: value.slice(index + 1) }
    }

    /**
     * 文件条目的状态徽标。
     * @param {object} file - 文件条目。
     * @param {Function} t - 文案函数。
     * @returns {Array<object>} 徽标元素。
     */
    function badges(file, t) {
      const list = []
      if (file.status !== 'modified') {
        list.push(h('span', { key: 'status', className: 'dgd-badge' }, t(`badge.${file.status}`)))
      }
      if (file.untracked) {
        list.push(h('span', { key: 'untracked', className: 'dgd-badge' }, t('badge.untracked')))
      }
      if (file.binary) {
        list.push(h('span', { key: 'binary', className: 'dgd-badge' }, t('badge.binary')))
      }
      if (file.oversized) {
        list.push(h('span', { key: 'oversized', className: 'dgd-badge' }, t('badge.oversized')))
      }
      return list
    }

    /**
     * 一个文件的折叠块。
     * @param {object} props - 文件、展开状态与文案。
     * @returns {object} React 元素。
     */
    function FileBlock({ file, open, onToggle, t }) {
      const rows = useMemo(() => buildRows(file), [file])
      const name = splitPath(file.path)
      const previous = file.previousPath === null ? null : splitPath(file.previousPath)

      return h(
        'div',
        { className: 'dgd-file', 'data-open': open ? 'true' : 'false' },
        h(
          'button',
          {
            type: 'button',
            className: 'dgd-file-head',
            'aria-expanded': open,
            onClick: onToggle,
            title: file.previousPath === null ? file.path : `${file.previousPath} → ${file.path}`,
          },
          h('span', { className: 'dgd-chevron' }, h(IconChevronDownOutlineRegular, { size: 16 })),
          previous === null
            ? null
            : h('span', { className: 'dgd-dir' }, `${previous.base} →`),
          h(
            'span',
            { className: 'dgd-path' },
            name.dir === '' ? null : h('span', { className: 'dgd-dir' }, name.dir),
            name.base,
          ),
          ...badges(file, t),
          h(
            'span',
            { className: 'dgd-counts' },
            file.additions > 0 ? h('span', { className: 'dgd-add' }, `+${file.additions}`) : null,
            file.deletions > 0 ? h('span', { className: 'dgd-del' }, `-${file.deletions}`) : null,
          ),
        ),
        open
          ? h(
              'div',
              { className: 'dgd-code' },
              rows.length === 0
                ? h('div', { className: 'dgd-note' }, t('notice.modeOnly'))
                : rows.map((row, index) => {
                    if (row.kind === 'hunk') {
                      return h('div', { key: index, className: 'dgd-hunk' }, row.text)
                    }
                    if (row.kind === 'note') {
                      return h('div', { key: index, className: 'dgd-note' }, row.text)
                    }
                    return h(
                      'div',
                      { key: index, className: 'dgd-line', 'data-kind': row.kind },
                      h('span', { className: 'dgd-no' }, row.old === '' ? '' : String(row.old)),
                      h('span', { className: 'dgd-no' }, row.next === '' ? '' : String(row.next)),
                      h('span', { className: 'dgd-sign' }, row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '),
                      h('span', { className: 'dgd-text' }, row.text === '' ? ' ' : row.text),
                    )
                  }),
            )
          : null,
      )
    }

    //#endregion

    //#region 面板

    /**
     * 右侧栏标签页正文。
     * @param {object} props - 插槽属性。
     * @returns {object} React 元素。
     */
    function ChangesBody(props) {
      const { sessionId, t, useTabInfo } = props
      const { tab } = useTabInfo()
      const visible = tab.visible

      const [scope, setScope] = useState('all')
      const [payload, setPayload] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(false)
      const [reloadToken, setReloadToken] = useState(0)
      const [toggled, setToggled] = useState(() => new Map())

      useEffect(() => {
        setToggled(new Map())
        setPayload(null)
        setError(null)
      }, [sessionId, scope])

      useEffect(() => {
        if (!visible || sessionId === undefined || sessionId === null || sessionId === '') {
          return undefined
        }
        const controller = new AbortController()
        let active = true
        setLoading(true)
        const url = `${API_PATH}?session=${encodeURIComponent(sessionId)}&scope=${encodeURIComponent(scope)}`

        fetch(url, { signal: controller.signal, headers: { accept: 'application/json' }, credentials: 'same-origin' })
          .then(async (response) => {
            const body = await response.json().catch(() => null)
            if (!active) {
              return
            }
            if (body !== null && body.ok === true) {
              setPayload(body.value)
              setError(null)
              return
            }
            setPayload(null)
            setError(body?.error ?? { code: 'http', message: `HTTP ${response.status}` })
          })
          .catch((cause) => {
            if (!active || controller.signal.aborted) {
              return
            }
            setPayload(null)
            setError({ code: 'network', message: String(cause?.message ?? cause) })
          })
          .finally(() => {
            if (active) {
              setLoading(false)
            }
          })

        return () => {
          active = false
          controller.abort()
        }
      }, [sessionId, scope, reloadToken, visible])

      const files = payload === null ? [] : payload.files

      const openByDefault = useMemo(() => {
        const map = new Map()
        let cumulative = 0
        for (const file of files) {
          const lines = lineCount(file)
          map.set(file.path, lines <= FILE_AUTO_OPEN_LINES && cumulative <= TOTAL_AUTO_OPEN_LINES)
          cumulative += lines
        }
        return map
      }, [files])

      const isOpen = useCallback(
        (file) => (toggled.has(file.path) ? toggled.get(file.path) : (openByDefault.get(file.path) ?? true)),
        [toggled, openByDefault],
      )

      const toggle = useCallback(
        (file) => {
          setToggled((previous) => {
            const next = new Map(previous)
            const current = previous.has(file.path) ? previous.get(file.path) : (openByDefault.get(file.path) ?? true)
            next.set(file.path, !current)
            return next
          })
        },
        [openByDefault],
      )

      const refresh = useCallback(() => {
        setReloadToken((value) => value + 1)
      }, [])

      const errorText = useCallback(
        (value) => {
          const code = value.code ?? 'unknown'
          const message = value.message ?? ''
          if (code === 'not-a-checkout' || code === 'no-commits' || code === 'diff-too-large' || code === 'session-not-found') {
            return t(`error.${code}`)
          }
          if (code === 'network') {
            return t('error.network', { message })
          }
          if (code === 'git-failed') {
            return t('error.git-failed', { message })
          }
          return t('error.unknown', { code, message })
        },
        [t],
      )

      const branchLabel =
        payload === null
          ? ''
          : payload.detached || payload.branch === ''
            ? t('meta.detached')
            : payload.branch

      const notices = []
      if (payload !== null && payload.omitted > 0) {
        notices.push(t('notice.omitted', { count: payload.omitted }))
      }
      if (payload !== null && payload.oversized > 0) {
        notices.push(t('notice.oversized', { count: payload.oversized }))
      }
      if (payload !== null && payload.untracked > 0 && payload.scope === 'all') {
        notices.push(t('notice.untracked', { count: payload.untracked }))
      }

      return h(
        'div',
        { className: 'dgd-root', 'data-git-diff-scope': scope },
        h(
          'div',
          { className: 'dgd-bar' },
          h(
            'div',
            { className: 'dgd-scopes', role: 'group' },
            ...['all', 'staged', 'unstaged', 'untracked'].map((value) =>
              h(
                'button',
                {
                  key: value,
                  type: 'button',
                  className: 'dgd-scope',
                  'aria-pressed': scope === value,
                  onClick: () => setScope(value),
                },
                t(`scope.${value}`),
              ),
            ),
          ),
          h('span', { className: 'dgd-spacer' }),
          payload === null
            ? null
            : h(
                'span',
                { className: 'dgd-totals' },
                h('span', null, String(payload.totals.files)),
                h('span', { className: 'dgd-add' }, `+${payload.totals.additions}`),
                h('span', { className: 'dgd-del' }, `-${payload.totals.deletions}`),
              ),
          h(
            Button,
            {
              size: 'sm',
              variant: 'ghost',
              onClick: refresh,
              'aria-label': t('action.refresh'),
              title: t('action.refresh'),
            },
            h(IconRefreshOutlineRegular, { size: 16 }),
          ),
        ),
        payload === null
          ? null
          : h(
              'div',
              { className: 'dgd-meta' },
              h('span', { className: 'dgd-chevron' }, h(IconBranchOutlineRegular, { size: 14 })),
              h('span', { title: payload.branch }, branchLabel),
              payload.head === '' ? null : h('span', { title: payload.head }, payload.head),
              h('span', { title: payload.root }, payload.root),
            ),
        ...notices.map((text, index) => h('div', { key: `notice-${index}`, className: 'dgd-notice' }, text)),
        error !== null
          ? h(
              'div',
              { className: 'dgd-error', role: 'alert' },
              h('span', null, errorText(error)),
              h(
                Button,
                { size: 'sm', variant: 'outline', onClick: refresh },
                t('action.retry'),
              ),
            )
          : payload === null
            ? h(
                'div',
                { className: 'dgd-empty' },
                h('span', null, loading ? t('status.loading') : ''),
              )
            : files.length === 0
              ? h(
                  'div',
                  { className: 'dgd-empty' },
                  h('span', null, t('status.empty')),
                  h('span', { className: 'dgd-hint' }, t('status.emptyHint')),
                )
              : h(
                  'div',
                  { className: 'dgd-files' },
                  ...files.map((file) =>
                    h(FileBlock, {
                      key: `${file.path}:${file.previousPath ?? ''}`,
                      file,
                      open: isOpen(file),
                      onToggle: () => toggle(file),
                      t,
                    }),
                  ),
                ),
      )
    }

    //#endregion

    //#region 插件入口

    const inject = ['slots', 'locale', 'sidebarRightTabs']

    /**
     * 注册文案、样式与右侧栏标签页。
     * @param {object} ctx - 浏览器插件上下文。
     * @returns {void}
     */
    function apply(ctx) {
      ctx.effect(() => {
        const disposeZh = ctx.locale.register(NS, 'zh', zh)
        const disposeEn = ctx.locale.register(NS, 'en', en)
        return () => {
          disposeZh()
          disposeEn()
        }
      }, 'git-diff: dictionaries')
      ctx.effect(() => installStyle(), 'git-diff: styles')

      const t = ctx.locale.bind(NS)

      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            title: () => t('tab.title'),
            guide: [
              {
                id: 'changes',
                order: 12,
                title: () => t('guide.title'),
                description: () => t('guide.description'),
                icon: IconBranchOutlineRegular,
              },
            ],
          }),
        'git-diff: changes type',
      )

      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: NS,
          },
          ChangesBody,
        ),
      )
    }

    //#endregion

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
