/**
 * 纯聚合逻辑：把一个会话日志折叠成按天、按模型的 Token 用量。
 *
 * 这里不依赖 Cordis 或文件系统，便于单测。事件结构以 DSH 会话日志为准：
 * - assistant/message 携带 usage（各字段互不重叠）
 * - message.source 或最近的 request/header 决定 provider/model
 * - session/title 提供标题，user/message 提供无标题时的回退文案
 */

/** 缓存结构版本；字段含义变化时递增，旧缓存会被忽略。 */
export const CACHE_VERSION = 1

/** usage 中参与合计的字段；reasoningTokens 是输出的一部分，不重复计入。 */
const USAGE_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
]

/** 非负整数计数；畸形值按 0 处理。 */
export function count(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.floor(number)
}

/** 一次模型调用的总 Token：输入 + 输出 + 缓存读 + 缓存写。 */
export function usageTotal(usage) {
  if (usage === null || typeof usage !== 'object') return 0
  const computed =
    count(usage.inputTokens) +
    count(usage.outputTokens) +
    count(usage.cacheReadTokens) +
    count(usage.cacheWriteTokens)
  if (computed > 0) return computed
  return count(usage.totalTokens)
}

/** 模型键：用 JSON 数组避免 provider/model 内的分隔符冲突。 */
export function modelKey(provider, model) {
  return JSON.stringify([provider || '', model || ''])
}

function modelPair(provider, model) {
  return {
    provider: typeof provider === 'string' ? provider : '',
    model: typeof model === 'string' ? model : '',
  }
}

/** 空聚合桶。 */
export function emptyBucket() {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    models: {},
  }
}

