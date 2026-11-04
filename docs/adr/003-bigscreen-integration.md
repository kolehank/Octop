# ADR 003 — 大屏（Big Screen）集成方案

**Status:** Accepted
**Date:** 2026-11-02

---

## Context

需要把「专家对话」能力做成大屏界面，集成到业务大屏系统中（首个示例：综合运行 demo 大屏）。大屏后续会有多块专题子屏，展示不同的业务场景数据（指标、部门、业务系统、预警等）。界面以 demo 工程提供；middle 区块为专家对话区。

核心诉求：

1. 大屏页面与前者 Octop 服务**同源**，消除跨域问题，并共享 Dashboard 登录态。
2. 多块专题子屏可扩展；除智能体外的各区域内容（指标/系统/区块/预警）以**配置文件**驱动，改内容不修改界面代码。
3. 智能体组织避免"每专题配一个专家"：优先**一个主专家 + 多个子智能体**。
4. 能力开关（连接器/知识库/技能/子智能体）由大屏配置文件控制，领导改配置即可。

## Decisions

### D1 大屏作为 Octop 仓库内的独立工程

- 源码目录：`bigscreen/`（独立 Vite + React 工程，目录见「架构」节）。
- 构建产物：`src/octop/bigscreen/`，加入 `.gitignore`（镜像 `src/octop/dashboard` 策略）。
- 由 FastAPI 挂载静态路由 `/screen/{path}`（含 SPA fallback），URL 根为 `/screen/demo/`。
- 理由：同源后无 CORS；`localStorage["auth_token"]`（`dashboard/src/api/request.ts:5`）可直接复用；大屏设计语言独立，不并入 Dashboard 的 layout/i18n 壳。
- 影响：`app.py` 需在 `/` catch-all 之前注册 `/screen` 路由；`/screen/*` 静态页**不加** JWT（JWT 中间件只拦 `/api/*`，`api/middleware/jwt_auth.py:44`），聊天能力本身受 token 保护。

### D2 技术栈与页面形态

- React 18 + Vite + React Router：单页内切换专题子屏（`/screen/demo/economic`、`/screen/demo/project`…），带过渡动画；加专题 = 加一个目录 + 路由，复用同一套渲染模板。
- 聊天区是唯一真实功能；其余区域全部配置驱动（见 D8/D9）。
- 文案：大屏自身 UI 文案纯中文、随大屏工程管理，不走 Dashboard i18n；后端返回的错误信息已由 Octop 按 locale 本地化，直接展示。

### D3 认证：同源共享登录态 + 页内轻量登录浮层

- 页面加载读 `localStorage["auth_token"]`；缺失或任一 API 返回 401 时，弹出轻量登录浮层（用户名/密码 → `POST /api/auth/login`，`api/routers/auth.py:170`），成功后写回同一 key。
- 大屏自己的 fetch 处理滑动续期响应头（`ACCESS_TOKEN_RESPONSE_HEADER`，见 `dashboard/src/api/request.ts:103`），写回 `auth_token`。
- 预留验证码（captcha）处理：部署开启验证码时，浮层需接 `GET /api/auth/captcha` + captcha_token。
- 会话用户：用户以各自 Octop 账号登录大屏；**公共的是专家（agent），不是登录账号**——所有人共用同一个公共主专家（在 Octop 管理端配置），各自会话按 `user_id` 隔离（见 ADR 004 D1）。多屏并发 = 多用户同时使用同一专家，会话天然互不干扰。若有无人值守投屏（无人登录）场景，需为投屏机配置固定登录账号，多台投屏共用同一账号时接受 last-write-wins（ADR 004 D12）；该场景与账号清单属 open input。

### D4 智能体组织：一个主专家 + 多子智能体，按专题自动路由

- 主专家（如「演示助手」）经 Octop 管理端安装多个子智能体（workspace `agents/**/*.md`，加载为 deepagents SubAgent，见 `packages/octop-harness/src/octop_harness/subagents/loader.py`、`agent.py:1797`）。
- 每个专题配置绑定一个子智能体 slug；大屏发送消息时**自动在文本前拼 `@子智能体名`**（`expertMention.ts` 同一 wire 语法），由模型调用 `task` 工具委派。
- 路由失败（模型未委派）→ **由主专家直接处理**，不额外展示"当前子智能体"。
- 提升路由可靠性的配置项：主专家 persona（SOUL）中写清各子智能体分工边界。

