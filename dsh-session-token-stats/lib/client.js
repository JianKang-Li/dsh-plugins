/**
 * 浏览器半侧：在侧边栏注册「Token 用量」入口，并在主区域渲染统计面板。
 *
 * 数据全部来自 Host 半侧的 GET /api/session-token-stats；这里不直接读文件。
 * 手写 CJS bundle，只依赖平台 seed 里的 react，避免额外的构建步骤。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-token-stats',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const PANEL_ID = 'session-token-stats'
    const NS = 'session-token-stats'
    const STYLE_ID = 'dsh-session-token-stats/panel.css'
    const API_PATH = '/api/session-token-stats'

    //#region 文案

    const zh = {
      panelLabel: 'Token 用量',
      title: '会话 Token 用量',
      subtitle: '统计本机所有会话的模型调用消耗，可按日期查看每日用量。',
      refresh: '刷新',
      refreshing: '刷新中…',
      presetAll: '全部',
      presetToday: '今天',
      preset7d: '近 7 天',
      preset30d: '近 30 天',
      presetMonth: '本月',
      presetCustom: '自定义',
      from: '开始日期',
      to: '结束日期',
      apply: '应用',
      allTime: '全部时间',
      rangeLabel: '{from} 至 {to}',
      rangeFrom: '{from} 起',
      rangeUntil: '截至 {to}',
      summaryTotal: '总 Token',
      summaryCalls: '调用次数',
      summarySessions: '会话数',
      summaryInput: '输入 Token',
      summaryCacheRead: '缓存读取',
      summaryCacheWrite: '缓存写入',
      summaryOutput: '输出 Token',
      summaryReasoning: '推理 Token',
      reasoningNote: '推理 Token 是输出的一部分，不重复计入合计。',
      updatedAt: '更新于 {time}',
      timezone: '时区：{zone}',
      loadFailed: '加载失败',
      retry: '重试',
      loading: '正在统计会话用量…',
      filterInvalid: '开始日期不能晚于结束日期',
      rangeRequired: '请选择开始和结束日期',
      failedSessions: '{count} 个会话读取失败，已跳过。',
      dailyTitle: '每日 Token 消耗',
      dailyHint: '按模型调用发生的本地日期统计；没有上报用量的请求不计入。全部时间下跨度较大时只展示有消耗的日期。',
      chartLegendInput: '输入',
      chartLegendCacheRead: '缓存读',
      chartLegendCacheWrite: '缓存写',
      chartLegendOutput: '输出',
      date: '日期',
      calls: '调用',
      input: '输入',
      cacheRead: '缓存读',
      cacheWrite: '缓存写',
      cacheHitRate: '缓存命中率',
      cacheHitRateHint: '缓存读 ÷（输入 + 缓存读 + 缓存写）',
      output: '输出',
      total: '合计',
      share: '占比',
      modelTitle: '模型分布',
      modelHint: '所选时间范围内各模型的 Token 消耗。',
      sessionTitle: '会话明细',
      sessionHint: '按所选时间范围内消耗的 Token 排序。',
      searchPlaceholder: '搜索标题、路径或会话 ID',
      sortTotal: '按用量',
      sortRecent: '按最近活动',
      noSessions: '没有匹配的会话',
      noData: '所选时间范围内没有 Token 用量',
      emptyHint: '换一个日期范围，或先进行一次模型调用。',
      noTitle: '未命名会话',
      subagent: '子会话',
      live: '运行中',
      lastActivity: '最后活动',
      model: '模型',
      unknownModel: '未知模型',
      tableTotal: '总计',
      allSessionsNote: '包含主会话与子会话；fork 继承的历史事件已跳过，避免重复计数。',
      moreModels: '另有 {count} 个模型',
      today: '今天',
      sessionColumn: '会话',
      modelColumn: '模型',
      lastActivityColumn: '最后活动',
      sessionIdLabel: '会话 ID',
      cwdLabel: '工作目录',
      createdAtLabel: '创建时间',
      cacheWriteNote: '缓存写入仅部分模型提供商会上报。',
    }

    const en = {
      panelLabel: 'Token usage',
      title: 'Session token usage',
      subtitle: 'Token consumption of every local session, grouped by day.',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      presetAll: 'All',
      presetToday: 'Today',
      preset7d: 'Last 7 days',
      preset30d: 'Last 30 days',
      presetMonth: 'This month',
      presetCustom: 'Custom',
      from: 'Start',
      to: 'End',
      apply: 'Apply',
      allTime: 'All time',
      rangeLabel: '{from} – {to}',
      rangeFrom: 'From {from}',
      rangeUntil: 'Until {to}',
      summaryTotal: 'Total tokens',
      summaryCalls: 'Model calls',
      summarySessions: 'Sessions',
      summaryInput: 'Input tokens',
      summaryCacheRead: 'Cache read',
      summaryCacheWrite: 'Cache write',
      summaryOutput: 'Output tokens',
      summaryReasoning: 'Reasoning tokens',
      reasoningNote: 'Reasoning tokens are part of output and are not counted twice.',
      updatedAt: 'Updated {time}',
      timezone: 'Time zone: {zone}',
      loadFailed: 'Failed to load',
      retry: 'Retry',
      loading: 'Collecting session usage…',
      filterInvalid: 'The start date must not be after the end date',
      rangeRequired: 'Choose both a start and an end date',
      failedSessions: '{count} session(s) could not be read and were skipped.',
      dailyTitle: 'Daily token consumption',
      dailyHint: 'Grouped by the local date of each model call; calls without reported usage are excluded. For long all-time spans, only dates with usage are shown.',
      chartLegendInput: 'Input',
      chartLegendCacheRead: 'Cache read',
      chartLegendCacheWrite: 'Cache write',
      chartLegendOutput: 'Output',
      date: 'Date',
      calls: 'Calls',
      input: 'Input',
      cacheRead: 'Cache read',
      cacheWrite: 'Cache write',
      cacheHitRate: 'Cache hit rate',
      cacheHitRateHint: 'Cache read ÷ (input + cache read + cache write)',
      output: 'Output',
      total: 'Total',
      share: 'Share',
      modelTitle: 'By model',
      modelHint: 'Token consumption per model in the selected range.',
      sessionTitle: 'Sessions',
      sessionHint: 'Sorted by tokens consumed in the selected range.',
      searchPlaceholder: 'Search title, path, or session ID',
      sortTotal: 'By usage',
      sortRecent: 'By recent activity',
      noSessions: 'No matching sessions',
      noData: 'No token usage in the selected range',
      emptyHint: 'Try another date range, or make a model call first.',
      noTitle: 'Untitled session',
      subagent: 'Subagent',
      live: 'Live',
      lastActivity: 'Last activity',
      model: 'Model',
      unknownModel: 'Unknown model',
      tableTotal: 'Total',
      allSessionsNote: 'Includes main and subagent sessions; fork-inherited history is skipped to avoid double counting.',
      moreModels: '{count} more model(s)',
      today: 'Today',
      sessionColumn: 'Session',
      modelColumn: 'Model',
      lastActivityColumn: 'Last activity',
      sessionIdLabel: 'Session ID',
      cwdLabel: 'Working directory',
      createdAtLabel: 'Created',
      cacheWriteNote: 'Cache writes are only reported by some providers.',
    }

    //#endregion

    //#region 样式

    const CSS = [
      '.stk-root{height:100%;overflow-y:auto;padding:24px 28px 40px;box-sizing:border-box;color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-base,#fff);font-size:13px}',
      '.stk-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.stk-title{margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.01em}',
      '.stk-subtitle{margin:6px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.stk-head-actions{display:flex;align-items:center;gap:8px;flex:none}',
      '.stk-btn{border:.5px solid var(--dsw-alias-border-l2,rgba(31,35,40,.16));background:var(--dsw-alias-bg-layer-2,#f6f8fa);color:var(--dsw-alias-label-primary,#1f2328);border-radius:6px;padding:6px 11px;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap}',
      '.stk-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#0969da);color:var(--dsw-alias-brand-primary,#0969da)}',
      '.stk-btn:disabled{opacity:.5;cursor:default}',
      '.stk-btn-primary{background:var(--dsw-alias-brand-primary,#0969da);border-color:var(--dsw-alias-brand-primary,#0969da);color:#fff;font-weight:600}',
      '.stk-btn-primary:hover:not(:disabled){color:#fff;filter:brightness(1.06)}',
      '.stk-filters{margin-top:16px;padding:12px;border:.5px solid var(--dsw-alias-border-l3,rgba(31,35,40,.1));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fbfcfd);display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.stk-presets{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.stk-chip{border:.5px solid var(--dsw-alias-border-l2,rgba(31,35,40,.16));background:transparent;color:var(--dsw-alias-label-secondary,#57606a);border-radius:999px;padding:4px 10px;font-size:12px;line-height:16px;cursor:pointer}',
      '.stk-chip:hover{border-color:var(--dsw-alias-brand-primary,#0969da);color:var(--dsw-alias-brand-primary,#0969da)}',
      '.stk-chip-on{background:var(--dsw-alias-brand-primary,#0969da);border-color:var(--dsw-alias-brand-primary,#0969da);color:#fff}',
      '.stk-chip-on:hover{color:#fff}',
      '.stk-dates{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap}',
      '.stk-date{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.stk-date input{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);border:.5px solid var(--dsw-alias-border-l2,rgba(31,35,40,.16));border-radius:6px;padding:5px 7px;font-size:12px;line-height:16px;min-width:132px;color-scheme:light dark}',
      '.stk-date input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0969da);outline-offset:1px}',
      '.stk-meta{margin-top:10px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.stk-banner{margin-top:12px;border-radius:8px;padding:8px 10px;font-size:12px;line-height:18px;display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.stk-banner-error{border:.5px solid var(--dsw-alias-state-error-primary,#cf222e);background:rgba(207,34,46,.06);color:var(--dsw-alias-state-error-primary,#cf222e)}',
      '.stk-banner-warn{border:.5px solid var(--dsw-alias-state-warning-primary,#9a6700);background:rgba(154,103,0,.07);color:var(--dsw-alias-state-warning-primary,#9a6700)}',
      '.stk-cards{margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}',
      '.stk-card{border:.5px solid var(--dsw-alias-border-l3,rgba(31,35,40,.1));background:var(--dsw-alias-bg-layer-1,#fbfcfd);border-radius:10px;padding:11px 12px;min-width:0}',
      '.stk-card-accent{border-color:var(--dsw-alias-brand-primary,#0969da);background:rgba(9,105,218,.05)}',
      '.stk-card-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#6e7781);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.stk-card-value{margin-top:6px;font-size:22px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.stk-card-note{margin-top:4px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.stk-section{margin-top:24px}',
      '.stk-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}',
      '.stk-section-title{margin:0;font-size:14px;line-height:20px;font-weight:600}',
      '.stk-section-hint{margin:3px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.stk-section-extra{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.stk-legend{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.stk-legend-item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}',
      '.stk-legend-dot{width:8px;height:8px;border-radius:2px;display:inline-block}',
      '.stk-dot-input{background:#4f7cff}',
      '.stk-dot-cacheRead{background:#2fbf8f}',
      '.stk-dot-cacheWrite{background:#f0a33a}',
      '.stk-dot-output{background:#a06bff}',
      '.stk-chart-wrap{margin-top:10px;overflow-x:auto;border:.5px solid var(--dsw-alias-border-l3,rgba(31,35,40,.1));border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fbfcfd);padding:14px 12px 14px}',
      '.stk-chart{display:flex;align-items:stretch;gap:4px;height:180px}',
      '.stk-bar-col{flex:1 1 0;min-width:14px;display:flex;flex-direction:column;align-items:center;gap:6px;justify-content:flex-end;min-width:0}',
      '.stk-bar-track{width:100%;flex:1;display:flex;align-items:flex-end;justify-content:center}',
      '.stk-bar{width:100%;max-width:26px;border-radius:3px 3px 1px 1px;overflow:hidden;display:flex;flex-direction:column-reverse;background:transparent;min-height:0}',
      '.stk-bar-empty{min-height:2px;background:var(--dsw-alias-border-l3,rgba(31,35,40,.1));border-radius:2px}',
      '.stk-seg{display:block;width:100%;min-height:0}',
      '.stk-seg-input{background:#4f7cff}',
      '.stk-seg-cacheRead{background:#2fbf8f}',
      '.stk-seg-cacheWrite{background:#f0a33a}',
      '.stk-seg-output{background:#a06bff}',
      '.stk-bar-label{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#6e7781);white-space:nowrap;height:14px}',
      '.stk-bar-label-rotated{transform:rotate(-45deg);transform-origin:top center;height:22px}',
      '.stk-table-wrap{margin-top:10px;max-height:430px;overflow:auto;border:.5px solid var(--dsw-alias-border-l3,rgba(31,35,40,.1));border-radius:10px;scrollbar-gutter:stable}',
      '.stk-table{width:100%;border-collapse:collapse;font-size:12px;line-height:18px;white-space:nowrap}',
      '.stk-table th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-2,#f6f8fa);color:var(--dsw-alias-label-tertiary,#6e7781);font-weight:500;text-align:left;padding:7px 10px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(31,35,40,.16))}',
      '.stk-table td{padding:7px 10px;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(31,35,40,.12));vertical-align:middle}',
      '.stk-table tbody tr:last-child td{border-bottom:0}',
      '.stk-table tbody tr:hover td{background:var(--dsw-alias-bg-layer-2,#f6f8fa)}',
      '.stk-table .stk-num{text-align:right;font-variant-numeric:tabular-nums}',
      '.stk-total-row td{font-weight:600;background:var(--dsw-alias-bg-layer-1,#fbfcfd)}',
      '.stk-share-cell{min-width:110px}',
      '.stk-share-bar{height:6px;border-radius:999px;background:var(--dsw-alias-border-l3,rgba(31,35,40,.1));overflow:hidden;min-width:60px}',
      '.stk-share-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#0969da)}',
      '.stk-share-text{margin-top:3px;font-size:10px;line-height:12px;color:var(--dsw-alias-label-tertiary,#6e7781);font-variant-numeric:tabular-nums}',
      '.stk-session-cell{max-width:380px}',
      '.stk-session-title{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px}',
      '.stk-session-sub{margin-top:2px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#6e7781);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:360px}',
      '.stk-model-cell{max-width:260px;overflow:hidden;text-overflow:ellipsis}',
      '.stk-badge{display:inline-flex;align-items:center;border-radius:999px;padding:0 6px;font-size:10px;line-height:16px;font-weight:500;background:var(--dsw-alias-bg-layer-2,#f6f8fa);color:var(--dsw-alias-label-secondary,#57606a);margin-left:6px;vertical-align:1px}',
      '.stk-badge-live{background:rgba(47,191,143,.14);color:#1a7f5a}',
      '.stk-badge-sub{background:rgba(160,107,255,.14);color:#7a4bd6}',
      '.stk-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.stk-search{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);border:.5px solid var(--dsw-alias-border-l2,rgba(31,35,40,.16));border-radius:6px;padding:5px 8px;font-size:12px;line-height:16px;min-width:220px}',
      '.stk-search:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0969da);outline-offset:1px}',
      '.stk-select{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);border:.5px solid var(--dsw-alias-border-l2,rgba(31,35,40,.16));border-radius:6px;padding:5px 7px;font-size:12px;line-height:16px}',
      '.stk-state{margin-top:24px;padding:38px 20px;border:.5px dashed var(--dsw-alias-border-l2,rgba(31,35,40,.16));border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:var(--dsw-alias-label-secondary,#57606a)}',
      '.stk-state-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328)}',
      '.stk-state-detail{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#6e7781);max-width:620px;word-break:break-word}',
      '.stk-empty-cell{padding:28px 12px;text-align:center;color:var(--dsw-alias-label-tertiary,#6e7781)}',
      '.stk-spinner{flex:none;width:18px;height:18px;color:var(--dsw-alias-brand-primary,#0969da)}',
      '.stk-spinner-track,.stk-spinner-arc{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}',
      '.stk-spinner-track{opacity:.22}',
      '.stk-spinner-motion{transform-box:fill-box;transform-origin:center;animation:stk-spin 1.5s linear infinite}',
      '.stk-spinner-arc{stroke-dasharray:12 150;animation:stk-dash 1.5s ease-in-out infinite}',
      '@keyframes stk-spin{to{transform:rotate(360deg)}}',
      '@keyframes stk-dash{0%{stroke-dasharray:12 150;stroke-dashoffset:0}50%{stroke-dasharray:24 150;stroke-dashoffset:-6}to{stroke-dasharray:12 150;stroke-dashoffset:0}}',
      '@media (prefers-reduced-motion:reduce){.stk-spinner-motion,.stk-spinner-arc{animation:none}.stk-spinner-arc{stroke-dasharray:18 150;stroke-dashoffset:-3}}',
      '@media (max-width:720px){.stk-root{padding:16px 14px 28px}.stk-filters{align-items:stretch}.stk-dates{width:100%}.stk-date{flex:1}.stk-date input{width:100%;min-width:0;box-sizing:border-box}.stk-search{min-width:0;width:100%}}',
    ].join('\n')

    function installStyle() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
      if (existing !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-session-token-stats'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    //#endregion

    //#region 格式化

    const numberFormats = new Map()
    const dateFormats = new Map()

    function safeCount(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return 0
      return Math.floor(number)
    }

    function localeOf() {
      try {
        return document.documentElement.lang || navigator.language || 'zh-CN'
      } catch {
        return 'zh-CN'
      }
    }

    function formatNumber(value, locale) {
      let formatter = numberFormats.get(locale)
      if (formatter === undefined) {
        formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
        numberFormats.set(locale, formatter)
      }
      return formatter.format(safeCount(value))
    }

    function formatCompact(value, locale) {
      const key = `compact:${locale}`
      let formatter = numberFormats.get(key)
      if (formatter === undefined) {
        formatter = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
        numberFormats.set(key, formatter)
      }
      return formatter.format(safeCount(value))
    }

    function promptTokens(usage) {
      return (
        safeCount(usage.inputTokens) +
        safeCount(usage.cacheReadTokens) +
        safeCount(usage.cacheWriteTokens)
      )
    }

    function formatPercent(value, total, locale) {
      const denominator = safeCount(total)
      if (denominator === 0) return '—'
      const key = `percent:${locale}`
      let formatter = numberFormats.get(key)
      if (formatter === undefined) {
        formatter = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
        numberFormats.set(key, formatter)
      }
      return formatter.format(safeCount(value) / denominator)
    }

    function dateFormat(kind, locale) {
      const key = `${kind}:${locale}`
      let formatter = dateFormats.get(key)
      if (formatter !== undefined) return formatter
      const options = {
        dayShort: { month: '2-digit', day: '2-digit' },
        date: { year: 'numeric', month: '2-digit', day: '2-digit' },
        dateTime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' },
        time: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
        weekday: { weekday: 'short' },
      }[kind]
      formatter = new Intl.DateTimeFormat(locale, options)
      dateFormats.set(key, formatter)
      return formatter
    }

    function dayKeyOf(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    function parseDay(day) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''))
      if (match === null) return null
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      if (Number.isNaN(date.getTime())) return null
      if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
        return null
      }
      return date
    }

    function addDays(date, amount) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
    }

    function formatDayShort(day, locale) {
      const date = parseDay(day)
      return date === null ? day : dateFormat('dayShort', locale).format(date)
    }

    function formatDate(day, locale) {
      const date = parseDay(day)
      return date === null ? day : dateFormat('date', locale).format(date)
    }

    function formatDateTime(ms, locale) {
      const number = Number(ms)
      return Number.isFinite(number) && number > 0 ? dateFormat('dateTime', locale).format(new Date(number)) : '—'
    }

    function formatTime(ms, locale) {
      const number = Number(ms)
      return Number.isFinite(number) && number > 0 ? dateFormat('time', locale).format(new Date(number)) : '—'
    }

    function formatWeekday(day, locale) {
      const date = parseDay(day)
      return date === null ? '' : dateFormat('weekday', locale).format(date)
    }

    function text(t, key, params) {
      return typeof t === 'function' ? t(key, params) : key
    }

    function rangeText(range, t) {
      if (range.from !== null && range.from !== undefined && range.to !== null && range.to !== undefined) {
        return text(t, 'rangeLabel', { from: range.from, to: range.to })
      }
      if (range.from !== null && range.from !== undefined) return text(t, 'rangeFrom', { from: range.from })
      if (range.to !== null && range.to !== undefined) return text(t, 'rangeUntil', { to: range.to })
      return text(t, 'allTime')
    }

    function modelLabel(model, t) {
      if (model === null || typeof model !== 'object') return text(t, 'unknownModel')
      const provider = typeof model.provider === 'string' ? model.provider.trim() : ''
      const name = typeof model.model === 'string' ? model.model.trim() : ''
      if (provider !== '' && name !== '') {
        if (name === provider || name.startsWith(`${provider}/`)) return name
        return `${provider} / ${name}`
      }
      if (name !== '') return name
      if (provider !== '') return provider
      return text(t, 'unknownModel')
    }

    function shortSessionId(id) {
      const value = String(id ?? '')
      return value.startsWith('session-') ? value.slice(8, 16) : value.slice(0, 8)
    }

    //#endregion

    //#region 数据整理

    function emptyDay(day) {
      return {
        day,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      }
    }

    function buildDaySeries(data) {
      const days = Array.isArray(data?.byDay) ? data.byDay : []
      const map = new Map()
      for (const day of days) {
        if (day !== null && typeof day === 'object' && typeof day.day === 'string') map.set(day.day, day)
      }
      let start = null
      let end = null
      if (typeof data?.range?.from === 'string' && typeof data?.range?.to === 'string') {
        start = parseDay(data.range.from)
        end = parseDay(data.range.to)
      } else if (days.length > 0) {
        start = parseDay(days[0].day)
        end = parseDay(days[days.length - 1].day)
      }
      if (start === null || end === null || start.getTime() > end.getTime()) return days
      const span =
        Math.round(
          (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
            Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
            86_400_000,
        ) + 1
      if (span <= 0 || span > 366) return days
      // 全部时间跨度较长时只展示有消耗的日期，避免图表挤满零值。
      if (!(typeof data?.range?.from === 'string' && typeof data?.range?.to === 'string') && span > 60) return days
      const result = []
      let cursor = start
      for (let index = 0; index < span; index += 1) {
        const key = dayKeyOf(cursor)
        result.push(map.get(key) ?? emptyDay(key))
        cursor = addDays(cursor, 1)
      }
      return result
    }

    function presetRange(kind) {
      const today = new Date()
      const todayKey = dayKeyOf(today)
      if (kind === 'today') return { kind, from: todayKey, to: todayKey }
      if (kind === '7d') return { kind, from: dayKeyOf(addDays(today, -6)), to: todayKey }
      if (kind === '30d') return { kind, from: dayKeyOf(addDays(today, -29)), to: todayKey }
      if (kind === 'month') return { kind, from: dayKeyOf(new Date(today.getFullYear(), today.getMonth(), 1)), to: todayKey }
      return { kind: 'all', from: null, to: null }
    }

    //#endregion

    //#region 组件

    function Spinner() {
      return h(
        'svg',
        {
          className: 'stk-spinner',
          viewBox: '0 0 24 24',
          width: 18,
          height: 18,
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('circle', { className: 'stk-spinner-track', cx: 12, cy: 12, r: 10 }),
        h('g', { className: 'stk-spinner-motion' }, h('circle', { className: 'stk-spinner-arc', cx: 12, cy: 12, r: 10 })),
      )
    }

    function SummaryCard({ label, value, compact, accent, note, locale }) {
      return h(
        'div',
        { className: `stk-card${accent ? ' stk-card-accent' : ''}` },
        h('div', { className: 'stk-card-label' }, label),
        h(
          'div',
          { className: 'stk-card-value', title: formatNumber(value, locale) },
          compact ? formatCompact(value, locale) : formatNumber(value, locale),
        ),
        note ? h('div', { className: 'stk-card-note' }, note) : null,
      )
    }

    function Legend({ t }) {
      const items = [
        ['stk-dot-input', 'chartLegendInput'],
        ['stk-dot-cacheRead', 'chartLegendCacheRead'],
        ['stk-dot-cacheWrite', 'chartLegendCacheWrite'],
        ['stk-dot-output', 'chartLegendOutput'],
      ]
      return h(
        'div',
        { className: 'stk-legend' },
        items.map(([className, key]) =>
          h(
            'span',
            { className: 'stk-legend-item', key },
            h('i', { className: `stk-legend-dot ${className}` }),
            text(t, key),
          ),
        ),
      )
    }

    function DailyChart({ days, t, locale }) {
      if (days.length === 0) return h('div', { className: 'stk-state' }, h('div', { className: 'stk-state-title' }, text(t, 'noData')))
      const max = Math.max(1, ...days.map((day) => safeCount(day.totalTokens)))
      const minWidth = Math.max(days.length * 18, 520)
      return h(
        'div',
        { className: 'stk-chart-wrap' },
        h(
          'div',
          { className: 'stk-chart', style: { minWidth: `${minWidth}px` } },
          days.map((day) => {
            const total = safeCount(day.totalTokens)
            const percent = (total / max) * 100
            const tooltip = [
              `${day.day} (${formatWeekday(day.day, locale)})`,
              `${text(t, 'summaryTotal')}: ${formatNumber(total, locale)}`,
              `${text(t, 'calls')}: ${formatNumber(day.calls, locale)}`,
              `${text(t, 'input')}: ${formatNumber(day.inputTokens, locale)}`,
              `${text(t, 'cacheRead')}: ${formatNumber(day.cacheReadTokens, locale)}`,
              `${text(t, 'cacheWrite')}: ${formatNumber(day.cacheWriteTokens, locale)}`,
              `${text(t, 'output')}: ${formatNumber(day.outputTokens, locale)}`,
              `${text(t, 'summaryReasoning')}: ${formatNumber(day.reasoningTokens, locale)}`,
            ].join('\n')
            const segments = [
              ['stk-seg-input', day.inputTokens],
              ['stk-seg-cacheRead', day.cacheReadTokens],
              ['stk-seg-cacheWrite', day.cacheWriteTokens],
              ['stk-seg-output', day.outputTokens],
            ]
            return h(
              'div',
              { className: 'stk-bar-col', key: day.day, title: tooltip },
              h(
                'div',
                { className: 'stk-bar-track' },
                total === 0
                  ? h('div', { className: 'stk-bar stk-bar-empty' })
                  : h(
                      'div',
                      { className: 'stk-bar', style: { height: `${percent}%` } },
                      segments.map(([className, value]) =>
                        h('span', {
                          className: `stk-seg ${className}`,
                          key: className,
                          style: { height: total === 0 ? '0%' : `${(safeCount(value) / total) * 100}%` },
                        }),
                      ),
                    ),
              ),
              h('div', { className: `stk-bar-label${days.length > 45 ? ' stk-bar-label-rotated' : ''}` }, formatDayShort(day.day, locale)),
            )
          }),
        ),
      )
    }

    function ShareCell({ value, total, locale }) {
      const percent = total > 0 ? (safeCount(value) / total) * 100 : 0
      return h(
        'td',
        { className: 'stk-share-cell' },
        h('div', { className: 'stk-share-bar' }, h('div', { className: 'stk-share-fill', style: { width: `${Math.min(100, Math.max(0, percent))}%` } })),
        h('div', { className: 'stk-share-text' }, `${percent.toFixed(1)}%`),
      )
    }

    function DailyTable({ days, totals, t, locale }) {
      const total = safeCount(totals.totalTokens)
      return h(
        'div',
        { className: 'stk-table-wrap' },
        h(
          'table',
          { className: 'stk-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, text(t, 'date')),
              h('th', { className: 'stk-num' }, text(t, 'calls')),
              h('th', { className: 'stk-num' }, text(t, 'input')),
              h('th', { className: 'stk-num' }, text(t, 'cacheRead')),
              h('th', { className: 'stk-num' }, text(t, 'cacheWrite')),
              h('th', { className: 'stk-num', title: text(t, 'cacheHitRateHint') }, text(t, 'cacheHitRate')),
              h('th', { className: 'stk-num' }, text(t, 'output')),
              h('th', { className: 'stk-num' }, text(t, 'total')),
              h('th', null, text(t, 'share')),
            ),
          ),
          h(
            'tbody',
            null,
            days.map((day) =>
              h(
                'tr',
                { key: day.day },
                h(
                  'td',
                  null,
                  formatDate(day.day, locale),
                  day.day === dayKeyOf(new Date()) ? h('span', { className: 'stk-badge' }, text(t, 'today')) : null,
                ),
                h('td', { className: 'stk-num' }, formatNumber(day.calls, locale)),
                h('td', { className: 'stk-num' }, formatNumber(day.inputTokens, locale)),
                h('td', { className: 'stk-num' }, formatNumber(day.cacheReadTokens, locale)),
                h('td', { className: 'stk-num' }, formatNumber(day.cacheWriteTokens, locale)),
                h(
                  'td',
                  { className: 'stk-num', title: text(t, 'cacheHitRateHint') },
                  formatPercent(day.cacheReadTokens, promptTokens(day), locale),
                ),
                h('td', { className: 'stk-num' }, formatNumber(day.outputTokens, locale)),
                h('td', { className: 'stk-num' }, formatNumber(day.totalTokens, locale)),
                h(ShareCell, { value: day.totalTokens, total, locale }),
              ),
            ),
            h(
              'tr',
              { className: 'stk-total-row' },
              h('td', null, text(t, 'tableTotal')),
              h('td', { className: 'stk-num' }, formatNumber(totals.calls, locale)),
              h('td', { className: 'stk-num' }, formatNumber(totals.inputTokens, locale)),
              h('td', { className: 'stk-num' }, formatNumber(totals.cacheReadTokens, locale)),
              h('td', { className: 'stk-num' }, formatNumber(totals.cacheWriteTokens, locale)),
              h(
                'td',
                { className: 'stk-num', title: text(t, 'cacheHitRateHint') },
                formatPercent(totals.cacheReadTokens, promptTokens(totals), locale),
              ),
              h('td', { className: 'stk-num' }, formatNumber(totals.outputTokens, locale)),
              h('td', { className: 'stk-num' }, formatNumber(totals.totalTokens, locale)),
              h('td', null, total > 0 ? '100%' : '0%'),
            ),
          ),
        ),
      )
    }

    function ModelTable({ models, totals, t, locale }) {
      const total = safeCount(totals.totalTokens)
      return h(
        'div',
        { className: 'stk-table-wrap' },
        h(
          'table',
          { className: 'stk-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, text(t, 'modelColumn')),
              h('th', { className: 'stk-num' }, text(t, 'calls')),
              h('th', { className: 'stk-num' }, text(t, 'input')),
              h('th', { className: 'stk-num' }, text(t, 'cacheRead')),
              h('th', { className: 'stk-num' }, text(t, 'cacheWrite')),
              h('th', { className: 'stk-num', title: text(t, 'cacheHitRateHint') }, text(t, 'cacheHitRate')),
              h('th', { className: 'stk-num' }, text(t, 'output')),
              h('th', { className: 'stk-num' }, text(t, 'total')),
              h('th', null, text(t, 'share')),
            ),
          ),
          h(
            'tbody',
            null,
            models.map((model) =>
              h(
                'tr',
                { key: `${model.provider}\u0000${model.model}` },
                h('td', { className: 'stk-model-cell', title: modelLabel(model, t) }, modelLabel(model, t)),
                h('td', { className: 'stk-num' }, formatNumber(model.calls, locale)),
                h('td', { className: 'stk-num' }, formatNumber(model.inputTokens, locale)),
                h('td', { className: 'stk-num' }, formatNumber(model.cacheReadTokens, locale)),
                h('td', { className: 'stk-num' }, formatNumber(model.cacheWriteTokens, locale)),
                h(
                  'td',
                  { className: 'stk-num', title: text(t, 'cacheHitRateHint') },
                  formatPercent(model.cacheReadTokens, promptTokens(model), locale),
                ),
                h('td', { className: 'stk-num' }, formatNumber(model.outputTokens, locale)),
                h('td', { className: 'stk-num' }, formatNumber(model.totalTokens, locale)),
                h(ShareCell, { value: model.totalTokens, total, locale }),
              ),
            ),
          ),
        ),
      )
    }

    function SessionTable({ sessions, t, locale }) {
      const [query, setQuery] = useState('')
      const [sort, setSort] = useState('total')

      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        const list = needle === ''
          ? sessions.slice()
          : sessions.filter((session) => {
              const haystack = `${session.title ?? ''} ${session.cwd ?? ''} ${session.id ?? ''}`.toLowerCase()
              return haystack.includes(needle)
            })
        list.sort(sort === 'recent'
          ? (left, right) => safeCount(right.lastAt) - safeCount(left.lastAt)
          : (left, right) => safeCount(right.totalTokens) - safeCount(left.totalTokens))
        return list
      }, [sessions, query, sort])

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'stk-toolbar' },
          h('input', {
            className: 'stk-search',
            type: 'search',
            value: query,
            placeholder: text(t, 'searchPlaceholder'),
            'aria-label': text(t, 'searchPlaceholder'),
            onChange: (event) => setQuery(event.target.value),
          }),
          h(
            'select',
            {
              className: 'stk-select',
              value: sort,
              'aria-label': text(t, 'sortTotal'),
              onChange: (event) => setSort(event.target.value),
            },
            h('option', { value: 'total' }, text(t, 'sortTotal')),
            h('option', { value: 'recent' }, text(t, 'sortRecent')),
          ),
        ),
        h(
          'div',
          { className: 'stk-table-wrap' },
          h(
            'table',
            { className: 'stk-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, text(t, 'sessionColumn')),
                h('th', null, text(t, 'modelColumn')),
                h('th', { className: 'stk-num' }, text(t, 'calls')),
                h('th', { className: 'stk-num' }, text(t, 'input')),
                h('th', { className: 'stk-num' }, text(t, 'cacheRead')),
                h('th', { className: 'stk-num' }, text(t, 'cacheWrite')),
                h('th', { className: 'stk-num', title: text(t, 'cacheHitRateHint') }, text(t, 'cacheHitRate')),
                h('th', { className: 'stk-num' }, text(t, 'output')),
                h('th', { className: 'stk-num' }, text(t, 'total')),
                h('th', null, text(t, 'lastActivityColumn')),
              ),
            ),
            h(
              'tbody',
              null,
              filtered.length === 0
                ? h(
                    'tr',
                    null,
                    h('td', { colSpan: 10, className: 'stk-empty-cell' }, text(t, 'noSessions')),
                  )
                : filtered.map((session) => {
                    const models = Array.isArray(session.models) ? session.models : []
                    const firstModel = models[0]
                    const extra = models.length > 1 ? text(t, 'moreModels', { count: models.length - 1 }) : ''
                    const title = session.title || text(t, 'noTitle')
                    const subtitle = [
                      shortSessionId(session.id),
                      session.cwd || '',
                    ].filter(Boolean).join(' · ')
                    return h(
                      'tr',
                      { key: session.id },
                      h(
                        'td',
                        { className: 'stk-session-cell' },
                        h(
                          'div',
                          { className: 'stk-session-title', title: `${title}\n${session.cwd ?? ''}` },
                          title,
                          session.live ? h('span', { className: 'stk-badge stk-badge-live' }, text(t, 'live')) : null,
                          session.origin === 'subagent' ? h('span', { className: 'stk-badge stk-badge-sub' }, text(t, 'subagent')) : null,
                        ),
                        h('div', { className: 'stk-session-sub', title: subtitle }, subtitle),
                      ),
                      h(
                        'td',
                        { className: 'stk-model-cell', title: models.map((model) => modelLabel(model, t)).join('\n') },
                        firstModel === undefined ? text(t, 'unknownModel') : modelLabel(firstModel, t),
                        extra === '' ? null : h('div', { className: 'stk-session-sub' }, extra),
                      ),
                      h('td', { className: 'stk-num' }, formatNumber(session.calls, locale)),
                      h('td', { className: 'stk-num' }, formatNumber(session.inputTokens, locale)),
                      h('td', { className: 'stk-num' }, formatNumber(session.cacheReadTokens, locale)),
                      h('td', { className: 'stk-num' }, formatNumber(session.cacheWriteTokens, locale)),
                      h(
                        'td',
                        { className: 'stk-num', title: text(t, 'cacheHitRateHint') },
                        formatPercent(session.cacheReadTokens, promptTokens(session), locale),
                      ),
                      h('td', { className: 'stk-num' }, formatNumber(session.outputTokens, locale)),
                      h('td', { className: 'stk-num' }, formatNumber(session.totalTokens, locale)),
                      h('td', { title: formatDateTime(session.lastAt, locale) }, formatDateTime(session.lastAt, locale)),
                    )
                  }),
            ),
          ),
        ),
      )
    }

    //#endregion

    //#region 主面板

    function TokenStatsPage({ t }) {
      const locale = localeOf()
      const [range, setRange] = useState({ kind: 'all', from: null, to: null })
      const [draftFrom, setDraftFrom] = useState('')
      const [draftTo, setDraftTo] = useState('')
      const [filterError, setFilterError] = useState(null)
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(true)
      const [error, setError] = useState(null)
      const [reloadToken, setReloadToken] = useState(0)

      useEffect(() => {
        const controller = new AbortController()
        setBusy(true)
        setError(null)
        const params = new URLSearchParams()
        if (range.from !== null) params.set('from', range.from)
        if (range.to !== null) params.set('to', range.to)
        const query = params.toString()
        fetch(`${API_PATH}${query === '' ? '' : `?${query}`}`, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
          .then(async (response) => {
            const body = await response.json().catch(() => null)
            if (!response.ok || body === null || body.ok === false) {
              const message = body?.error?.message || `HTTP ${response.status}`
              throw new Error(message)
            }
            return body
          })
          .then((body) => {
            setData(body)
            setBusy(false)
          })
          .catch((reason) => {
            if (reason?.name === 'AbortError') return
            setError(String(reason?.message ?? reason))
            setBusy(false)
          })
        return () => controller.abort()
      }, [range, reloadToken])

      const days = useMemo(() => buildDaySeries(data), [data])
      const totals = data?.totals ?? {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        sessions: 0,
      }
      const sessions = Array.isArray(data?.sessions) ? data.sessions : []
      const models = Array.isArray(data?.byModel) ? data.byModel : []

      const selectPreset = useCallback((kind) => {
        const next = presetRange(kind)
        setRange(next)
        setDraftFrom(next.from ?? '')
        setDraftTo(next.to ?? '')
        setFilterError(null)
      }, [])

      const applyCustom = useCallback(() => {
        const from = draftFrom.trim()
        const to = draftTo.trim()
        if (from === '' || to === '') {
          setFilterError(text(t, 'rangeRequired'))
          return
        }
        if (from > to) {
          setFilterError(text(t, 'filterInvalid'))
          return
        }
        setFilterError(null)
        setRange({ kind: 'custom', from, to })
      }, [draftFrom, draftTo, t])

      const refresh = useCallback(() => setReloadToken((value) => value + 1), [])
      const shownRange = data?.range ?? range
      const warning = safeCount(data?.scanned?.failed)

      return h(
        'div',
        { className: 'stk-root' },
        h(
          'div',
          { className: 'stk-head' },
          h(
            'div',
            null,
            h('h1', { className: 'stk-title' }, text(t, 'title')),
            h('p', { className: 'stk-subtitle' }, text(t, 'subtitle')),
          ),
          h(
            'div',
            { className: 'stk-head-actions' },
            h(
              'button',
              { className: 'stk-btn', type: 'button', onClick: refresh, disabled: busy },
              busy ? text(t, 'refreshing') : text(t, 'refresh'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'stk-filters' },
          h(
            'div',
            { className: 'stk-presets' },
            ['all', 'today', '7d', '30d', 'month'].map((kind) =>
              h(
                'button',
                {
                  className: `stk-chip${range.kind === kind ? ' stk-chip-on' : ''}`,
                  key: kind,
                  type: 'button',
                  onClick: () => selectPreset(kind),
                },
                text(t, kind === 'all' ? 'presetAll' : kind === 'today' ? 'presetToday' : kind === '7d' ? 'preset7d' : kind === '30d' ? 'preset30d' : 'presetMonth'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'stk-dates' },
            h(
              'label',
              { className: 'stk-date' },
              h('span', null, text(t, 'from')),
              h('input', {
                type: 'date',
                value: draftFrom,
                onChange: (event) => setDraftFrom(event.target.value),
              }),
            ),
            h(
              'label',
              { className: 'stk-date' },
              h('span', null, text(t, 'to')),
              h('input', {
                type: 'date',
                value: draftTo,
                onChange: (event) => setDraftTo(event.target.value),
              }),
            ),
            h(
              'button',
              { className: 'stk-btn stk-btn-primary', type: 'button', onClick: applyCustom },
              text(t, 'apply'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'stk-meta' },
          h('span', null, rangeText(shownRange, t)),
          data === null ? null : h('span', null, text(t, 'updatedAt', { time: formatTime(data.generatedAt, locale) })),
          data === null ? null : h('span', null, text(t, 'timezone', { zone: data.timeZone })),
        ),
        filterError === null ? null : h('div', { className: 'stk-banner stk-banner-error' }, filterError),
        error === null || data === null ? null : h(
          'div',
          { className: 'stk-banner stk-banner-error' },
          h('span', null, `${text(t, 'loadFailed')}: ${error}`),
          h('button', { className: 'stk-btn', type: 'button', onClick: refresh }, text(t, 'retry')),
        ),
        warning > 0 ? h('div', { className: 'stk-banner stk-banner-warn' }, text(t, 'failedSessions', { count: warning })) : null,
        data === null && busy
          ? h('div', { className: 'stk-state' }, h(Spinner), text(t, 'loading'))
          : null,
        data === null && !busy && error !== null
          ? h(
              'div',
              { className: 'stk-state' },
              h('div', { className: 'stk-state-title' }, text(t, 'loadFailed')),
              h('div', { className: 'stk-state-detail' }, error),
              h('button', { className: 'stk-btn', type: 'button', onClick: refresh }, text(t, 'retry')),
            )
          : null,
        data === null
          ? null
          : h(
              'div',
              null,
              h(
                'div',
                { className: 'stk-cards' },
                h(SummaryCard, {
                  label: text(t, 'summaryTotal'),
                  value: totals.totalTokens,
                  compact: true,
                  accent: true,
                  locale,
                }),
                h(SummaryCard, { label: text(t, 'summaryCalls'), value: totals.calls, locale }),
                h(SummaryCard, { label: text(t, 'summarySessions'), value: totals.sessions, locale }),
                h(SummaryCard, { label: text(t, 'summaryInput'), value: totals.inputTokens, compact: true, locale }),
                h(SummaryCard, { label: text(t, 'summaryCacheRead'), value: totals.cacheReadTokens, compact: true, locale }),
                h(SummaryCard, { label: text(t, 'summaryCacheWrite'), value: totals.cacheWriteTokens, compact: true, locale }),
                h(SummaryCard, { label: text(t, 'summaryOutput'), value: totals.outputTokens, compact: true, locale }),
                h(SummaryCard, {
                  label: text(t, 'summaryReasoning'),
                  value: totals.reasoningTokens,
                  compact: true,
                  note: text(t, 'reasoningNote'),
                  locale,
                }),
              ),
              safeCount(totals.calls) === 0
                ? h(
                    'div',
                    { className: 'stk-state' },
                    h('div', { className: 'stk-state-title' }, text(t, 'noData')),
                    h('div', { className: 'stk-state-detail' }, text(t, 'emptyHint')),
                  )
                : h(
                    'div',
                    null,
                    h(
                      'section',
                      { className: 'stk-section' },
                      h(
                        'div',
                        { className: 'stk-section-head' },
                        h(
                          'div',
                          null,
                          h('h2', { className: 'stk-section-title' }, text(t, 'dailyTitle')),
                          h('p', { className: 'stk-section-hint' }, text(t, 'dailyHint')),
                        ),
                        h('div', { className: 'stk-section-extra' }, h(Legend, { t })),
                      ),
                      h(DailyChart, { days, t, locale }),
                      h(DailyTable, { days, totals, t, locale }),
                    ),
                    models.length === 0
                      ? null
                      : h(
                          'section',
                          { className: 'stk-section' },
                          h(
                            'div',
                            { className: 'stk-section-head' },
                            h(
                              'div',
                              null,
                              h('h2', { className: 'stk-section-title' }, text(t, 'modelTitle')),
                              h('p', { className: 'stk-section-hint' }, text(t, 'modelHint')),
                            ),
                          ),
                          h(ModelTable, { models, totals, t, locale }),
                        ),
                    h(
                      'section',
                      { className: 'stk-section' },
                      h(
                        'div',
                        { className: 'stk-section-head' },
                        h(
                          'div',
                          null,
                          h('h2', { className: 'stk-section-title' }, text(t, 'sessionTitle')),
                          h('p', { className: 'stk-section-hint' }, text(t, 'sessionHint')),
                        ),
                      ),
                      h(SessionTable, { sessions, t, locale }),
                      h('p', { className: 'stk-section-hint', style: { marginTop: '8px' } }, text(t, 'allSessionsNote')),
                    ),
                  ),
            ),
      )
    }

    //#endregion

    //#region 侧边栏图标

    function TokenStatsIcon({ size }) {
      const edge = Number.isFinite(Number(size)) ? Number(size) : 16
      return h(
        'svg',
        {
          width: edge,
          height: edge,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', { d: 'M4 20V10' }),
        h('path', { d: 'M10 20V4' }),
        h('path', { d: 'M16 20v-7' }),
        h('path', { d: 'M22 20H2' }),
      )
    }

    //#endregion

    //#region 插件入口

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => {
        const disposeZh = ctx.locale.register(NS, 'zh', zh)
        const disposeEn = ctx.locale.register(NS, 'en', en)
        return () => {
          disposeZh()
          disposeEn()
        }
      }, 'session-token-stats: dictionaries')
      ctx.effect(() => installStyle(), 'session-token-stats: styles')

      const t = ctx.locale.bind(NS)

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
          },
          TokenStatsPage,
        ),
      )

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 40,
            locale: NS,
            label: () => t('panelLabel'),
          },
          TokenStatsIcon,
        ),
      )
    }

    //#endregion

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
