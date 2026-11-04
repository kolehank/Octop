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
## 10. 上游同步实操手册（2026-11 首次补齐实战记录）

> §6 的首次补齐已于 2026-11 完成（`oss` ← `upstream/develop`，上游 78 个提交）。
> 本节记录执行策略与踩坑清单，供后续每次 sync 与发版参照。

### 10.1 合并执行策略

```bash
git switch oss
git fetch upstream
git merge upstream/develop -X theirs   # 内容冲突一律取上游（“以上游为基底”）
```

- `-X theirs` 只解决**内容冲突**（UU/AA）。树级冲突（modify/delete、rename）git 不自动解，必须手动：
  - **UD（上游删、oss 只做白标小改）** → 跟随上游删除（`git rm`）。典型：上游删除的内置专家/插件/tests。
  - **DU（oss 删、上游改）** → 跟随 oss 删除。典型：`fnos/*`、`AppVersionBadge/CurrentVersionBadge/UpdateConfig`（`ff1c3420` 白标决策）。
  - 判断依据：`git log --oneline --all --diff-filter=D -- <路径>` 查 oss 是否**有意**删除；有 `chore(brand)` / `whitelabel` 字样的提交即白标决策。
- 全部 unmerged 清空后再 commit：`git status --porcelain | awk '$1 ~ /UU|AA|UD|DU|UA|DD|AU/'` 应为空。

### 10.2 结构性陷阱清单（sync 后逐一自查）

| # | 陷阱 | 症状 | 处置 |
|---|------|------|------|
| 1 | **上游 `uv.lock` 无法解析** | `uv lock` / `uv run` 报 `Dependency X has missing source field` | 删除坏 lock 后 `uv lock` 重生成。会丢掉 oss 在 lock 层的 pin（如 webauthn/cbor2 legacy），发版前按需重 pin |
| 2 | **tqdm 只在可选 extras** | CI（`uv sync` 无 extras）下 tqdm 缺失，`_progress_tqdm` 返回 None 挂测试 | 测试内注入 fake `tqdm.auto`（参考 `tests/unit/agents/test_onnx_download.py` 的模式） |
| 3 | **fnos 残留** | 读 `fnos/..` 文件失败；release 脚本/README/测试含 fnos | `grep -rn 'fnos\|FnOS' tests/ src/ scripts/ docs/` 清掉；`release_download_links.py` 删 `fnos_assets/fnos_section`、镜像地址用 `ghcr.io/kolehank/octop` |
| 4 | **自动合并的重复定义** | mypy `no-redef`、tsc `TS2393`、同名测试函数、重复 property | 对照 `66ecf830`（白标版权）与 `upstream/develop` 双版本，删 oss 旧版保留上游新版（或反之，按调用点定） |
| 5 | **前端深度分叉文件混合产物** | tsc 报未定义变量（`committed`/`searchQuery`/`role`/`inputProps`）、丢 JSX 闭合 | 这些文件 oss 与上游差异大（IME 补丁 vs 上游），手动合并时以 **oss IME 语义（`useImeSearchInput`）+ 上游新功能** 为准，参考 66ecf830 同名文件 |
| 6 | **协议/标识符级白标** | 前后端 header/localStorage/日志名不一致 | 逐一核对：`X-Agentbuddy-Access-Token`、`agentbuddy.log` 轮转正则、`agentbuddy:*` localStorage 前缀、`AGENTBUDDY_HOME`/`AGENTBUDDY_*` 环境变量、`/data/.agentbuddy` 挂载、`agentbuddy-desktop-*` 发行物名 |
| 7 | **i18n parity** | `tests/unit/i18n` 挂 | dashboard↔backend 的 `tools` 等命名空间 key 必须同步增删（en/zh × 2 份） |
| 8 | **搜索提供商被上游带回** | `BRAVE_API_KEY`/`google_search` 又出现 | **brave/google 因国内/政务不可达已移除**（替换为 doubao/exa，见 `docs/search-engine-extension-plan.md`），同步后 grep 清理：`search_probe`、`env_file.SEARCH_ENV_KEYS`、`tool_catalog`、`SearchConfig`、i18n 词条、`builtinToolIcons`。harness（库）保留全量 providers，**不要动** |

### 10.3 白标搜索提供商（决策记录）

- brave / google（Google CSE）：国内与政务内网不可达 → **白标时移除**，以 **豆包（doubao）与 Exa** 替代。
- 移除范围仅限 **Octop 侧**（探测/目录/设置页/词条）；`packages/octop-harness`（上游库）保留全部 provider，避免与上游未来 merge 冲突。
- 既有 `tests/unit/utils/test_search_probe.py` 与 `tests/integration/test_search_api.py` 已断言 brave/google `invalid_config`，是保护性用例。

### 10.4 CI 验证流程

- 推 `origin/oss` **不会**触发 CI（`ci.yml` 只监听 `pull_request`；`release.yml` 只监听 `v*` tag）。
- 要跑 make all 验证：`gh pr create --base main --head oss ...`（**只验证、不 merge**），然后 `gh pr checks` 观察：
  `Analyze` / `Build frontends` / `Python 3.12`（lint+typecheck+test）/ `Windows / Python 3.12`。
- 修完一版就 push 一次，PR 自动重跑；后台轮询注意 `make test` 需 ~10–15 分钟。
- 验证通过后 PR 可关闭（不合并 main）。

### 10.5 收尾检查（ship 前）

```bash
uv run ruff check src tests scripts && uv run ruff format --check src tests
uv run mypy src/octop
uv run pytest tests/unit -q            # 关键子集，全量留给 CI
cd dashboard && npx tsc -b && cd ../bigscreen && npx tsc -b
git ls-tree -r --name-only HEAD | grep -iE 'fgw|zhoushan'   # 敏感内容自检
```

- 版本号 sync 后跟上游（发版时单独 bump）；oss 的 CHANGELOG 历史未随 merge 并入，发版时整理。
