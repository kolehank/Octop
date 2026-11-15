# Octop 移植实施报告 —— OpenDesign + Office 文档技能

> 日期：2026-11-07 ・ 分支：`develop`（基线 `6918a059`）・ 执行：Cindy 协调 agent + 3 个并行 worker
> 状态：**本轮范围（OpenDesign + Office）实施完成并通过本地验证**；IM 深度操作 / 桌面 Computer Use 按 roadmap 继续挂起。

## 0. 结论先行

- 实施条件核查结论：**具备**（插件系统、UI host、workspace API、构建环境全部就绪，无需讨论轮次直接开工）。
- 三个并行任务全部落地：核心补丁 `sendUserTurn`、OpenDesign 插件 `plugins/octop-design/`、Office 技能插件 `plugins/octop-office/`。
- 验证：后端单测 **4653 passed（基线 4631 + 新增 22）**、dashboard `tsc -b` 通过、ruff 干净、双插件 ZIP 安装烟测通过、Office golden 测试 + 真实 PDF 导出通过。
- 未提交不推送（遵循仓库约定）；所有改动在工作树，随时可 review。

## 1. 实施条件核查（2026-11-07，已固化 `docs/octop-porting/CONDITIONS-NOTES.md`）

| 条件 | 证据 | 结论 |
|---|---|---|
| 插件后端（tool/skill/hook/channel） | `src/octop/infra/agents/plugins/manager.py` + harness `PluginContext` | ✅ |
| 插件 UI 自包含 ESM + host 方法 | `plugins/toolRenderers/loader.ts` / `types.ts` / `host.ts` | ✅ |
| dock 画板（per-callId tab） | `useChatDockPanel.ts:248`、`Chat/index.tsx:535` | ✅ |
| workspace 读写 | `api/routers/workspace.py`（tree/file/upload/download） | ✅ |
| 参考素材 | `plugins/demo-ui-card`（tool+ui 骨架）、`opendesign-projects/`（真实稿件导出） | ✅ |
| 构建/测试环境 | uv 0.12.13、node v22；基线 4631 passed + tsc 绿 | ✅ |

关键偏差（详情见 CONDITIONS-NOTES §2）：插件 UI 的 React 全局名以代码为准是 **`window.__AGENTBUDDY_REACT__` / `__AGENTBUDDY_JSX__`**（`ensureBuiltins.ts:16-21`），`docs/plugin-package.md` 写的 `__OCTOP_REACT__` 已过时；实施以代码为准。

## 2. 任务交付物

### A. 核心补丁 `sendUserTurn`（worker A ✅）

| 文件 | 改动 |
|---|---|
| `dashboard/src/plugins/toolRenderers/types.ts` | `OctopPluginUIHost` 新增 `sendUserTurn(text: string): void` |
| `dashboard/src/plugins/toolRenderers/host.ts` | `dockHandlers` + `createHost` 增加 `sendUserTurn` 转发 |
| `dashboard/src/pages/Chat/index.tsx` | 接线 `sendUserTurn: (text) => wrappedHandleSend(text)`（复用发送语义），接线 effect 移到 `wrappedHandleSend` 定义之后并纳入依赖数组，避免闭包旧状态 |

- 独立补丁文件：`docs/octop-porting/patches/0001-host-sendUserTurn.patch`（3 文件 19 行新增），已用 `git apply --reverse --check` 验证与工作树一致，可脱离主线单独应用/撤销。
- 偏差说明：计划假设在 `index.tsx:535` 原地接线，实际该 effect 声明在 `wrappedHandleSend`（`useCallback`）**之前**，原地引用会触发 TS2448 编译错误——按语义把接线 effect 移到定义之后，行为不变。

### B. OpenDesign 插件（worker B ✅，收尾阶段超时由协调者复核）

`plugins/octop-design/`（ZIP ≈ 31 KB）：

```
plugins/octop-design/
├── plugin.yaml          id: design, kind: tool, icon 🎨, ui.entry: ui/dist/index.js
├── main.py              注册 design_new / design_context / design_update / design_open / design_annotations
├── design_store.py      <workspace>/designs/<slug>/{index.html, meta.json, annotations.json, history/}
│                        rev 单调递增 + sha256 完整性 + expectedRevision 冲突拒绝 + 历史保留 20 份
├── README.md
└── ui/                  vite 构建的自包含 ESM（用 window.__AGENTBUDDY_REACT__）
    ├── src/             index.jsx / DesignCanvas.jsx / iframe.js / api.js / session.js / react.js
    └── dist/            index.js (37.8 KB) + manifest.json
```