### D5 工具审批：大屏默认不审批、直接放行；敏感工具双层规避

- 每次 `user_turn` 携带线程级 `hitl_policy: { mode: "allow_all" }`（线程级 bypass，不改全局 HITL；`api/routers/chat/models.py:60-62`）。
- 兜底：若仍收到 `hitl_required` 帧（说明存在强制审批项），大屏自动调用 resume 接口放行，避免对话挂起。
- 敏感工具规避（双层）：① Octop 管理端在专家配置层禁用敏感工具；② 大屏 `chat_options` 不启用敏感技能/连接器/知识库（见 D7）。此粒度为主方案；`allow_tools`（白名单放行）记为备选。

### D6 能力开关配置化（硬控制）

- `ChatTurnBody`（`api/routers/chat/models.py:23-84`）与 WS 帧原生支持 `skills` / `mcp_servers` / `knowledge_base_ids` / `conversation_mode`；大屏发送时从专题配置组装进 WS `user_turn` payload。
- 语义：省略字段 = 沿用专家默认配置；空数组 = 关闭默认（`skills: []` 全禁用、`mcp_servers: []` 关默认连接器、`knowledge_base_ids: []` 关默认知识库）。
- **边界**：大屏配置在"专家已装能力"集合内生效，不替代 Octop 管理端的专家配置；领导可决定展示哪项/启用哪项，但不能凭空启用专家未安装的能力。

### D7 内容数据：文件化 + dataProvider 抽象

- 各专题内容（指标数字、预警条、系统卡片、部门表等）与专题配置均存放于 `bigscreen/public/data/demo/`（`topics/*.json` + `data/*.json`），Vite 构建时原样拷贝进产物，前端运行时 fetch 并按类型校验（坏数据报错不白屏）。
- 专题配置也数据化：`topics.json` 列出专题，`topics/<id>.json` 声明布局、数据引用（支持 `{view}` 视角占位与 `:regionId` 下钻参数）、聊天配置；`{view}` 数据文件缺失时自动回退到 `overview` 视图。
- 取数统一收口为 `dataProvider` 接口；接入真实系统时只替换这一层，界面代码不动。
- **底线**：渲染 = 通用渲染器，内容 = JSON；界面代码中不得出现业务数字/系统名/预警文案。

### D8 布局（配置驱动）

- 整体布局：左（指标）/ 中（专家对话）/ 右（业务系统：业务系统组，两个 tab 切换）/ 中列下方（概览区块 ↔ 部门 tab 切换，含预警条，可收起放大智能体区）。
- **筛选维度（区块 / 部门）**：左下筛选区支持多个维度分组（区块、部门两组），顶部 tab 切换维度，两个维度都可点击下钻；下钻路由统一为 `/screen/demo/<topic>/<dimension>/<itemId>`（如 `/demo/overview/region/south`、`/demo/overview/category/service`），下钻页按 `dimension` 选择对应布局与上下文。
- 通用渲染器固定支持的板块类型（首版）：
  - `chat`：智能体对话（主屏布局）；二/三级页面的浮层形态见 D10；
  - `view-nav`：屏内视角切换（如招商屏「总览 / 一把手外出招商 / 在谈项目 / 落地项目 / 土地出让面积」），**整屏数据联动**——左侧指标、下方数据卡、右下分析按所选视角换数据，AI 对话区不切换；后续若要"只切局部"或"连对话也切换"，调整配置层级即可，不改架构；
  - `region-list`：区块/部门筛选区，支持 `dimensions` 多维度分组（tab 切换），点击条目下钻（见下）；
  - `metric-cards`：指标/数据卡组（如本月新增在谈、落地项目）；
  - `alert-cards`：预警卡组（长时间未落地、未开工项目预警等）；
  - `ticker`：滚动播报条；
  - `system-links`：业务系统入口卡片组（业务系统组可切换）；
  - `analysis-card`：分析/图表占位卡（开工率、纳统率、行业在谈与落地项目分析等；后续接真实图表时只替换此组件）。