function emptyModel(provider, model) {
  return {
    provider,
    model,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
}

function addUsageToModel(target, usage, total) {
  target.calls += 1
  target.inputTokens += count(usage.inputTokens)
  target.outputTokens += count(usage.outputTokens)
  target.cacheReadTokens += count(usage.cacheReadTokens)
  target.cacheWriteTokens += count(usage.cacheWriteTokens)
  target.reasoningTokens += count(usage.reasoningTokens)
  target.totalTokens += total
}

function addUsageToBucket(bucket, usage, provider, model) {
  const total = usageTotal(usage)
  bucket.calls += 1
  bucket.inputTokens += count(usage.inputTokens)
  bucket.outputTokens += count(usage.outputTokens)
  bucket.cacheReadTokens += count(usage.cacheReadTokens)
  bucket.cacheWriteTokens += count(usage.cacheWriteTokens)
  bucket.reasoningTokens += count(usage.reasoningTokens)
  bucket.totalTokens += total

  if (bucket.models === null || typeof bucket.models !== 'object') bucket.models = {}
  const key = modelKey(provider, model)
  const entry = bucket.models[key] ?? emptyModel(
    typeof provider === 'string' ? provider : '',
    typeof model === 'string' ? model : '',
  )
  addUsageToModel(entry, usage, total)
  bucket.models[key] = entry
}

function addModelNumbers(target, source) {
  target.calls += count(source.calls)
  target.inputTokens += count(source.inputTokens)
  target.outputTokens += count(source.outputTokens)
  target.cacheReadTokens += count(source.cacheReadTokens)
  target.cacheWriteTokens += count(source.cacheWriteTokens)
  target.reasoningTokens += count(source.reasoningTokens)
  target.totalTokens += count(source.totalTokens)
}

/** 把 source 桶合并进 target 桶（含模型明细）。 */
export function mergeBucket(target, source) {
  if (source === null || typeof source !== 'object') return target
  addModelNumbers(target, source)
  if (source.models === null || typeof source.models !== 'object') return target
  if (target.models === null || typeof target.models !== 'object') target.models = {}
  for (const [key, model] of Object.entries(source.models)) {
    if (model === null || typeof model !== 'object') continue
    const entry = target.models[key] ?? emptyModel(String(model.provider ?? ''), String(model.model ?? ''))
    addModelNumbers(entry, model)
    target.models[key] = entry
  }
  return target
}

function mergeNumbers(target, source) {
  for (const field of ['calls', ...USAGE_FIELDS, 'totalTokens']) {
    target[field] += count(source[field])
  }
}

function messageText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function routeOf(source) {
  if (source === null || typeof source !== 'object' || source.kind !== 'model') return null
  return {
    provider: typeof source.provider === 'string' ? source.provider : '',
    model: typeof source.model === 'string' ? source.model : '',
  }
}

/** 本地时区的 YYYY-MM-DD。 */
export function localDayKey(ms) {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 解析 YYYY-MM-DD 为本地零点；非法日期返回 null。 */
export function parseDayKey(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return { year, month, day, ms: date.getTime() }
}

/** 本地日期键对应的零点毫秒；非法键返回 null。 */
export function dayKeyToMs(day) {
  const parsed = parseDayKey(day)
  return parsed === null ? null : parsed.ms
}

function nextDayMs(parsed) {
  return new Date(parsed.year, parsed.month - 1, parsed.day + 1).getTime()
}

/**
 * 校验并归一化查询范围。
 * `toMs` 是排他上界（结束日期的次日零点），便于直接比较日期桶。
 */
export function normalizeRange(fromValue, toValue) {
  const from = typeof fromValue === 'string' && fromValue !== '' ? parseDayKey(fromValue) : null
  const to = typeof toValue === 'string' && toValue !== '' ? parseDayKey(toValue) : null
  if (fromValue !== null && fromValue !== undefined && fromValue !== '' && from === null) {
    return { ok: false, code: 'invalid-from', message: `invalid start date ${JSON.stringify(fromValue)}` }
  }
  if (toValue !== null && toValue !== undefined && toValue !== '' && to === null) {
    return { ok: false, code: 'invalid-to', message: `invalid end date ${JSON.stringify(toValue)}` }
  }
  if (from !== null && to !== null && from.ms > to.ms) {
    return { ok: false, code: 'from-after-to', message: 'start date must not be after end date' }
  }
  return {
    ok: true,
    from: from === null ? null : fromValue,
    to: to === null ? null : toValue,
    fromMs: from === null ? null : from.ms,
    toMs: to === null ? null : nextDayMs(to),
  }
}

/**
 * 折叠一个会话日志。
 * @param header - SessionHeader（读取 createdAt/cwd/lineage 等元数据）
 * @param events - 完整原始事件日志
 * @param inheritedEventCount - fork 继承的事件前缀长度；这些事件属于父会话，必须跳过
 */
export function aggregateSession(header, events, inheritedEventCount = 0) {
  const id = String(header?.id ?? '')
  const createdAt = count(header?.createdAt)
  const inherited = count(inheritedEventCount)
  const byDay = {}
  let title = null
  let firstUserText = ''
  let firstAt = null
  let lastAt = null
  let latestRoute = null

  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const seq = Number(event.seq)
    if (inherited > 0 && Number.isFinite(seq) && seq < inherited) continue

    const time = Number(event.time)
    const at = Number.isFinite(time) && time > 0 ? time : null
    if (at !== null) {
      if (firstAt === null || at < firstAt) firstAt = at
      if (lastAt === null || at > lastAt) lastAt = at
    }

    switch (event.type) {
      case 'request/header': {
        const config = event.data?.header?.config
        if (config !== null && typeof config === 'object') {
          latestRoute = {
            provider: typeof config.provider === 'string' ? config.provider : '',
            model: typeof config.model === 'string' ? config.model : '',
          }
        }
        break
      }
      case 'session/title': {
        const next = event.data?.title
        if (typeof next === 'string' && next.trim() !== '') title = next.trim()
        break
      }
      case 'user/message': {
        if (firstUserText === '') firstUserText = messageText(event.data?.content).slice(0, 160)
        break
      }
      case 'assistant/message': {
        const usage = event.data?.usage
        if (usage === null || typeof usage !== 'object') break
        const route = routeOf(event.data?.message?.source) ?? latestRoute
        const provider = route?.provider ?? ''
        const model = route?.model ?? ''
        const day = localDayKey(at ?? createdAt)
        if (day === null) break
        const bucket = byDay[day] ?? emptyBucket()
        addUsageToBucket(bucket, usage, provider, model)
        byDay[day] = bucket
        break
      }
      default:
        break
    }
  }

  return {
    id,
    createdAt,
    cwd: typeof header?.cwd === 'string' ? header.cwd : null,
    parentSession: typeof header?.parentSession === 'string' ? header.parentSession : null,
    origin: typeof header?.origin === 'string' ? header.origin : null,
    agentPreset: typeof header?.agentPreset === 'string' ? header.agentPreset : null,
    delegationDepth: count(header?.delegationDepth),
    isSeeded: header?.isSeeded === true,
    title: title ?? (firstUserText !== '' ? firstUserText : null),
    titleSource: title !== null ? 'title' : firstUserText !== '' ? 'prompt' : null,
    firstAt: firstAt ?? createdAt,
    lastAt: lastAt ?? createdAt,
    live: false,
    signature: null,
    byDay,
  }
}

function bucketNumbers(bucket) {
  const numbers = {
    calls: count(bucket.calls),
    inputTokens: count(bucket.inputTokens),
    outputTokens: count(bucket.outputTokens),
    cacheReadTokens: count(bucket.cacheReadTokens),
    cacheWriteTokens: count(bucket.cacheWriteTokens),
    reasoningTokens: count(bucket.reasoningTokens),
    totalTokens: count(bucket.totalTokens),
  }
  return numbers
}

function modelList(bucket) {
  if (bucket.models === null || typeof bucket.models !== 'object') return []
  return Object.values(bucket.models)
    .filter((model) => model !== null && typeof model === 'object')
    .map((model) => ({
      provider: String(model.provider ?? ''),
      model: String(model.model ?? ''),
      ...bucketNumbers(model),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
}

/**
 * 按查询范围汇总所有会话。
 * @param entries - aggregateSession 的结果列表
 * @param range - normalizeRange 的结果（fromMs/toMs 可为 null）
 */
export function aggregateSessions(entries, range = { fromMs: null, toMs: null }) {
  const totals = emptyBucket()
  const byDay = {}
  const byModel = {}
  const sessions = []
  let earliest = null
  let latest = null

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || entry.byDay === null || typeof entry.byDay !== 'object') {
      continue
    }
    const sessionBucket = emptyBucket()
    for (const [day, bucket] of Object.entries(entry.byDay)) {
      if (bucket === null || typeof bucket !== 'object') continue
      const dayMs = dayKeyToMs(day)
      if (dayMs === null) continue
      if (range.fromMs !== null && range.fromMs !== undefined && dayMs < range.fromMs) continue
      if (range.toMs !== null && range.toMs !== undefined && dayMs >= range.toMs) continue

      mergeBucket(sessionBucket, bucket)
      const dayBucket = byDay[day] ?? emptyBucket()
      mergeBucket(dayBucket, bucket)
      byDay[day] = dayBucket

      if (bucket.models !== null && typeof bucket.models === 'object') {
        for (const [key, model] of Object.entries(bucket.models)) {
          if (model === null || typeof model !== 'object') continue
          const target = byModel[key] ?? emptyModel(String(model.provider ?? ''), String(model.model ?? ''))
          addModelNumbers(target, model)
          byModel[key] = target
        }
      }

      if (earliest === null || day < earliest) earliest = day
      if (latest === null || day > latest) latest = day
    }

    if (sessionBucket.calls === 0) continue
    const { models, ...numbers } = sessionBucket
    const session = {
      id: entry.id,
      title: entry.title ?? null,
      titleSource: entry.titleSource ?? null,
      cwd: entry.cwd ?? null,
      createdAt: count(entry.createdAt),
      parentSession: entry.parentSession ?? null,
      origin: entry.origin ?? null,
      agentPreset: entry.agentPreset ?? null,
      delegationDepth: count(entry.delegationDepth),
      isSeeded: entry.isSeeded === true,
      live: entry.live === true,
      firstAt: count(entry.firstAt),
      lastAt: count(entry.lastAt),
      ...numbers,
      models: modelList({ models }),
    }
    sessions.push(session)
    mergeNumbers(totals, session)
  }

  sessions.sort((left, right) => right.totalTokens - left.totalTokens)

  const days = Object.entries(byDay)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, bucket]) => ({ day, ...bucketNumbers(bucket) }))

  const models = Object.values(byModel)
    .map((model) => ({
      provider: model.provider,
      model: model.model,
      ...bucketNumbers(model),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)

  totals.sessions = sessions.length
  delete totals.models

  return {
    totals,
    byDay: days,
    byModel: models,
    sessions,
    bounds: { first: earliest, last: latest },
  }
}