- 工作流闭环：`design_context` → `design_update`（expectedRevision），冲突返回 `CONFLICT` + 当前 rev，不覆盖写盘。
- 画板：聊天卡片 ↔ dock 画板（`host.openSidePanel`），iframe `srcdoc` 渲染（无 sandbox，同源注 DOM），悬停高亮 + 点击批注写 `annotations.json`，3 秒轮询 meta.json 的 rev 自动刷新。
- 批注发回：`typeof host.sendUserTurn === "function"` 时直连发送；否则复制到剪贴板提示粘贴（零补丁降级）。
- **workspace 访问调研结论**（写入 `main.py` 注释）：harness 插件工具暴露为裸函数，不持有 `BackendWorkspace`（`plugins/tools.py` 的 `StructuredTool.from_function` 无 workspace 闭包），但工具调用时 `langgraph.config` 的 `configurable.agent_id` 可用；因此采用默认路径 `{AGENTBUDDY_HOME}/agents/<agent_id>/designs/<slug>/`，与 workspace HTTP API 服务的是同一目录（`from_workspace=true` 时 UI 读写一致）。自定义 workspace_dir / 远端 / docker 后端的 agent 不在本轮工具覆盖内——UI 仍走 workspace API（真实工作区），工具侧回退默认路径，差异已在注释中明示。
- 单测：`tests/unit/test_plugin_octop_design_store.py`（11 项，覆盖建/改/冲突/历史滚动/批注消费）。

### C. Office 文档技能插件（worker C ✅）

`plugins/octop-office/`（ZIP ≈ 51 KB）：

```
plugins/octop-office/
├── plugin.yaml          id: office, kind: skill, icon 📄, entry: main.py
├── main.py              ctx.skills("skills")
└── skills/office-docs/
    ├── SKILL.md         触发条件 / 工作流（确认格式受众→JSON spec→生成→读回校验→交付）/ 硬约束 / 反例清单
    ├── references/      spec-xlsx.md / spec-docx.md / spec-pptx.md / pitfalls.md
    └── scripts/         统一契约 --spec <json> --out <path>，stdout JSON
        ├── _theme.py    字体链（微软雅黑→苹方→Noto Sans CJK→DejaVu Sans，缺字体告警不静默）、配色、单位换算
        ├── _office_io.py 入参/输出/校验/默认不覆盖保护（原计划名 _io.py 与 stdlib C 模块冲突，改名）
        ├── make_xlsx.py 多 sheet / 表头 / 列宽 / 冻结 / numfmt / 条件格式 / 折线柱状图 / 公式
        ├── make_docx.py 标题 / 列表 / 表格(合并) / 图片 / 页眉页脚 / 页码域 / 目录占位 / 分页
        ├── make_pptx.py 六种版式 / 主题色 / 备注 / 默认 16:9
        ├── read_office.py docx→md、xlsx→每 sheet md（大表截断提示）、pptx→文字+备注
        └── convert_pdf.py 探测 soffice/libreoffice，缺失返回 {"ok":false,"reason":"libreoffice-missing"}，不伪造
```
- 单测：`tests/unit/plugins/test_office_docs.py`（11 项 golden：生成→python-docx/openpyxl/python-pptx 读回断言结构/内容，含 roundtrip、截断、覆盖保护、PDF 降级、真实 PDF 转换）。

## 3. 验证证据

| 验证项 | 命令 | 结果 |
|---|---|---|
| 后端全量单测 | `uv run pytest tests/unit -q` | **4653 passed, 8 skipped**（含新增 22） |
| 新增插件测试 | `uv run pytest tests/unit/test_plugin_octop_design_store.py tests/unit/plugins/test_office_docs.py -q` | 22 passed |
| 前端类型 | `cd dashboard && npx tsc -b` | 通过 |
| 代码风格 | `uv run ruff check/format --check`（新增目录） | 通过 |
| 补丁可用性 | `git apply --reverse --check docs/octop-porting/patches/0001-host-sendUserTurn.patch` | 工作树 = 补丁内容 |
| ZIP 安装烟测 | `PluginManager.install_archive`（临时 AGENTBUDDY_HOME） | design tool + office skill 均安装成功，技能 `office-docs` 被发现 |
| UI 构建产物 | `plugins/octop-design/ui/dist/index.js`（37.8 KB ESM，引用 `__AGENTBUDDY_REACT__`）| 存在且有效 |
| Office 手工闭环 | xlsx+docx+pptx sample spec → 生成 → `read_office.py` 读回内容一致；docx→PDF 实测成功（41547 B，`%PDF-` 魔数）| 通过 |

## 4. 与 roadmap/计划的偏差

