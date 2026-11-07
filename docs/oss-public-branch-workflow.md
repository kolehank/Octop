# 公开分支工作流（双轨分支策略）

> 本仓库同时面向两套环境：**GitHub 公开仓库**（`origin`，含 fork 自 TencentCloud/Octop 的上游代码 + 白标化 + 公开 demo 大屏）与**内网交付线**（`dstech`，真实业务内容）。
>
> 本文件只描述**公开线一侧可公开**的协作契约：分支职责、同步与发版流程、脱敏红线。业务线的具体细节（业务屏标识、数据目录、敏感词清单、历史踩坑记录）写在**内网线仓库**的 `docs/internal-branch-notes.md`，不进公开树。

---

## 0. 分支契约（先读这一条）

| 分支 | 大屏工程 | 定位 | 能否上 GitHub |
|------|----------|------|---------------|
| `oss` | `bigscreen/src/screens/demo/**` + `bigscreen/public/data/demo/**`；`App.tsx` 只注册 `/screen/demo/*`；标题「运行演示 · 演示助手」 | **专家智能体接入能力示例**：只演示「大屏 → 专家对话 → 专题子智能体路由」这条链路，数据全部是构造样例 | ✅ |
| `develop` | 业务大屏（屏幕标识、数据目录与文案见内网线文档） | **真实业务**：真实指标、真实部门/区块数据 | ❌ 永不公开 |

规则：

1. **oss 侧不得出现任何业务信息**：业务路径、业务数据文件、业务文案与地名/单位名、本机路径。oss 的大屏只是能力演示，不是业务交付物。
2. **develop 是并集**：上游 + 白标 + 真实业务；`oss` 永远是 `develop` 的子集，反之不成立。
3. **两侧大屏代码同构**，差异只在「屏幕标识 + 数据前缀」（公开线固定 `demo/` 前缀）。`oss → develop` 合并时**以业务分支自己的标识为准**，不要把公开线的命名带进业务线。
4. **内置专家库**：暂时跟随上游 #2418 —— 仓库内只保留 `default` 模板，其余模板从远端市场（或私有市场，`OCTOP_MARKET_REMOTE_ORIGIN`）安装。业务线自带的行业专家模板只存在于内网线，不进 `oss`。

---

## 1. 背景与目标

- 上游项目：<https://github.com/TencentCloud/Octop>（`upstream`），我们会持续同步其更新。
- 内网交付线承载**不适合公开**的真实业务内容。
- 目标：
  1. 持续接收上游更新；
  2. 能在 GitHub 上用 Action 编译白标化安装包（公开）；
  3. 业务内容**永不进入任何 GitHub 提交历史**。

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
| `dstech` | 内网 git（地址见内网线文档） | 内网代码库，业务内容归处 |

### 分支职责

| 分支 | 流向 | 职责 | 能否上 GitHub |
|------|------|------|---------------|
| `main` | origin + dstech | 发布基线；只收 `release/*` 合并与 `v*` tag | ✅ |
| `oss` | origin（公开开发线） | 上游同步 + 白标化 + 公开 demo 大屏；发版源 | ✅ |
| `develop` | dstech（内网开发线） | `oss` 内容 + 业务大屏 | ❌ |
| `feature/*` | dstech | 业务功能分支 | ❌ |

## 3. 日常开发流（内网业务）

