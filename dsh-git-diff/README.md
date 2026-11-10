# dsh-git-diff

DeepSeek Harness（DSH）右侧栏的本地 Git 差异面板。打开「本地差异」标签页即可按会话的工作目录查看改动：哪些在暂存区、哪些还没暂存、哪些是未跟踪文件，以及逐文件的具体变化。

## 功能

- 四种范围：**全部**（工作区 + 索引 + 未跟踪 vs HEAD）、**已暂存**（索引 vs HEAD）、**未暂存**（工作区 vs 索引）、**未跟踪**
- 逐文件显示状态（新增 / 删除 / 重命名 / 二进制 / 未跟踪）、增删行数与 hunk 内容，支持折叠
- 顶部显示分支、短 HEAD、仓库根目录与总增删行数；「刷新」重新读取
- 面板隐藏时不发请求；切换会话或范围时自动重新读取
- 中文 / English 双语，跟随 DSH 当前语言

## 基准与兼容性

**基准全部来自本地 Git**：HEAD 与索引。不读取 `refs/remotes/*/HEAD`，不做托管平台识别，因此 gitolite、自建仓库、detached HEAD、没有配置 remote 的本地仓库都能正常显示——这正是官方 forge 面板在非 GitHub 仓库上失败的地方。

只读：执行的都是 `git rev-parse`、`git diff`、`git ls-files`，不写索引、不改工作区。

## 上限

| 限制 | 值 | 超出时 |
| --- | --- | --- |
| 单次补丁 | 4 MB | 返回 `diff-too-large`，提示先提交部分改动 |
| 文件条数 | 500 | 其余计入「还有 N 个文件未列出」 |
| 未跟踪文件 | 200 个 | 其余计入未列出数量 |
| 单个未跟踪文件 | 1 MB | 只列出名称与「过大」徽标 |
| git 命令超时 | 15 s | 返回 `git-failed` |

## 结构

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | Host 半侧：认证的 `GET /api/git-diff/diff` 路由，解析会话工作目录并运行 git |
| `lib/git.js` | 纯函数：补丁解析、未跟踪文件包装、汇总；由 `node --test` 覆盖 |
| `lib/client.js` | 浏览器半侧：注册右侧栏标签页类型与正文，渲染范围切换与 diff |
| `cordis.patch.yml` | bundle patch，插入 `git-diff` 一行 |
| `test/git.test.mjs` | 解析层单元测试 |

## 安装

在 web profile 中作为本地插件安装（`link:` 依赖 + bundles 条目），启用后右侧栏起始页会出现「本地差异」入口。

## 测试

```bash
node --test
```
