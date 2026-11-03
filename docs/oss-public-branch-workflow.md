# OSS 公开分支工作流（双轨分支策略）

> 本仓库同时面向两套环境：**GitHub 公开仓库**（`origin`，含 fork 自 TencentCloud/Octop 的上游代码 + 白标化 + 公开 demo 大屏）与**内网代码库**（`dstech`，含局办业务大屏等不可公开内容）。本文件是两支分支的日常协作契约。

---

## 1. 背景与目标

- 上游项目：<https://github.com/TencentCloud/Octop>（`upstream`），我们会持续同步其更新。
- 内网业务：局办/发改（fgw）业务大屏等**不适合公开**的内容。
- 目标：
  1. 持续接收上游更新；
  2. 能在 GitHub 上用 Action 编译白标化安装包（公开）；
  3. 业务内容（局办大屏数据、舟山发改等）**永不进入任何 GitHub 提交历史**。

## 2. 远程与分支布局

```
upstream (TencentCloud/Octop)          GitHub 公开         内网代码库
        │
        ▼
      oss 分支 ◄────────── 发版 release/x.y.z ──► main ──► v* tag ──► GitHub Release
        │  ▲
        │  │ merge oss（拿上游 + 公开改动）
        ▼  │
     develop 分支 ────────────────► push dstech（内网交付）
```

| 远程 | 地址 | 定位 |
|------|------|------|
| `upstream` | github.com/TencentCloud/Octop | 官方上游，只读 |
| `origin` | github.com/kolehank/Octop（fork） | 公开仓库，白标化 + 公开 demo |
| `dstech` | git.dstyun.com/…/agent-buddy.git | 内网代码库，业务内容归处 |

### 分支职责

| 分支 | 流向 | 职责 | 能否上 GitHub |
|------|------|------|---------------|
| `main` | origin + dstech | 发布基线；只收 `release/*` 合并与 `v*` tag | ✅ |
| `oss` | origin（公开开发线） | 上游同步 + 白标化 + 公开 demo 大屏；发版源 | ✅ |
| `develop` | dstech（内网开发线） | `oss` 内容 + 局办业务大屏（fgw） | ❌ |
| `feature/*` | dstech | 业务功能分支 | ❌ |

## 3. 日常开发流（内网业务）

```bash
git switch develop
# …开发业务（大屏 fgw 等）…
git push dstech develop
```

## 4. 同步上游流（固定 5 步，本地是合并中枢）

```bash
git switch oss
git fetch upstream
git merge upstream/develop        # ① 在上游基础上合，冲突在此解决（白标化改动 vs 上游）
git push origin oss               # ② GitHub Action 自动编译白标包，产出 artifact
git switch develop
git merge oss                     # ③ 业务线拿平台更新（大屏与上游冲突在此解决）
git push dstech develop           # ④ 内网交付
```

要点：

- 上游更新**只在 oss 分支合并一次**，再经 ③ 一分为二：GitHub 拿公开版，内网拿完整版。
- 冲突只出现在两处：① 白标化 vs 上游（少数）；③ 大屏 session/挂载 vs 上游（较常见，上游也在改 chat/history）。原则：**以上游为基底，各自叠加自己的增量**。
- 若只需稳定版，可改 `git merge upstream/main` 或指定 release tag；日常跟随 `upstream/develop` 最直接。

## 5. 发版流程

- **对外发版**（GitHub）：从 `oss` 切 `release/x.y.z` → PR merge 到 `origin/main` → 在 main 上打 `v*` tag → GitHub Release。**发版合并到 `main`，不会合并到 `develop`**；`develop` 靠第 4 节第 ③ 步获得更新。
- **内网交付**：走 `dstech`（可 `release/*` → `dstech/main`，或直接交付 `develop`，按内网发布习惯）。
- `main` 不参与日常合并；未发版时保持旧 tag（如 v1.0.13）不动即可。

## 6. 首次补齐上游历史（重要提醒）

oss 分支是基于本地已解决冲突的合并树（`read-tree` 方式）重建的，**历史中不含上游提交祖先**。因此首次执行 `git merge upstream/develop` 时，git 会认为上游 67 个提交全是"新增"，merge-base 退到 v1.0.13，第 4 节中已解决过的冲突（app.py、processor.py、AGENTS.md、whitelabel 相关）**可能重新出现**。这是正常现象，按"以上游为基底、各自叠加"解一次即可；此后每次同步就是干净增量。

## 7. 防呆钩子（.githooks/pre-push）

克隆后执行 `make install-hooks` 会启用该钩子（也直接受 `core.hooksPath=.githooks` 控制）。规则：

| 推送目标 | 分支 | 结果 |
|----------|------|------|
| `origin`（GitHub） | `main` / `oss` / `release/*` | ✅ 放行 |
| `origin`（GitHub） | `develop` / `feature/*` / `bigscreen*` | 🚫 拦截（业务分支不得公开） |
| `origin`（GitHub） | 任意：推送范围内含敏感路径/关键词 | 🚫 拦截 |
| `dstech`（内网） | 任意 | ✅ 放行 |

敏感扫描内容（路径 + 关键词）：`bigscreen/public/data/fgw`、`src/octop/bigscreen/data/fgw`、`screens/fgw`、`zhoushan`、`舟山`、`发改`、`智脑`、`局办`、`/Users/huangke` 等。

紧急绕过（仅当你清楚后果）：`SKIP_PUSHCOVER=1 git push …`。

## 8. 敏感内容红线（绝对不上 GitHub）

- 业务数据目录：`bigscreen/public/data/fgw/**`、`src/octop/bigscreen/data/fgw/**`（构建产物）
- 业务屏幕：`bigscreen/src/screens/fgw/**`
- 任何"舟山/发改/智脑/局办"字样的文档或文案（README、ADR、页面标题、SVG 徽标文字）
- 本机路径（`/Users/huangke/…`）出现在文档/代码中
- 构建产物 `src/octop/bigscreen/` 已被 `.gitignore` 排除，**不要用 `git add -f` 强制加入**

## 9. 注意事项

- 公开版大屏（oss）与业务版大屏（develop）同构但数据不同：oss 使用 `bigscreen/public/data/demo/` + `demo/` 前缀，业务使用 `fgw/` 前缀 + fgw 数据。两侧代码合并时以"上游为基底"处理。
- 每次推 GitHub 前可自检：`git ls-tree -r --name-only HEAD | grep -iE 'fgw|zhoushan'`，输出应为空。