- 下钻：区块/部门筛选区点击 → 下钻页，路由与布局由 `drilldown` 配置声明（如 `/screen/demo/overview/region/:id`），下钻页复用同一套渲染器与浮层智能体。
- 每块专题一个 `topic.json`：声明各板块类型、数据文件引用、聊天配置（`chat`：子智能体 slug、推荐问题、`chat_options`）、`drilldown` 声明。
- 加专题、调整展示内容 = 改 JSON；出现新板块类型才改 React 代码。

### D9 聊天区功能裁剪

- 仅保留：输入框、流式回复、停止、推荐问题（来自专题配置；欢迎语用 `GET /agents/{id}/chat/welcome`）。
- 对话模式/模型/连接器/知识库/技能/子智能体菜单**不进大屏**（由 D6 配置与专家默认控制）。
- 会话：每个专题独立 thread，打开时恢复该专题最近线程（参照 `dashboard/src/hooks/useAgentThreadChat.ts` 的列表→选最近/新建→rebind 流程）。

### D10 悬浮智能体（float chat）

> **会话范围已由 [ADR 004](004-bigscreen-session-model.md) 取代**：不再「同一专题共享一个 thread」，改为按「屏类型（路由模板）」建立会话；同一屏内的大对话框与浮层共享该屏会话，跨屏独立。「同一专题共享」相关表述不再生效。

- **形态**：壳层（Layout）全局组件，二级/三级展示页面可配置启用。收起态为小胶囊（如「演示助手 / 循证问答·报告生成 / 对话」）；展开为浮层（上下文标识 + 欢迎语 + 快捷问题 + 输入框 + 流式回答 + 停止 + 生成报告），覆盖在当前页之上。
- **专家**：与主屏**同一个主专家**；「演示助手」仅为展示名，不引入新专家。专题路由仍按 D4 的 `@子智能体` 机制。
- **复用**：与主屏聊天区共用同一套 headless 聊天核心（线程引导、WS、流式渲染、停止、HITL 自动放行、错误处理）。主屏大聊天区与浮层**不同屏共存**——同一页面只允许一个活动聊天实例，避免同一 thread 双 WS 冲突。
- **线程策略**：同一专题共享一个 thread（主屏与浮层延续上下文），跨专题独立；thread_id 按浏览器本地记录（公共账号下多终端互不干扰）。
- **上下文注入（S2 弱注入）**：
  - 每条消息前注入一行**页面导航**：`〔当前页：<专题>/<视角>（仅供参考，以用户问题为准）〕`；
  - **不注入筛选条件、不注入数据摘要**——避免"站在 A 区块问 B 区块"被锚定；
  - 页面配置 `contextInjection: "nav" | "off"` 可关闭；前缀在 UI 展示时剥离，保持对话干净（服务端历史会保留前缀，可接受）；
  - 快捷问题的问题模板自带上下文语义（如「关于招商专题在谈项目：分析原因…」），不依赖前缀；
  - 后续若需要结构化上下文（不污染历史、可强约束），单独立项为 Octop 增加字段，本期不做。
- **简化边界**：不展示工具调用过程面板、能力菜单（模型/连接器/知识库/技能）；只显示当前会话最近 N 条；「生成报告」= 作为用户消息发送（由专家技能处理）。
- **启用方式**：下钻页配置 `drilldown[].floatChat.enabled: true` 时，页面中间不再渲染大聊天区，改为右下角胶囊/浮层；未启用则保持中间大聊天区。
- **上下文卡**（截图中的「本期原因归因 / 数据范围 / 文稿依据」）为当前模块数据（mock JSON），展示在浮层顶部；聊天时只注入页面导航（专题/视角），不注入摘要。

### D11 构建 / CI / 发布

- `make all` 增加大屏 `typecheck` + `lint` + `build`（独立 npm 工程，依赖 `npm install`），随 pre-commit 执行。
- 大屏产物 `src/octop/bigscreen/` 随 wheel 打包发布（与 `src/octop/dashboard` 一致），保证部署到其他机器有页面。
- 大屏静态挂载需配套测试（`/screen/demo/` 200、未知资源 404）。

## 架构