```bash
git switch develop
# …开发业务…
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

敏感扫描内容 = 业务数据/屏幕目录 + 业务关键词（业务代号、地名、单位名、专有名称）+ 本机绝对路径。具体清单维护在内网线文档（业务侧需要按实际情况增补），避免在公开树里重复罗列。

> 已知盲点：钩子只扫**变更路径名 + 提交信息**，不扫文件内容。改动文件正文时请自行确认没有带入业务信息。

紧急绕过（仅当你清楚后果）：`SKIP_PUSHCOVER=1 git push …`。

## 8. 敏感内容红线（绝对不上 GitHub）

- 业务数据目录与业务屏幕目录（清单见内网线文档）。
- 任何业务地名/单位名/专有名称的文档或文案（README、ADR、页面标题、SVG 徽标文字）。
- 本机绝对路径出现在文档/代码中。
- 构建产物 `src/octop/bigscreen/` 已被 `.gitignore` 排除，**不要 `git add -f` 强制加入**。

## 9. 注意事项

- 公开版大屏与业务版大屏同构但数据不同：公开线用 `bigscreen/public/data/demo/` + `demo/` 前缀，业务线用各自的业务前缀 + 业务数据。两侧代码合并时以「上游为基底、各自叠加」处理。
- 每次推 GitHub 前跑一次敏感自检（命令见内网线文档），输出应为空。

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
| 8 | **搜索提供商被上游带回** | `BRAVE_API_KEY`/`google_search` 又出现 | **brave/google 因国内/私有化内网不可达已移除**（替换为 doubao/exa，见 `docs/search-engine-extension-plan.md`），同步后 grep 清理：`search_probe`、`env_file.SEARCH_ENV_KEYS`、`tool_catalog`、`SearchConfig`、i18n 词条、`builtinToolIcons`。harness（库）保留全量 providers，**不要动** |
| 9 | **白标补齐被上游回退** | 移除 brave/google 时连带删掉 doubao/exa 探针用例；`openapi_meta.py` tag 描述写回上游 provider 列表 | 同步后 `git diff <上游>:<file> :<file>` 抽查白标文件；`tests/unit/utils/test_search_probe.py` 必须保留 doubao/exa 用例 |
| 10 | **本地增量函数被上游合并删掉** | mypy F821 `Undefined name`（如 `history.py` 的 `is_valid_screen_key`；repo 的 `list_by_agent_user_filtered`） | 这些是本地 ADR004 大屏会话增量，上游 merge 会改回上游形态。用 `git show develop:<file>` 找回本地版，手工补回（import 加回 / 方法重插） |
| 11 | **白标路径/协议名被上游带回** | 上游新测试写死 `.octop`/`octop.db`/`OCTOP_IN_CONTAINER`（本地是 `.agentbuddy`/`agentbuddy.db`/`AGENTBUDDY_IN_CONTAINER`） | 上游新增测试沿用官方命名。merge 后 grep 新测试，路径/协议名换白标：`.octop`→`.agentbuddy`、`octop.db`→`agentbuddy.db`、`OCTOP_IN_CONTAINER`→`AGENTBUDDY_IN_CONTAINER`、`/.octop/workspaces`→`/.agentbuddy/workspaces` |
| 12 | **TokenHub / Tencent 供应商模板带回** | 设置页出现 `Tencent Cloud TokenHub`；`provider_template.json` 含 `tencent-tokenhub` | 白标去腾讯系：删 harness `provider_template.json` 的 `tencent-tokenhub` 条目（保留其余 tencent 模板，口径需与用户确认）。`presets.py` 里的 `tencent-tokenhub` 只是能力探测（非预设入口），保留无害 |
| 13 | **release_download_links.py 被上游覆写** | 下载页出现 `TencentCloud`/`Octop-*`/fnos 链接；测试断言 fnos_assets | merge 后重写为白标版：`kolehank/Octop` + `agentbuddy-desktop-*` + 无 fnos + 保留上游 lite/full 感知（`docker_image_section(lite, full)`）。与本地 Docker 发布语义对齐：`:{version}`=lite、`-full`=full |
| 14 | **CI Windows 偶发时序失败** | `test_reload_agent_does_not_block_event_loop` 等 1s 硬超时在 Windows runner 偶发 Timeout | 本地既有 flaky（非本次引入）：本地过 + Linux 绿 + Windows 偶红 → 先 rerun 确认；确系时序偶发则接受（不擅改超时）。一轮 CI 约 20-30 分钟，用后台 worker 监控而非主线轮询 |

### 10.3 运行时库（packages/）升级法（2026-11-07 首次，1.0.3b3/b4 同步验证）

上游发版常要求提升 `octop-harness` / `octop-memory` 等 pin（如 b3 要求 harness≥1.0.7、memory≥1.0.3，b4 要求 harness≥1.0.8）。本地 `packages/` 是 **vendored 快照**（无自建 git），且不是纯官方拷贝——带了白标（`~/.agentbuddy` 路径兼容、doubao/exa provider 等）。所以**不能整树替换**，要三方合并：

```bash
# 1) 官方 tag 快照 /tmp/pkg-up/<lib>
git -C ~/source2026/octop-harness archive v1.0.8 | tar -x -C /tmp/pkg-up/harness
# 2) 对每个白标文件三方合并：base=官方旧版 ours=本地 theirs=官方新版
git merge-file -p <theirs> <base> <ours> > <dest>
# 3) 官方独有新增文件直接带入；本地独有（doubao/exa）拷贝回
```

实战要点（harness 1.0.6→1.0.8、memory 1.0.2→1.0.3）：
- harness 白标面 = 9 个文件（`agent.py`、`backends/workspace.py`、`backends/docker_sandbox.py`、`cli/__init__.py`、`cli/config/paths.py`、`init.py`、`providers/__init__.py`、`runtime_env.py`、`builtin/tools/web_search/_registry.py`）+ 独有 `doubao.py`/`exa.py`。官方 1.0.6→1.0.8 只改了其中 2 个（`agent.py`、`docker_sandbox.py`），三方合并全部零冲突
- memory 白标面 = 13 个文件；官方 1.0.2→1.0.3 只改了 `core.py`/`sqlite.py`，其余直接保留本地版
- 判断本地是否有白标差异：`diff -rq packages/<lib>/src /tmp/pkg-up/<lib>/src | grep -v __pycache__`
- 升级后 `pyproject.toml` 的 `>=` pin 随 merge 自动带入（上游 merge 已含），版本号以官方 tag 为准

### 10.4 白标搜索提供商（决策记录）

- brave / google（Google CSE）：国内与私有化内网不可达 → **白标时移除**，以 **豆包（doubao）与 Exa** 替代。
- 移除范围仅限 **Octop 侧**（探测/目录/设置页/词条）；`packages/octop-harness`（上游库）保留全部 provider，避免与上游未来 merge 冲突。
- 既有 `tests/unit/utils/test_search_probe.py` 与 `tests/integration/test_search_api.py` 已断言 brave/google `invalid_config`，是保护性用例。

### 10.5 CI 验证流程

- 推 `origin/oss` **不会**触发 CI（`ci.yml` 只监听 `pull_request`；`release.yml` 只监听 `v*` tag）。
- 要跑 make all 验证：`gh pr create --base main --head oss ...`（**只验证、不 merge**），然后 `gh pr checks` 观察：
  `Analyze` / `Build frontends` / `Python 3.12`（lint+typecheck+test）/ `Windows / Python 3.12`。
- 修完一版就 push 一次，PR 自动重跑；后台轮询注意 `make test` 需 ~10–15 分钟。
- 验证通过后 PR 可关闭（不合并 main）。

### 10.6 收尾检查（ship 前）

```bash
uv run ruff check src tests scripts && uv run ruff format --check src tests
uv run mypy src/octop
uv run pytest tests/unit -q            # 关键子集，全量留给 CI
cd dashboard && npx tsc -b && cd ../bigscreen && npx tsc -b
# 敏感内容自检：命令见内网线文档（业务路径 + 业务关键词），输出应为空
```

- 版本号 sync 后跟上游（发版时单独 bump）；oss 的 CHANGELOG 历史未随 merge 并入，发版时整理。

## 11. 本地提交门禁（.githooks/pre-commit）

`make install-hooks` 同时启用 pre-commit：对代码提交跑 `make precommit`（format + lint + typecheck + testmon 增量测试 + bigscreen 检查）+ dashboard build。

- **只改文档（`README*.md`、`docs/**`）的提交直接跳过**——散文改动不会弄坏 lint/typecheck/测试，而整套门禁要数分钟。
- 应急绕过：`SKIP_PRECOMMIT=1 git commit …`（仅当你已经手工跑过等价检查）。
