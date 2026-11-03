# dsh-session-manager

DeepSeek Harness（DSH）会话管理插件。它在 Web GUI 侧边栏的会话行「…」菜单里新增「删除会话」，二次确认后永久删除该会话的本地数据。

## 功能

- 会话行菜单新增「删除会话」（位于「复制会话 ID」之后，带分隔线与危险色）
- 点击后弹出确认框，写明会话标题与不可恢复的后果；确认按钮执行删除，取消或 Esc 关闭
- 删除成功后刷新会话列表，让该会话立即从所属工作区移除
- 正在当前窗口打开的会话会在提交前被拦下，提示先切换到其他会话
- 失败时就地显示原因，弹窗保留以便重试
- 中文 / English 双语界面，跟随 DSH 当前语言

## 删除范围

一次删除会处理该会话自有的数据：

| 数据 | 位置 / 处理 |
| --- | --- |
| 会话日志目录 | `<会话根>/<项目目录>/<会话 id>/`，含全部 generation 的 `session*.jsonl[.zstd]` |
| 投影缓存记录 | `$DSH_HOME/storages/session_projcache/sessions/<会话 id>.json` |
| Workspace 记账 | 从所属工作区的 `sessionIds` 中移除 |
| 归档 / 置顶集合 | 一并移除 |

删除前会校验目标目录必须是会话根下恰好两层的子目录、目录里确实存在会话日志文件，并确认解析符号链接后的真实路径仍在会话根内；校验不通过时拒绝执行，不改动任何数据。

## 安全边界

以下情况 Host 会拒绝删除，界面给出对应提示：

- 会话正在运行中的回合（`session-running`）：请先停止生成再试
- 会话仍有运行中的工作，例如运行中的子代理、后台任务或定时提醒（`session-busy`）
- 会话已不存在（`session-not-found`）
- 当前会话存储后端没有暴露会话产物路径，例如非 `jsonl` 后端（`backend-unsupported`）
- 目标目录形状不符合预期（`unexpected-layout`）
- 目标会话正在当前窗口打开：浏览器侧在提交前拦下，提示先切换到其他会话

## 已知限制

- Host 会把打开过的会话长期留在内存里，因此“已加载但空闲”的会话允许删除；如果另一个浏览器窗口正打开该会话，之后在其中发送的消息只存在于该窗口，不会写回已删除的日志
- 删除只清理磁盘数据，不会把会话从 Host 内存中卸载：`session/list` 仍会返回该会话，侧边栏行会继续留在「未分组」里，直到重启 DSH 才消失；此时日志已删除，继续使用该会话可能失败
- 只删除目标会话本身：它的子代理会话日志不会级联删除，附件是内容寻址的共享存储，也不随会话删除
- 跨进程保护不完整：另一个 DSH 进程同时打开该会话时，本插件无法感知
- 删除文件失败时（例如日志目录被其他进程占用或权限不足）接口返回 500：Workspace 记账已先清理，该会话会从所属工作区移除（可能落到「未分组」），日志仍在，可再次删除重试
- 投影缓存清理按默认存储根 `$DSH_HOME/storages` 定位；改用自定义存储根时该文件会保留（派生缓存，不影响使用）

## 安装

插件以本地包方式安装到 DSH 的 web profile。以下命令中的路径按实际项目位置调整。

```sh
# 1. 在 web profile 中安装本地包
dsh plugin --profile web add link:/绝对路径/dsh-session-manager

# 2. 把插件加入 profile 的 bundle 列表
#    编辑 ~/.dsh/profiles/web/package.json，在 dsh.profile.bundles 中追加：
#    "dsh-session-manager"
```

`cordis.patch.yml` 会由包的 `dsh.bundle.patch` 自动应用，无需手动插入 Loader 行。

Windows 上把 `link:` 后的路径写成 `C:/绝对路径/dsh-session-manager`，`~/.dsh` 对应 `%USERPROFILE%\.dsh`。

修改 profile 后：

- profile 开启 HMR 时，配置变化会触发热重载，无需重启；
- 如果没有出现菜单项，重启 `dsh --profile web` 后刷新页面。

安装后打开 Web GUI，在会话行悬停出现的「…」菜单中选择「删除会话」即可。

## 卸载

```sh
dsh plugin --profile web remove dsh-session-manager
```

然后从 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 中移除 `dsh-session-manager`。

## HTTP API

浏览器半侧通过 DSH Connection 的认证 `/api` 前缀调用：

```text
POST /api/session-manager/delete
content-type: application/json

{ "sessionId": "session-..." }
```

成功返回 `{ "ok": true, "sessionId": "..." }`；失败返回 `{ "ok": false, "error": { "code", "message" } }`，`code` 是上面列出的稳定错误码。

## 兼容性

- 针对 DSH `0.2.1-rc.5` 开发，`dsh.compatibility.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0`。
- 依赖 Host 侧的 `sessionPersistence` 与 `connection` 服务，并可选读取 Agent 注册表和 Workspace 注册表；浏览器侧依赖 `slots`、`locale`、`sessions` 服务和 `shell.overlay`、`sidebar.workspaces.session.menu.item` 两个插槽。
- 仅适用于 Web profile；不提供终端或 headless 界面。

## 跨平台

代码里没有固定的绝对路径，所有位置都在运行时解析：

- 会话日志目录来自 Host 的 `sessionPersistence.root` 与 `locate()`，只用 `node:path` 拼接，不按平台分支
- DSH 主目录按 `$DSH_HOME`（支持 `~`、`~/`、`~\` 展开）或 `os.homedir()` + `.dsh` 解析，与 DSH 自身的 home 解析一致
- 浏览器侧以文档相对路径请求 `api/session-manager/delete`，因此用 `--public-url` 把界面挂在子路径（如 `https://host/ui/`）下也能工作
- 单测用 `node:path` 构造路径，Windows 与 POSIX 均可运行；`npm test` 用 Node 自带的用例发现，不依赖 shell 展开通配符

## 开发

```sh
# 删除目标校验单测（Node 自带用例发现，Windows 下同样可用）
npm test
```

项目没有构建步骤：`lib/index.js` 是 Host 半侧 ESM，`lib/client.js` 是手写浏览器 CJS bundle，只依赖平台 seed 中的 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`。

### 目录

| 路径 | 职责 |
| --- | --- |
| `lib/index.js` | Host 插件：校验、Workspace 记账清理、删除日志目录与投影缓存、注册 `/api/session-manager/delete` |
| `lib/delete-target.js` | 纯路径校验：把日志路径收敛成可删除的会话目录，并确认真实路径未逃逸会话根 |
| `lib/client.js` | 浏览器插件：会话行菜单项、确认弹窗、失败提示与列表刷新 |
| `test/delete-target.test.mjs` | 路径校验的接受与拒绝用例 |
| `cordis.patch.yml` | bundle patch，注册 Host 行 |