```
Octop/
  bigscreen/                          # 大屏前端源码（独立 Vite + React 工程）
    src/
      lib/                            # 共享层：login/token 续期、thread 引导、WS 客户端、
                                      #   流式渲染、dataProvider、通用面板渲染器、
                                      #   headless chat core、浮层智能体组件（FloatChat）
      screens/
        demo/
          App.tsx                     # 大屏壳 + 路由 /screen/demo/:topic
  bigscreen/public/data/demo/          # 专题配置 + mock 数据（运行时 fetch，构建时拷贝）
    topics.json
    topics/<id>.json                  # 每专题：布局声明 + 数据引用 + chat 配置 + drilldown
    data/...                          # 各专题/视角/下钻页的 mock 数据 JSON
  src/octop/bigscreen/                # 构建产物（gitignore）
  src/octop/api/app.py                # 新增 /screen/{path} 静态挂载（SPA fallback）
  Makefile                            # build-bigscreen / typecheck-bigscreen / lint-bigscreen
```

聊天管道（与 Dashboard 同协议）：

```
页面启动 → 读/取 token（含登录浮层）
        → GET /agents/{id}/chat/welcome（欢迎语）
        → GET /agents/{id}/threads → 复用最近 or 新建 → PATCH /agents/{id}/session rebind
        → GET /agents/{id}/threads/{tid}/history（可选恢复历史）
发送     → WS /api/agents/{id}/chat/ws?token=…（wsChat.ts:3）
          user_turn: {text: "@subagent 提问", thread_id, hitl_policy: {mode:"allow_all"},
                      skills/mcp_servers/knowledge_base_ids/conversation_mode（来自 topic config）}
          ← token/text/tool/done 帧流式渲染；cancel 帧停止；hitl_required 自动放行
```

## Implementation checklist（后续按此实施）

1. **骨架**：`bigscreen/` Vite + React + Router 工程；`src/octop/bigscreen/` 产物目录 + gitignore；Makefile 目标并纳入 `make all`；`app.py` 挂 `/screen`（SPA fallback）+ 配套测试；AGENTS.md 补 bigscreen 章节；Vite dev proxy 指向本地 Octop（`/api`、WS）供联调。
2. **数据/配置体系**：板块类型 schema + 运行时校验（坏 JSON 报错不白屏）+ `dataProvider` + `topic.json` / `drilldown` 配置模型。
3. **板块渲染器 + demo 主屏**：8 类板块（`chat` / `view-nav` / `region-list` / `metric-cards` / `alert-cards` / `ticker` / `system-links` / `analysis-card`）；原型视觉移植为 React 版；主屏 + 专题路由 + 下钻页。
4. **聊天管道**：headless chat core（token → welcome → thread 引导 → WS 收发/流式/停止 → 错误处理 → HITL 自动放行）。
5. **浮层智能体（D10）**：胶囊/浮层组件、S2 弱注入（`contextInjection: "nav" | "off"`）、前缀展示剥离、与主屏共享线程。
6. **登录浮层**（含滑动续期、captcha 预留）。
7. **分辨率适配**：按 1920×1080 设计稿等比缩放，适配不同投屏尺寸。
8. **mock 数据填充**（业务输入）。
9. **验证**：`make all` 绿 + 手动过一遍登录/聊天/专题切换/下钻/浮层；`/api/docs` 无影响。

## Dependencies & open inputs（实施期需业务侧提供）

- 主专家 + 子智能体清单（业务侧在 Octop 管理端安装；大屏配置引用其 slug）。
- 专题清单、每专题 mock 数据内容（指标数字、系统名、预警文案、部门列表）。
- 敏感工具清单（Octop 管理端专家配置层禁用哪些工具/技能）。
- 大屏登录账号体系：默认用户各自账号（会话按 `user_id` 隔离）；若存在无人值守投屏（无人登录），需固定账号（用户名/密码；首次通过登录浮层登录后复用 token）。
- 真实数据系统接入时机（后续迭代，替换 `dataProvider`）。
- **运行环境确认**（默认值见括号，若有差异需提前告知）：设计稿 1920×1080 16:9 等比缩放（默认）；现代 Chrome 内核浏览器（若目标机器为旧内核/IE 兼容模式，需调整 Vite 构建目标与 polyfill，影响技术选型）。