1. React 全局名 `__OCTOP_REACT__` → 实际 `__AGENTBUDDY_REACT__`（文档滞后，以代码为准）。
2. `sendUserTurn` 接线点从 `index.tsx:535` 移至 `wrappedHandleSend` 定义之后（先使用后声明的 TS 限制），语义不变。
3. OpenDesign 工具侧 workspace 访问：插件工具拿不到 `BackendWorkspace`，落到默认路径 `{AGENTBUDDY_HOME}/agents/<agent_id>/`；自定义/远端 workspace 的 agent 工具与 UI 会有路径分歧（已在注释明示，未静默桥接）。
4. `_io.py` → `_office_io.py`（与 stdlib 模块冲突）。
5. OpenDesign P2 中「直接编辑（属性面板）」未做（本轮实现画板渲染、批注闭环、历史+回滚、轮询刷新）；html2canvas 截图、深色模式专项适配未做。
6. 浏览器端完整 E2E（真实起服 + 浏览器点批注）未跑（CLI 环境无浏览器运行时）；已由单测 + 构建产物 + 代码走查覆盖到代码级。

## 5. 遗留事项与建议

- **浏览器 E2E 验收**（建议）：本地 `make dev` 起后端 + dashboard，装 `design-0.1.0.zip`，让 agent 建稿 → 画板批注 → `sendUserTurn` 发回改稿 → 用旧 rev 改触发冲突提示。
- **P2 补全**：属性面板直接编辑、html2canvas 截图可选、深色/320px 适配（dock 已有 bottom 模式）。
- **远端/自定义 workspace 支持**：若需插件工具覆盖自定义 workspace，需要 harness 侧给插件工具注入 workspace（属上游 octop-harness 改动的范畴）。
- **后续挂起项**：IM 深度操作（2–3 人日）、桌面 Computer Use（8–12 人日）仍挂起，可复用本轮沉淀的插件 UI 骨架。

## 6. 本轮改动文件一览（均未提交）

```
M dashboard/src/pages/Chat/index.tsx
M dashboard/src/plugins/toolRenderers/host.ts
M dashboard/src/plugins/toolRenderers/types.ts
A docs/octop-porting/CONDITIONS-NOTES.md
A docs/octop-porting/IMPLEMENTATION-REPORT.md
A docs/octop-porting/patches/0001-host-sendUserTurn.patch
A plugins/octop-design/          （插件本体 + ui/dist 构建产物）
A plugins/octop-office/          （skill 插件本体）
A tests/unit/test_plugin_octop_design_store.py
A tests/unit/plugins/test_office_docs.py
```
## 7. 上线后修复（2026-11-07 第二轮）

1. **画板 iframe 导航逃逸（bug 修复）**：设计稿里的 `<a href>` 点击会真实导航 iframe；srcdoc 继承宿主 base URL，相对链接解析成 Octop 页面本身，且 `srcDoc` 值未变时 React 不会重挂 iframe，刷新无法恢复。
   - `ui/src/iframe.js`：capture 拦截 `a[href]` 点击、表单提交，覆盖 `window.open` 为 no-op。
   - `ui/src/DesignCanvas.jsx`：dock iframe `onLoad` 检测 `location.href !== "about:srcdoc"` 时 `setDocEpoch` 强制重挂恢复；`refresh()` 成功后 bump docEpoch，手动刷新/轮询也一定重新应用 srcdoc。
   - `ui/dist` 已重建（39.4 KB），dev 环境（`AGENTBUDDY_HOME=~/.agentbuddy-review`）已 `--force` 重装到 `~/.agentbuddy-review/plugins/design`。
2. **design_open 卡片减负**：`design_open` 只返回元数据（无 html），UI 侧在卡片模式检测到该工具调用时自动 `openSidePanel` 打开画板（`autoOpened` ref 防重复），不再需要手动点第二张卡片。聊天中仍保留两次工具调用的卡片记录（宿主聊天记录机制，插件无法合并）。

## 8. 多页面稿件导航语义修正（2026-11-07 第三轮）

用户反馈设计稿本身是多 UI 页面可切换的（真实稿件：单 HTML 内 13+ 屏 `section.screen`，`data-go` + JS 切换），全面拦截 `<a>` 会误伤锚点切页。参考本地 `/Users/huangke/source2026/open-design`（上游 OpenDesign）的 `injectSandboxShim` 语义重做：

