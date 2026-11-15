# Cindy → Octop 移植路线图

> 基于 `C:\Users\Administrator\Documents\code\Octop`（develop 分支，`6918a059`）与 Cindy 当前已装插件盘点。
> 本轮范围：**OpenDesign 移植 + Office 文档技能**。IM 深度操作、桌面 Computer Use 明确挂起。

## 0. 判定基线

Octop 已内建、无需移植的能力（已核对代码）：

| 能力 | 证据 |
|---|---|
| 7 个搜索源 + `web_fetch` | `src/octop/infra/agents/settings/tool_catalog.py:22-34,64-71` |
| Mermaid 渲染（含语法校验、流式降级） | `dashboard/src/components/Markdown/index.tsx:314-332` |
| 浏览器自动化 | `packages/octop-browser`、`browser_use` |
| 图片 / 视频生成 | `generate_image`、`generate_video` |
| 记忆、cron、知识库 RAG | `memory_*`、`cronjob_*`、`search_knowledge` |
| 手机端控制 | `mobile_screenshot/tap/swipe/launch_app/ui_dump` |
| agent 团队 | `agent_list`、`ask_agent` |
| IM 通道 | 飞书/企微/钉钉 bot creator（`api/routers/channels.py`） |
| 办公文档库 | `python-docx`、`python-pptx`、`openpyxl`、`xlrd`、`pypdf`（`pyproject.toml:41-48`） |

**结论：Cindy 已装的 3 个插件里，只有 OpenDesign 不可替代。**

## 1. 范围与优先级

| # | 能力 | 状态 | 形态 | 预估 |
|---|---|---|---|---|
| 1 | OpenDesign（稿件画板 + 元素批注 + revision） | **本轮做** | `tool` 插件 + 插件 UI + 1 处核心补丁 | 7–11 人日 |
| 2 | Office 文档（docx / pptx / xlsx / 读取改写） | **本轮做** | `skill` 插件（SKILL.md + 脚本） | 5–8 人日 |
| 3 | IM 深度操作（飞书卡片/文件/撤回/置顶/群历史） | 挂起 | `tool` 插件 | 2–3 人日（后续） |
| 4 | 桌面 Computer Use（点击/输入/窗口） | 挂起 | `tool` 插件 + UI 卡片 | 8–12 人日（后续） |

排序理由：

- **OpenDesign 先做**：它是唯一"宿主 UI 依赖型"能力，风险最高，越早验证越好；同时它会给后面的插件 UI 沉淀一套可复用的画板/面板骨架。
- **Office 次之**：纯脚本 + 文档，几乎零风险，收益面最广（几乎所有自托管办公场景都会用到）；且不依赖 OpenDesign 的任何产出。
- **IM / Computer Use 挂起**：价值高但不是当前主线；IM 成本低，等 OpenDesign 的 UI 骨架和发布流程跑顺后顺手做；Computer Use 需要独立的安全沙箱设计，不适合夹在中间。

## 2. 交付节奏

```text
M1  插件骨架 + 稿件 CRUD + 画板显示        ← OpenDesign P0
M2  元素批注闭环 + sendUserTurn 补丁        ← OpenDesign P1
M3  直接编辑 / 截图 / 历史 / 移动端打磨     ← OpenDesign P2
M4  Office 技能：xlsx + docx 基础           ← Office O0
M5  Office 技能：pptx + 模板 + 图表         ← Office O1
M6  Office 技能：读取改写 + PDF 导出        ← Office O2
```

M1–M3 与 M4–M6 之间**没有依赖**，可以并行；单人串行约 12–19 人日。

## 3. 共同约束

- 插件包 ZIP ≤ 100 MiB，解压后 ≤ 64 MiB；**安装不跑 `npm install`**，UI 必须是构建好的自包含 ESM（`docs/plugin-package.md:31`）。
- 插件 UI 不能 import 应用模块，只能用 `host` 暴露的方法 + `window.__OCTOP_REACT__`（`dashboard/src/plugins/toolRenderers/loader.ts:27-50`）。
- 插件安装目录 `~/.octop/plugins/<id>/`，id 即目录名。
- 发布方式：ZIP 走 Admin → Plugins → Install，或 `octop plugin install ./xxx.zip`。

## 4. 核心补丁清单

| 补丁 | 位置 | 行数 | 是否必需 |
|---|---|---|---|
| `sendUserTurn(text)` 暴露给插件 host | `toolRenderers/types.ts`、`host.ts`、`pages/Chat/index.tsx:535` | ~15 | 必需（OpenDesign P1） |
| 工作区文件 inline 预览路由 | 新增 `GET /workspace/raw` 或给 download 加 `inline=1` | ~20 | 可选（要独立分享链接时） |

两个补丁都是纯新增、向后兼容，适合往上游客提 PR。补丁单独出 `.patch` 文件，不改主线代码直到评审通过。

## 5. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 插件 ESM 取二进制/文本文件的鉴权方式 | 画板读不到稿件 | 已确认 `auth_token` 在 localStorage；`host.request` 不通时直接 `fetch` + Bearer |
| 稿件里的内联脚本被 CSP 拦截 | 交互稿失效 | 已确认应用无全局 CSP，仅 media preview 有 `sandbox` |
| dock tab 绑定 callId，换轮次开新 tab | 画板不常驻 | P2 做"同 slug 收敛到同一 tab + 轮询刷新" |
| 移动端 dock 收起 | 批注体验差 | dock 已有 bottom 模式；P2 专门适配 |
| Office 中文字体缺失 | 文档排版崩 | 脚本内置字体回退链，优先系统字体，缺字体时用内置替代并提示 |
| PDF 导出依赖 LibreOffice | 导出失败 | 启动时探测 `soffice`，缺失则降级为 docx + 提示 |

## 6. 验收标准（整体）

- 两个插件都能用 ZIP 安装、重启后仍生效。
- OpenDesign：agent 建稿 → 画板打开 → 标注元素 → 点一次 → agent 收到批注并改稿 → revision 冲突能正确阻挡。
- Office：一句话生成一份可正常打开的 xlsx 和 docx；能读回并改写已有文件；生成物不损坏。
- 核心补丁：单独 patch 文件，`git apply` 后可编译，撤销后其余功能不受影响。
