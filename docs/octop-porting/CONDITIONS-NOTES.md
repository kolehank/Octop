# 实施条件核查结论（执行前记录）

> 日期：2026-11-07 ・ 分支：`develop`（`6918a059`）・ 核查人：Cindy 协调 agent
> 结论：**具备实施条件，直接开工，无需额外讨论轮次。** 下述核查证据与偏差已在本文件固化，供实施团队引用。

## 1. 已核实的现有零件（全部真实验证过）

| # | 条件 | 证据 | 状态 |
|---|---|---|---|
| 1 | 插件后端系统（tool/skill/hook/channel） | `src/octop/infra/agents/plugins/manager.py`（kind 解析、`sync_skills_to_workspace`）、`seed.py`；`docs/plugin-package.md` 完整规范 | ✅ |
| 2 | 插件入口 API | harness `PluginContext`：`ctx.tool(name, fn, description=…)`、`ctx.skills("skills")`、`ctx.middleware`、`ctx.channel` | ✅ |
| 3 | 插件 UI 自包含 ESM 加载 | `dashboard/src/plugins/toolRenderers/loader.ts`（鉴权 fetch + blob URL + `setup(host)`） | ✅ |
| 4 | 插件 UI 可用的 host 方法 | `types.ts` / `host.ts`：`registerRenderer`、`getToolContext`、`patchResult`、`request`、`openSidePanel`、`closeSidePanel` | ✅ |
| 5 | 画板 dock（per-callId tab） | `useChatDockPanel.ts:248 openToolUiTab`、`Chat/index.tsx:535 setPluginUiDockHandlers` | ✅ |
| 6 | workspace 读写 | `api/routers/workspace.py`：`tree` / `file`(GET/PUT) / `upload`(multipart) / `download` / `doc` | ✅ |
| 7 | 现成范例 | `plugins/demo-ui-card`（tool+ui 完整骨架）、`plugins/demo-greeting-skill`（skill 骨架） | ✅ |
| 8 | 真实稿件参考 | 根目录 `opendesign-projects/c9c56fde…/`：`design.html` + 多份 `revision-*.html`（Cindy 侧导出，可作数据布局与修订历史参考） | ✅ |
| 9 | 构建/测试环境 | uv 0.12.13、node v22；`dashboard && npx tsc -b` 通过；`uv run pytest tests/unit -q`：**4631 passed, 8 skipped** | ✅ |

## 2. 与 roadmap/计划的偏差（实施时务必按此执行）

1. **React 全局名**：`docs/plugin-package.md` 写的是 `window.__OCTOP_REACT__` / `__OCTOP_JSX__`，
   但代码实际注入的是 **`window.__AGENTBUDDY_REACT__` / `window.__AGENTBUDDY_JSX__`**
   （`dashboard/src/plugins/toolRenderers/ensureBuiltins.ts:16-21`）。**以代码为准**，插件 UI 源码引用 `__AGENTBUDDY_REACT__`。
2. **`sendUserTurn` 确实缺失**（roadmap §4 补丁属实）：`host.ts` 的 `dockHandlers` 只有
   `openSidePanel` / `closeSidePanel`；接线点在 `Chat/index.tsx:535-540`，可直接新增 `sendUserTurn`，
   复用到现有 `wrappedHandleSend`（`Chat/index.tsx:752`）。⚠️ 注意 `wrappedHandleSend` 内含
   `interceptUserMessage` 与 HITL 暂停路由，补丁必须复用同一语义，不要另起一条发送通道。
3. **dock tab 收敛**：`openToolUiTab` 按 `dockToolUiTabId(callId)` 建 tab（每 callId 一个），
   与 roadmap P2 的「同 slug 收敛」目标一致——实现时在 UI 侧对同一 slug 复用同一 tab + 轮询刷新即可，不改宿主逻辑。
4. **Office 依赖**：`python-docx / python-pptx / openpyxl / xlrd / pypdf` 确在主依赖（`pyproject.toml:41-48`），做 skill 插件不需要安装额外依赖。

## 3. 实施分工（并行，文件互不重叠）

| 任务 | 目录 | 内容 |
|---|---|---|
| A. 核心补丁 | `dashboard/src/plugins/toolRenderers/types.ts`、`host.ts`、`pages/Chat/index.tsx` | 新增 `host.sendUserTurn(text)`，复用 `wrappedHandleSend`；导出 `.patch` 文件 |
| B. OpenDesign 插件 | 新建 `plugins/octop-design/` | backend（plugin.yaml / main.py / design_store.py）+ ui（vite 源码 → ui/dist）+ 批注闭环；`sendUserTurn` 存在则直连，否则剪贴板降级 |
| C. Office skill 插件 | 新建 `plugins/octop-office/` | SKILL.md + scripts（xlsx/docx/pptx/read/convert_pdf/_theme/_io）+ golden 测试 |

## 4. 风险与缓解（沿用 roadmap §5，补充一条）

- UI 拿 React 的名字容易写错 → 本文件 §2.1 已固化正确名，代码里加注释。
- `sendUserTurn` 与 HITL 冲突 → 补丁直接调 `wrappedHandleSend`，不新造发送路径。
- 插件 ZIP 体积小，无构建风险；`ui/dist` 需预构建（本机 node 已具备）。
- 集成验证：每个任务自测通过后，根目录跑 `make all`（ship bar）确认整体不回归。