/**
 * 浏览器半侧：在会话行的「…」菜单里提供「删除会话」，并用确认弹窗保护删除。
 *
 * 菜单项与弹窗分属两个插槽：菜单随菜单关闭一起卸载，所以确认框注册在
 * shell.overlay，由插件自己的请求 store 把它们连起来。数据删除全部走 Host 的
 * POST /api/session-manager/delete；成功后刷新会话列表，让该行立即消失。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useSyncExternalStore } = React
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { Button, IconSlidersTwoOutlineRegular, IconTrashOutlineRegular, IconWarningOutlineRegular, MenuItemButton, Modal, Switch } = primitives

    const NS = 'session-manager'
    const STYLE_ID = 'dsh-session-manager/dialog.css'
    // 文档相对路径：DSH 可用 --public-url 把界面挂在子路径下，绝对 `/api` 会绕过该前缀。
    const API_PATH = 'api/session-manager/delete'

    //#region 文案

    const zh = {
      'menu.deleteSession': '删除会话',
      'dialog.title': '删除会话',
      'dialog.description': '确定要删除「{title}」吗？该会话的历史记录与本地日志将被永久删除，且无法恢复。',
      'dialog.untitled': '未命名会话',
      'dialog.cancel': '取消',
      'dialog.confirm': '删除',
      'dialog.deleting': '正在删除…',
      'dialog.close': '关闭',
      'error.openHere': '该会话正在当前窗口打开，请切换到其他会话后再试。',
      'error.running': '该会话正在运行，请先停止生成后再试。',
      'error.busy': '该会话仍有正在运行的工作，请先结束后再试。',
      'error.notFound': '该会话不存在，可能已被删除。',
      'error.backendUnsupported': '当前会话存储后端不支持删除。',
      'error.failed': '删除失败（HTTP {status}）。',
      'error.failedDetail': '删除失败：{message}',
      'panel.label': '会话管理',
      'panel.title': '会话管理',
      'panel.subtitle': '调整侧边栏会话的显示顺序，并查看删除会话的入口。',
      'panel.order.title': '未归档会话优先',
      'panel.order.hint': '开启后，已归档会话会排在所在分组的末尾。只改变侧边栏里的显示位置，不改变归档状态和会话数据。',
      'panel.delete.title': '删除会话',
      'panel.delete.hint': '在会话行的「…」菜单中选择「删除会话」，确认后会永久删除该会话的本地数据。',
    }

    const en = {
      'menu.deleteSession': 'Delete session',
      'dialog.title': 'Delete session',
      'dialog.description':
        'Delete “{title}”? The conversation history and local log will be permanently removed and cannot be recovered.',
      'dialog.untitled': 'Untitled session',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Delete',
      'dialog.deleting': 'Deleting…',
      'dialog.close': 'Close',
      'error.openHere': 'This session is open in this window. Switch to another session and try again.',
      'error.running': 'This session is running. Stop the current turn before deleting it.',
      'error.busy': 'This session still has running work. Stop it before deleting the session.',
      'error.notFound': 'This session no longer exists; it may already have been deleted.',
      'error.backendUnsupported': 'The configured session store does not support deletion.',
      'error.failed': 'Delete failed (HTTP {status}).',
      'error.failedDetail': 'Delete failed: {message}',
      'panel.label': 'Session manager',
      'panel.title': 'Session manager',
      'panel.subtitle': 'Adjust how sessions are ordered in the sidebar and find the delete action.',
      'panel.order.title': 'Unarchived sessions first',
      'panel.order.hint':
        'When on, archived sessions move to the end of their group. This only changes their position in the sidebar; the archive state and session data stay the same.',
      'panel.delete.title': 'Delete sessions',
      'panel.delete.hint':
        'Choose “Delete session” from a session row’s “…” menu; confirming permanently removes that session’s local data.',
    }

    //#endregion

    //#region 样式

    const CSS = `
.dsm-warning{display:flex;align-items:flex-start;gap:10px;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.dsm-warningIcon{flex:none;margin-top:2px;color:var(--dsw-alias-state-error-primary)}
.dsm-warningText{margin:0;overflow-wrap:anywhere}
.dsm-error{margin:12px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsm-action{min-width:88px}
.dsm-page{height:100%;overflow-y:auto;padding:24px 28px 40px;box-sizing:border-box;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px}
.dsm-page-title{margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.01em}
.dsm-page-subtitle{margin:6px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsm-section{margin-top:24px;max-width:720px}
.dsm-section-title{margin:0;font-size:14px;line-height:20px;font-weight:600}
.dsm-section-hint{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsm-setting{margin-top:12px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.dsm-setting-text{min-width:0}
.dsm-setting-title{margin:0;font-size:13px;line-height:20px;font-weight:500}
.dsm-setting-hint{margin:3px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsm-setting-control{flex:none;padding-top:2px}
/* 归档置底：只改视觉顺序，不动 React 管理的 DOM 与数据顺序，避免和列表动画、拖拽冲突。 */
html[data-dsm-archived-last] [role="tree"] div:has(> :is(span,div) > [data-row-key^="workspace:"]),
html[data-dsm-archived-last] [role="tree"]:has(> :is(span,div) > [data-row-key^="session:"]){display:flex;flex-direction:column}
html[data-dsm-archived-last] [role="tree"] div:has(> :is(span,div) > [data-row-key^="workspace:"]) > :is(span,div),
html[data-dsm-archived-last] [role="tree"]:has(> :is(span,div) > [data-row-key^="session:"]) > :is(span,div){order:0}
html[data-dsm-archived-last] [role="tree"] div:has(> :is(span,div) > [data-row-key^="workspace:"]) > :is(span,div):has(> [data-row-key^="session:"]:is([class*="archived"],[aria-description])),
html[data-dsm-archived-last] [role="tree"]:has(> :is(span,div) > [data-row-key^="session:"]) > :is(span,div):has(> [data-row-key^="session:"]:is([class*="archived"],[aria-description])){order:1}
html[data-dsm-archived-last] [role="tree"] [data-row-key^="overflow:"]{order:2}
`.trim()

    function installStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
      if (existing !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-session-manager'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    //#endregion

    //#region 排序偏好

    const PREF_ARCHIVED_LAST = 'dsh.session-manager.archived-last'
    const ARCHIVED_LAST_ATTR = 'data-dsm-archived-last'

    /** 未设置时默认开启：让归档会话默认沉到分组末尾。 */
    function readArchivedLast() {
      if (typeof window === 'undefined') return true
      try {
        const stored = window.localStorage.getItem(PREF_ARCHIVED_LAST)
        return stored === null ? true : stored === 'true'
      } catch {
        return true
      }
    }

    function applyArchivedLast(enabled) {
      if (typeof document === 'undefined') return
      if (enabled) document.documentElement.setAttribute(ARCHIVED_LAST_ATTR, '')
      else document.documentElement.removeAttribute(ARCHIVED_LAST_ATTR)
    }

    function saveArchivedLast(enabled) {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(PREF_ARCHIVED_LAST, String(enabled))
      } catch {
        // 隐私模式下写入失败只影响下次启动的默认值。
      }
    }

    //#endregion

    //#region 确认请求 store

    /** 菜单项与 overlay 确认框共享的一次待确认请求。 */
    function createRequestStore() {
      let value = null
      const listeners = new Set()
      const emit = () => {
        for (const listener of listeners) listener()
      }
      return {
        get: () => value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        open: (request) => {
          value = request
          emit()
        },
        close: () => {
          if (value === null) return
          value = null
          emit()
        },
      }
    }

    const store = createRequestStore()

    //#endregion

    //#region 菜单项

    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, t }) {
      const [, setMenuOpen] = useMenuOpenState()
      return h(
        MenuItemButton,
        {
          danger: true,
          separatorBefore: true,
          icon: h(IconTrashOutlineRegular, {}),
          onSelect: () => {
            setMenuOpen(false)
            store.open({ sessionId, displayTitle })
          },
        },
        t('menu.deleteSession'),
      )
    }

    //#endregion

    //#region 确认弹窗

    function messageOf(reason) {
      if (reason instanceof Error) return reason.message
      try {
        return String(reason)
      } catch {
        return 'unknown error'
      }
    }

    function describeFailure(t, status, body) {
      const code = body?.error?.code
      if (code === 'session-running') return t('error.running')
      if (code === 'session-busy') return t('error.busy')
      if (code === 'session-not-found') return t('error.notFound')
      if (code === 'backend-unsupported') return t('error.backendUnsupported')
      const detail = body?.error?.message
      if (typeof detail === 'string' && detail !== '') return t('error.failedDetail', { message: detail })
      return t('error.failed', { status })
    }

    function DeleteConfirm({ request, t, refreshSessions, isSessionOpenHere }) {
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const title =
        typeof request.displayTitle === 'string' && request.displayTitle !== ''
          ? request.displayTitle
          : t('dialog.untitled')

      const dismiss = () => {
        if (busy) return
        store.close()
      }

      const confirm = async () => {
        if (busy) return
        if (isSessionOpenHere(request.sessionId)) {
          setError(t('error.openHere'))
          return
        }
        setBusy(true)
        setError(null)
        try {
          const response = await fetch(API_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sessionId: request.sessionId }),
          })
          const body = await response.json().catch(() => null)
          if (!response.ok || body === null || body.ok !== true) {
            setError(describeFailure(t, response.status, body))
            setBusy(false)
            return
          }
          // 先刷新列表再关闭弹窗：删除已提交，刷新期间保持遮罩，避免该行短暂落到未分组。
          try {
            await refreshSessions()
          } catch (reason) {
            console.warn('[session-manager] session list refresh failed:', reason)
          }
          store.close()
        } catch (reason) {
          setError(t('error.failedDetail', { message: messageOf(reason) }))
          setBusy(false)
        }
      }

      return h(
        Modal,
        {
          open: true,
          onClose: dismiss,
          closeLabel: t('dialog.close'),
          title: t('dialog.title'),
          footer: h(
            React.Fragment,
            null,
            h(
              Button,
              { variant: 'outline', className: 'dsm-action', disabled: busy, onClick: dismiss },
              t('dialog.cancel'),
            ),
            h(
              Button,
              { variant: 'primary', className: 'dsm-action', disabled: busy, onClick: confirm },
              busy ? t('dialog.deleting') : t('dialog.confirm'),
            ),
          ),
        },
        h(
          'div',
          { className: 'dsm-warning' },
          h(IconWarningOutlineRegular, { size: 18, className: 'dsm-warningIcon' }),
          h('p', { className: 'dsm-warningText' }, t('dialog.description', { title })),
        ),
        error === null ? null : h('p', { className: 'dsm-error', role: 'alert' }, error),
      )
    }

    function DeleteSessionDialog({ t, refreshSessions, isSessionOpenHere }) {
      const request = useSyncExternalStore(store.subscribe, store.get)
      if (request === null) return null
      return h(DeleteConfirm, { key: request.sessionId, request, t, refreshSessions, isSessionOpenHere })
    }

    //#endregion

    //#region 会话管理面板

    const PANEL_ID = 'session-manager'

    function SessionManagerIcon({ size }) {
      return h(IconSlidersTwoOutlineRegular, { size })
    }

    function ArchivedLastSetting({ t }) {
      const [enabled, setEnabled] = React.useState(readArchivedLast)
      const toggle = (next) => {
        setEnabled(next)
        applyArchivedLast(next)
        saveArchivedLast(next)
      }
      return h(
        'div',
        { className: 'dsm-setting' },
        h(
          'div',
          { className: 'dsm-setting-text' },
          h('p', { className: 'dsm-setting-title' }, t('panel.order.title')),
          h('p', { className: 'dsm-setting-hint' }, t('panel.order.hint')),
        ),
        h('div', { className: 'dsm-setting-control' }, h(Switch, { checked: enabled, label: t('panel.order.title'), onChange: toggle })),
      )
    }

    function SessionManagerPage({ t }) {
      return h(
        'div',
        { className: 'dsm-page' },
        h('h1', { className: 'dsm-page-title' }, t('panel.title')),
        h('p', { className: 'dsm-page-subtitle' }, t('panel.subtitle')),
        h(
          'section',
          { className: 'dsm-section' },
          h('h2', { className: 'dsm-section-title' }, t('panel.order.title')),
          h(ArchivedLastSetting, { t }),
        ),
        h(
          'section',
          { className: 'dsm-section' },
          h('h2', { className: 'dsm-section-title' }, t('panel.delete.title')),
          h('p', { className: 'dsm-section-hint' }, t('panel.delete.hint')),
        ),
      )
    }

    //#endregion

    //#region 插件入口

    const inject = ['slots', 'locale', 'sessions']

    function apply(ctx) {
      ctx.effect(() => {
        const disposeZh = ctx.locale.register(NS, 'zh', zh)
        const disposeEn = ctx.locale.register(NS, 'en', en)
        return () => {
          disposeZh()
          disposeEn()
        }
      }, 'session-manager: dictionaries')
      ctx.effect(() => installStyle(), 'session-manager: styles')
      ctx.effect(() => {
        applyArchivedLast(readArchivedLast())
        return () => {
          if (typeof document !== 'undefined') document.documentElement.removeAttribute(ARCHIVED_LAST_ATTR)
        }
      }, 'session-manager: archived-last preference')

      const t = ctx.locale.bind(NS)

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
          },
          SessionManagerPage,
        ),
      )

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 60,
            locale: NS,
            label: () => t('panel.label'),
          },
          SessionManagerIcon,
        ),
      )

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.menu.item',
            id: 'session-manager-delete',
            order: 500,
            locale: NS,
          },
          DeleteSessionMenuItem,
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'session-manager-delete',
            locale: NS,
            inject: () => ({
              refreshSessions: () => ctx.sessions.refresh(),
              isSessionOpenHere: (sessionId) =>
                (ctx.sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0,
            }),
          },
          DeleteSessionDialog,
        ),
      )
    }

    //#endregion

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
