# dsh-session-token-stats

DeepSeek Harness（DSH）本机会话 Token 用量统计插件。它在 Web GUI 侧边栏新增「Token 用量」入口，汇总本机所有会话的模型调用消耗，支持按时间筛选、查看每日用量、模型分布和会话明细。统计结果独立持久化，删除会话不会丢失已记录的用量；也可以随时在界面清理统计，从零开始重新计数。

## 功能

- 汇总所有主会话与子会话的 Token 用量
- 统计结果独立持久化，删除会话后历史用量仍保留，并在明细中标记「已删除」
- 界面清理统计：清零后只累计之后的模型调用，刷新不会恢复旧数据
- 时间筛选：全部、今天、近 7 天、近 30 天、本月、自定义日期范围
- 每日 Token 消耗图表与表格，包含输入、缓存读取、缓存写入、输出和合计
- 按模型分布统计，按会话明细排序与搜索
- 活动会话直接读取内存快照，历史会话读取持久化日志
- 按会话 revision 缓存聚合结果，冷启动后只重新解析变化的会话
- 中文 / English 双语界面，跟随 DSH 当前语言

## 安装

插件以本地包方式安装到 DSH 的 web profile。以下命令中的路径按实际项目位置调整。

```sh
# 1. 在 web profile 中安装本地包
dsh plugin --profile web add file:dsh-session-token-stats

# 2. 把插件加入 profile 的 bundle 列表
#    编辑 ~/.dsh/profiles/web/package.json，在 dsh.profile.bundles 中追加：
#    "dsh-session-token-stats"
```

`cordis.patch.yml` 会由包的 `dsh.bundle.patch` 自动应用，无需手动插入 Loader 行。

修改 profile 后：

- 如果 profile 开启了 `patchReload: live`，DSH 会尝试热重载；
- 如果没有出现入口，重启 `dsh --profile web` 后刷新页面。

安装后打开 Web GUI，侧边栏会出现「Token 用量」入口。

## 使用

1. 打开侧边栏的「Token 用量」。
2. 选择时间范围。预设按钮会立即刷新；自定义范围填写开始/结束日期后点「应用」。
3. 查看总览卡片、每日图表/表格、模型分布和会话明细。
4. 会话明细支持按标题、路径或会话 ID 搜索，并可按用量或最近活动排序。
5. 点击右上角「清理统计」并确认，可清空全部统计并重新开始计数；已删除的会话记录也会一并清除。

## 统计口径

- 数据来源是会话日志中的 `assistant/message.usage`，即模型提供商上报的每次调用用量。
- `inputTokens` 是未命中缓存的输入；缓存命中单独计入 `cacheReadTokens`；`cacheWriteTokens` 仅部分提供商会上报。
- `totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`。
- `reasoningTokens` 是输出的一部分，只作为参考展示，不重复计入合计。
- 日期按 DSH 进程所在机器的本地时区分桶；界面会显示当前时区。
- fork 继承的父会话历史事件会被跳过，避免与父会话重复计数。
- 子会话（subagent）是独立的模型消耗，正常计入；会话明细中带「子会话」标记。
- 没有上报用量的请求无法从日志还原，因此不计入。
- 会话首次被本插件读取后，用量会写入独立统计库；之后即使会话被删除，用量仍计入总量和会话明细。
- 会话从 Host 会话列表中消失后（例如删除后重启 DSH），明细中会标记「已删除」；仍驻留内存的已删除会话会继续显示「运行中」，统计不受影响。
- 已删除会话在统计库中只保留标题、工作目录、会话元数据和用量摘要，原始会话日志和消息内容不会被本插件保留；清理统计会一并删除这些摘要。
- 从未被本插件读取过就被删除的会话，日志已经不存在，无法再补统计。
- 清理统计会记录当前时间作为新的统计起点，早于起点发生的调用不再计入；刷新或重启后也不会恢复。

## 数据与统计库

统计结果写入：

```text
$DSH_HOME/storages/session-token-stats/stats.v2.json
```

文件包含结构版本、保存时间、统计起点（`resetAt`）和按会话 id 累积的每日用量。它以 `sessionPersistence.list()` 返回的 revision、事件数和文件大小作为变更签名，只重新解析新增或变化的会话；已不在会话列表中的条目会继续保留。

旧版 `cache.v1.json` 不再读取，可以直接删除。统计库损坏或版本不匹配时会被忽略并重建，此时现存会话会重新扫描，但已删除会话的记录会丢失；需要重新统计时请使用界面上的「清理统计」，而不是删除统计库文件。

统计库按单个 DSH 进程使用设计；不要让多个进程共用同一个 `DSH_HOME`，否则后写入的进程会覆盖先写入的统计结果。

## HTTP API

浏览器半侧通过 DSH Connection 的认证 `/api` 前缀读取数据：

```text
GET /api/session-token-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
```

- `from` / `to` 可选，包含端点；省略表示不限制。
- 返回 `totals`、`byDay`、`byModel`、`sessions`、`scanned`、`range` 和 `resetAt`。
- `sessions` 中已删除的会话带 `deleted: true`；`scanned.orphans` 是保留的已删除会话数。
- 非法日期或开始日期晚于结束日期返回 400。

清理统计：

```text
POST /api/session-token-stats/clear
```

- 清空统计库并记录新的统计起点，返回 `{ ok: true, resetAt }`。
- 早于 `resetAt` 的模型调用不再计入；清理后刷新不会恢复旧数据。
- 写盘失败返回 500，内存状态会回滚。

## 兼容性

- 针对 DSH `0.2.1-rc.2` 开发，`dsh.compatibility.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0`。
- 依赖 Host 侧的 `sessions`、`sessionPersistence` 和 `connection` 服务，以及浏览器侧的 `locale`、`ui-layout`、`ui-sidebar` 插件。
- 仅适用于 Web profile；不提供终端或 headless 界面。

## 开发

```sh
# 聚合逻辑单测 + Host 统计库集成测试
node --test test/*.test.mjs
```

项目没有构建步骤：`lib/index.js` 是 Host 半侧 ESM，`lib/client.js` 是手写浏览器 CJS bundle，只依赖平台 seed 中的 `react`。

### 目录

| 路径 | 职责 |
| --- | --- |
| `lib/index.js` | Host 插件：读取会话、聚合、独立统计库、注册读取与清理接口 |
| `lib/stats.js` | 纯聚合逻辑：用量字段、按天/模型折叠、统计起点、日期范围校验 |
| `lib/client.js` | 浏览器插件：主面板、侧边栏图标、筛选与清理交互、双语字典 |
| `test/stats.test.mjs` | 聚合、日期范围、fork 继承跳过、统计起点等单测 |
| `test/host.test.mjs` | 统计库集成测试：删除会话保留统计、清理后重新计数 |
| `cordis.patch.yml` | bundle patch，注册 Host 行 |

## 卸载

```sh
dsh plugin --profile web remove dsh-session-token-stats
```

然后从 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 中移除 `dsh-session-token-stats`，重启 DSH。统计库目录可保留或删除。
