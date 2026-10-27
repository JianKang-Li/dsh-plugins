# dsh-session-token-stats

DeepSeek Harness（DSH）本机会话 Token 用量统计插件。它在 Web GUI 侧边栏新增「Token 用量」入口，汇总本机所有会话的模型调用消耗，支持按时间筛选、查看每日用量、模型分布和会话明细。

## 功能

- 汇总所有主会话与子会话的 Token 用量
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

## 统计口径

- 数据来源是会话日志中的 `assistant/message.usage`，即模型提供商上报的每次调用用量。
- `inputTokens` 是未命中缓存的输入；缓存命中单独计入 `cacheReadTokens`；`cacheWriteTokens` 仅部分提供商会上报。
- `totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`。
- `reasoningTokens` 是输出的一部分，只作为参考展示，不重复计入合计。
- 日期按 DSH 进程所在机器的本地时区分桶；界面会显示当前时区。
- fork 继承的父会话历史事件会被跳过，避免与父会话重复计数。
- 子会话（subagent）是独立的模型消耗，正常计入；会话明细中带「子会话」标记。
- 没有上报用量的请求无法从日志还原，因此不计入。

## 数据与缓存

聚合缓存写入：

```text
$DSH_HOME/storages/session-token-stats/cache.v1.json
```

缓存以 `sessionPersistence.list()` 返回的 revision、事件数和文件大小作为变更签名。缓存损坏或版本不匹配时会被忽略并重建；也可以直接删除该文件，下一次请求会重新扫描所有会话。

## HTTP API

浏览器半侧通过 DSH Connection 的认证 `/api` 前缀读取数据：

```text
GET /api/session-token-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
```

- `from` / `to` 可选，包含端点；省略表示不限制。
- 返回 `totals`、`byDay`、`byModel`、`sessions`、`scanned` 和 `range`。
- 非法日期或开始日期晚于结束日期返回 400。

## 兼容性

- 针对 DSH `0.2.1-rc.2` 开发，`dsh.compatibility.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0`。
- 依赖 Host 侧的 `sessions`、`sessionPersistence` 和 `connection` 服务，以及浏览器侧的 `locale`、`ui-layout`、`ui-sidebar` 插件。
- 仅适用于 Web profile；不提供终端或 headless 界面。

## 开发

```sh
# 纯聚合逻辑单测
node --test test/*.test.mjs
```

项目没有构建步骤：`lib/index.js` 是 Host 半侧 ESM，`lib/client.js` 是手写浏览器 CJS bundle，只依赖平台 seed 中的 `react`。

### 目录

| 路径 | 职责 |
| --- | --- |
| `lib/index.js` | Host 插件：读取会话、聚合、缓存、注册 `/api/session-token-stats` |
| `lib/stats.js` | 纯聚合逻辑：用量字段、按天/模型折叠、日期范围校验 |
| `lib/client.js` | 浏览器插件：主面板、侧边栏图标、筛选交互、双语字典 |
| `test/stats.test.mjs` | 聚合、日期范围、fork 继承跳过等单测 |
| `cordis.patch.yml` | bundle patch，注册 Host 行 |

## 卸载

```sh
dsh plugin --profile web remove dsh-session-token-stats
```

然后从 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 中移除 `dsh-session-token-stats`，重启 DSH。缓存目录可保留或删除。