| 链接形态 | 处理 |
|---|---|
| `href="#s2"` / `href="#"` / `href=""` | 拦截默认导航，`scrollIntoView` + 手动更新 `location.hash`（设计稿的 hashchange 切屏正常工作） |
| JS 切屏（`data-go` / `onclick` / `location.hash=`） | 不干预，照常工作 |
| `http(s)://` / `mailto:` 外链 | `window.open(..., "_blank")` 新标签打开，不污染画板 |
| 相对路径（`page2.html` 等） | 拦截（srcdoc 无合法 base，否则加载宿主页面） |
| 表单提交 | 拦截 |
| JS 强制整页导航（`location.href="/"`） | iframe `onLoad` 检测逃逸强制重挂恢复；`about:srcdoc#hash` 不误判 |

上游参考结论：OpenDesign 用 `sandbox` iframe + postMessage 桥（无 allow-same-origin，宿主读不到 contentDocument）；本插件按 roadmap 采用 srcdoc 同源直注入（支持 DOM 级批注），因此自行实现等价的导航 shim。UI 已重建（39.9 KB）并 `--force` 重装到 `~/.agentbuddy-review/plugins/design`。

## 9. 侧边栏报错修复（2026-11-07 第四轮）

**现象**：dock 画板打开时 toast「读取稿件失败：setTitle is not defined」。
**根因**：`title` 是 `payload` 派生的 `const`（`DesignCanvas.jsx:64`），但 dock 的 `refresh()` 里调用了 `setTitle(...)`。卡片模式不走 `refresh()` 所以不报，侧边栏（dock）的 `initialRefresh` 一执行就抛 `ReferenceError`。
**修复**：`title` 改为 `useState`（初始值 `payload.title || slug || "Design"`），并加 `useEffect` 在 `payload.title` 变化时同步；`refresh()` 读回 `meta.json` 后可正常更新标题。
**验证**：`vite build` 通过、`node --check` 通过、已 `--force` 重装到 `~/.agentbuddy-review/plugins/design`，dist 40.1 KB。**

## 10. P2 能力补齐（2026-11-07 第五轮）

用户要求补齐与 Cindy/上游 OpenDesign 的差距，四个能力全部落地（`plugins/octop-design/ui/`，dist 68.4 KB，已 `--force` 重装）：

### 10.1 预览缩放 + 自动适应 + 设备切换
- 工具栏新增：`👁 预览 / </> 代码` 切换、设备下拉（桌面端 / 平板 820 / 手机 390）、缩放控件（`− / 百分比 / + / 适应`）。
- 实现：`ResizeObserver` 跟踪画板容器，`contentDocument.scrollWidth/scrollHeight` 读取稿件自然尺寸；`frameW = 设备宽 || max(内容宽, 容器宽)`，`scale = min(1, 容器宽/frameW, 容器高/frameH)`（auto）或手动百分比；iframe 以 `transform: scale()` 缩放、外层 wrapper 占位保证滚动正确。
- 效果：1920×1080 多屏稿件在窄画板里自动缩小到完整可见；响应式稿件桌面端保持 1:1。

### 10.2 预览/代码切换 + 导出 HTML
- 代码视图显示完整 `index.html` 源码（等宽、可滚动），带「复制源码」「下载 HTML」；工具栏「⬇ 导出」直接下载 `<slug>.html`。

### 10.3 截图（独立 + 随批注）
- 新增 `ui/src/screenshot.js`：克隆同源 iframe 文档 → 清理宿主 overlay / 非法 XML 属性 → `SVG <foreignObject>` → canvas → PNG dataURL（对齐上游 snapshot bridge 思路，简化版）。
- 工具栏「📷 截图」：上传到 `designs/<slug>/captures/capture-<ts>.png`（先 mkdir），toast 显示路径。
- 批注表单新增「附带当前稿件截图」开关：截图存 `captures/note-<ts>.png`，并把相对路径写进 annotation 的 `screenshot` 字段。

### 10.4 手动编辑属性面板
- 工具栏「✏️ 编辑」（与批注模式互斥）→ 点击元素选中 → 右侧「编辑」tab：文本（含子元素时禁用）、字号、文字颜色、背景色、内边距、外边距、对齐、圆角；修改即时写回 iframe DOM（inline style）。
- 保存：序列化 `documentElement.outerHTML`（剔除宿主 overlay）→ `saveDesignHtml()` 镜像 `design_store` 规则（快照旧版到 `history/v<rev:04d>.html` → 写 `index.html` → `rev+1` + sha256 → 写 `meta.json`）；磁盘 rev 已变时返回冲突，弹出与 agent 侧一致的冲突提示且不写盘。
- `api.js` 新增：`wsMkdir` / `wsUploadBlob` / `saveDesignHtml` / `downloadTextFile` / `sha256Hex`。
