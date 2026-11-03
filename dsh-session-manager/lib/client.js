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
    const { Button, IconTrashOutlineRegular, IconWarningOutlineRegular, MenuItemButton, Modal } = primitives

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
    }

    //#endregion

    //#region 样式

    const CSS = `
.dsm-warning{display:flex;align-items:flex-start;gap:10px;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
.dsm-warningIcon{flex:none;margin-top:2px;color:var(--dsw-alias-state-error-primary)}
.dsm-warningText{margin:0;overflow-wrap:anywhere}
.dsm-error{margin:12px 0 0;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dsm-action{min-width:88px}
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
