# ADR 004 — 大屏会话模型（按屏隔离 + 历史恢复 + 新建会话）

**Status:** Accepted
**Date:** 2026-11-02
**Supersedes:** ADR 003 D10 中「同一专题共享一个 thread」的会话范围部分（其余浮层形态与交互保持不变）

---

## Context

大屏（`bigscreen/`）将面向**多部门、多用户**使用，内置专家为所有用户提供服务。当前实现存在三个问题：

1. **会话范围不一致**：`ensureThread`（`bigscreen/src/lib/chatClient.ts:39-74`）的回退顺序是「localStorage → agent 的 active 线程 → 线程列表第一条 → 新建」，首次进入新专题会复用 dashboard 或其它专题的会话，与 ADR 003 D10「跨专题独立」不符。
2. **历史不恢复**：`useScreenChat`（`bigscreen/src/hooks/useScreenChat.ts`）只维护本次进入页面后的本地消息，从不调用历史接口；刷新或重进页面消息为空，「会话保留」用户感知不到。
3. **无新建入口**：大屏没有「新建会话」按钮，也没有历史会话列表。

本 ADR 定义大屏的会话模型、screenKey 规范、接口契约与呈现方式。**本期不做会话分组**（延后）。

## Decisions

### D1 会话模型

`用户 × 专家 × screenKey → 一条 session → 一个当前 thread`。

- 一条 session 同一时刻只绑定一个 thread（当前会话）；同一 session 下创建过的历史 thread 全部保留。
- 会话归属按 `user_id` 隔离；多用户天然互不可见。
- 多用户共用同一公共专家（见 ADR 003 D3）时并发安全：`user_id` 是 session key 的组成部分，同一专家上不同用户的 screen 会话互不干扰；多屏并发 = 多用户并发，无共享可变状态。
- 新建会话 = 在同一 session 下新建 thread 并改绑定，而不是清空/删除旧 thread。

### D2 screenKey = 屏类型（路由模板）

screenKey 使用**规范化路由模板**，不含具体条目 id：

| 路由 | screenKey |
|------|-----------|
| `/screen/demo/` | `demo/overview` |
| `/screen/demo/:topic` | `demo/:topic` |
| `/screen/demo/:topic/:dimension/:itemId` | `demo/:topic/:dimension` |

- 同一屏内的视角（`view`）、筛选、滚动位置等客户端状态**不进 key**。
- 下钻页的具体条目（区块/部门 id）默认不进 key，由 S2 页面上下文注入（`〔当前页：…〕`）承担语义；若未来某类详情页需要按条目隔离，在路由配置中显式声明，不改变本 ADR 的默认规则。
- 未来新增屏必须在路由配置中声明 screenKey；**禁止**用完整 URL、带 query 的地址或主机名作为 key。
- **screenKey 合法格式（服务端强制校验，所有接口统一）**：
  - 字符集 `[A-Za-z0-9_/-]`；**禁止** `:`（session key 以 `:` 分段拼接与解析，见 `ThreadRegistry.make_key`）、`%`/`_`（`scope`/`q` 走 SQL `LIKE`）、空白、中文标点；
  - 长度 `1 ≤ len ≤ 120`；
  - 本期保留前缀 `demo/`，合法形态为 `demo/overview`、`demo/<topic>`、`demo/<topic>/<dimension>`（≤3 段）；新工程级前缀须在路由配置注册；
  - 服务端对非法格式返回 400；服务端不推导/改写 screenKey，规范化由大屏 `screenKeyFor(pathname)` 负责。
- **`scope=topic` / `q` 的 LIKE 转义与定界**：检索值与 `%`/`_` 均按 `ESCAPE '\'` 转义（SQLite/PostgreSQL 通用）；`scope=topic` 前缀定界为 `screen:demo/<topic>` 或 `screen:demo/<topic>/`，避免 `demo/investment` 误匹配 `demo/investmentx`。

### D3 服务端存储：复用 `sessions` + `threads`，无迁移

- session key 通过现有 `ThreadRegistry.make_key(agent_id, channel_type, channel_subject_id, channel_chat_type)` 生成：

  ```
  <agent_id>:dashboard:<user_id>:screen:<screenKey>
  ```

- `channel_type` **复用 `dashboard`**：
  - `is_virtual_channel()` 已覆盖 dashboard，不会产生 IM 外发；
  - 新增 `bigscreen` channel_type 需审计 `cron/delivery.py`、`gateway.py`、`backup/snapshot.py`、`slash/catalog.py`、`ws/ws_channel.py`、`process/message_keys.py` 等多处 `channel_type == CHANNEL_DASHBOARD` 判断，风险大、收益小。
- `sessions` 表记录 `session_key → 当前 thread_id`；`threads.session_key` 记录创建时的 screen key，历史列表直接用 `ThreadRepo.list_by_session()`。
- **不需要新表，也不需要数据库迁移**（当前 schema 版本保持 24）。

### D4 页面生命周期

```
进入页面 → 由路由计算 screenKey
  → GET  /api/agents/{id}/screen-session?screen=<screenKey>
       ├─ 已绑定 → GET /threads/{tid}/history → 渲染历史
       └─ 未绑定 → POST /threads {screen_key} → 绑定 → 空会话（欢迎语/推荐问题）
```

- 同一屏内切换视角/筛选不重新绑定。
- 绑定 thread 已删除或不属于当前用户（404/403）→ 丢弃绑定并按未绑定路径重建。
- 401 → 走现有登录浮层（`LoginOverlay`）。

### D5 新建会话

- `POST /api/agents/{id}/threads {screen_key}` → `ThreadRegistry.reset()` 在同一 session key 下新建 thread 并改绑定。
- 前端：更新 threadId → 清空消息 → 显示欢迎语/推荐问题。
- 流式输出进行中时**禁用**新建与切换（先停止再操作）。

### D6 切换历史会话

- `PATCH /api/agents/{id}/session {thread_id, screen_key}` → `ThreadRegistry.rebind()`。
- 服务端校验 thread 属于当前用户与当前 agent（复用 `_require_thread`）。
- 前端随后拉取该 thread 历史并渲染。

### D7 历史会话列表数据

- `GET /api/agents/{id}/threads?screen_key=&scope=&q=&limit=&offset=`：
  - `scope=screen`：精确匹配当前屏的 session_key；
  - `scope=topic`：按 `demo/<topic>` 前缀匹配本专题所有屏；
  - `scope=all`：该用户在该专家下的全部 `screen:` 会话；
  - `q`：v1 匹配 **标题 + 首条用户问题**（SQL `LIKE`，SQLite/PostgreSQL 通用），通配符按 D2 转义；「首条用户问题」取该 thread 历史首条 user 文本。限制：按 session 过滤后的行内逐条取首条（每行一次小查询，行数由分页控制），避免全表扫描。
- 响应行复用现有字段：`session_key`、`title`、`last_active`、`pinned`、`is_active`、`has_messages`，新增 `summary`（首问摘要：历史首条 user 文本、服务端剥离 S2 前缀，无消息时为 `null`；`title` 为空时前端展示 `summary`）。
- **`is_active` 语义**：按本列表 `scope` 对应的 session 绑定判断——`scope=screen` 对应当前屏 session；`scope=topic`/`all` 按每条 thread 自身 `session_key` 的绑定（一条 session 至多一个 active thread）。不再固定参照 dashboard session 的绑定。
- 排序：`pinned DESC`，然后 `last_active/created_at DESC`。
- 分页：默认 `limit=30`，支持 `offset`；接口预留 `q`，全文检索后续单独做。

### D8 历史列表呈现

- **大对话框**：聊天面板标题栏加「历史」入口 → 右侧滑出抽屉（覆盖聊天列，不改变大屏布局）。
  - 顶部：搜索框 + 「新建会话」主按钮；
  - tab：`当前屏 / 本专题 / 全部`，默认 **当前屏**；
  - 列表：按时间分组（今天 / 昨天 / 更早），行内显示标题（无标题时用 `summary`）、时间、预览、当前会话标记（依据 D7 的 `is_active`）；
  - hover 操作：置顶（复用 `PATCH /threads/{id} {pinned}`）、重命名；
  - 空状态：「还没有历史会话」+ 新建按钮；搜索无结果单独提示。
- **小图标（浮层）**：浮层头部加「历史」入口 → 浮层原地切换为列表视图（带返回按钮），交互与抽屉一致，布局更紧凑。
- 时间显示统一使用服务端时区（`GET /api/settings/timezone`），不使用浏览器本地时区。

### D9 历史消息渲染

- 大屏历史列表和消息区域**只渲染 user / assistant 的文本**；工具调用（tool_use/tool_result）与思考过程（thinking）不展示，与当前大屏实时对话的呈现一致。
- S2 页面前缀 `〔当前页：…〕` 在 UI 展示时剥离，保持对话干净。
- 服务端生成 thread 标题时剥离该前缀（`_touch_thread_after_turn` → `set_title_if_null`，正则只匹配固定格式 `〔当前页：…（仅供参考，以用户问题为准）〕`），dashboard 会话标题同样受益；D7 的 `summary` 在服务端同样剥离。
- 历史消息默认加载最近 30 条，向上滚动「加载更多」（复用 history 接口的 `limit/offset/has_more`）。

### D10 dashboard 过滤

- dashboard 会话列表（`GET /threads`）默认使用 `scope=dashboard`，排除 `screen:` 会话。
- 大屏使用 `scope=screen|topic`，只看到自己的屏会话。
- v1 **不提供** dashboard 展示大屏会话的开关。

### D11 多用户与存储

- 正确性以服务端为准：所有查询按 `user_id` 过滤，thread 访问校验归属。
- 大屏 localStorage 只用于 UI 偏好缓存，**不再作为会话绑定的正确性来源**；同一浏览器换账号不会串会话。
- 大屏登录浮层与 token 续期复用现有实现。

### D12 边界情况

- thread 被其它端删除 → `screen-session` 返回 null → 自动新建。
- 同一用户在同一屏开多个浏览器标签页：共享同一 session，后写入的绑定生效（last-write-wins），可接受。
- 改动前创建的旧大屏会话（均为 `dashboard:dm`）**不迁移**，不会出现在大屏历史列表；dashboard 侧仍可见。
- 会话分页边界（长 turn 跨页）由现有 history 分页逻辑处理，本次不改。

### D13 本期不做

- 会话分组 / 标签 / 文件夹；
- 跨专题连续会话；
- 全文检索（预留 `q`，后续可上 FTS5 / tsvector）；
- 大屏删除会话；
- dashboard 显示大屏会话的开关。

## 接口契约

```
GET   /api/agents/{agent_id}/screen-session?screen=<screenKey>
  200 → { "session_key": "...", "thread_id": "thr_..." | null }

POST  /api/agents/{agent_id}/threads
  body: { "screen_key"?: "<screenKey>" }
  201 → { "thread_id": "thr_...", "session_key": "..." }
  缺省 screen_key 时保持现有 dashboard 行为（重置 dashboard session）。

PATCH /api/agents/{agent_id}/session
  body: { "thread_id": "thr_...", "screen_key"?: "<screenKey>" }
  200 → { "session_key": "...", "thread_id": "thr_..." }
  缺省 screen_key 时保持现有 dashboard 行为。

GET   /api/agents/{agent_id}/threads
  ?screen_key=<screenKey>&scope=screen|topic|dashboard|all&q=<text>&limit=30&offset=0
  200 → [ { thread_id, title, summary, session_key, last_active, created_at,
             pinned, is_active, has_messages, ... } ]
  screen_key 非法格式 → 400（D2）；缺省 scope = 全部（向后兼容旧调用方），
  dashboard 前端显式传 scope=dashboard（D10）；is_active 按 D7。

GET   /api/agents/{agent_id}/threads/{thread_id}/history
  ?limit=30&offset=0&cursor=<...>          # 复用现有接口
  200 → { messages, has_more, next_cursor, ... }

POST  /api/agents/{agent_id}/chat/ws       # 复用现有协议，不改帧格式
```

服务端校验：所有接口都要求 thread / session 属于当前登录用户与目标 agent；`screen_key` 只做绑定与过滤，不参与权限判断。

## 实现要点

### 服务端

- `ThreadRegistry` 新增 `screen_key(agent_id, user_id, screen_key)` 静态方法：
  - `channel_type=dashboard`、`channel_subject_id=str(user_id)`、`channel_chat_type=f"screen:{screen_key}"`。
- `GET /screen-session`：读取 `sessions` 绑定（`get_bound_thread_id`），未绑定返回 null。
- `POST /threads` / `PATCH /session`：增加可选 `screen_key`；校验后走 `reset` / `rebind`。
- `GET /threads`：增加 `screen_key` / `scope` / `q` / 分页参数；`scope=screen` 精确匹配 `session_key`，`topic` 用前缀匹配（按 D2 转义与定界），`dashboard` 排除 `:screen:`；`screen_key` 按 D2 校验；`is_active` 按 scope 对应 session 绑定判断；`summary` 由历史首条 user 文本生成（剥离 S2 前缀）。
- 标题生成：在 `set_title_if_null` 前剥离 `〔当前页：…〕` 前缀（正则只匹配该固定格式）。
- 所有新增/修改路径补单元测试（见下）。

### 大屏

- 新增 `screenKeyFor(pathname)` 路由工具（demo 映射见 D2），页面组件通过它计算 screenKey。
- `chatClient` 增加：`resolveScreenSession`、`createScreenThread`、`rebindScreenSession`、`listScreenThreads`、`loadThreadHistory`。
- `useScreenChat` 改为以 `screenKey` 为输入：启动时解析/创建 session → 加载历史；暴露 `newSession`、`switchSession`、`history`、`historyLoading`。
- 历史消息转换：只保留 user/assistant 文本块，剥离 `〔当前页：…〕` 前缀；tool/thinking 忽略。
- UI：标题栏/浮层头部的「历史」「新建」入口；抽屉与浮层列表；搜索防抖 300ms；时间分组；置顶操作。
- 不再使用 `bigscreen:thread:*` localStorage 绑定（可保留 UI 偏好类缓存）。

## 实施顺序

1. 本 ADR（已完成）。
2. 服务端：session key 工具、screen-session 接口、threads/session 接口扩展、threads 列表 scope/q、标题前缀剥离 + 单元测试。
3. 大屏：screenKey 路由工具、session 解析与历史加载、消息转换。
4. 大屏 UI：历史抽屉/浮层列表、搜索、时间分组、置顶、新建/切换绑定。
5. dashboard：`scope=dashboard` 默认过滤 + 现有会话列表回归。
6. 验证：`uv run pytest`（相关单测）、ruff、mypy、`cd dashboard && npx tsc -b`、`cd bigscreen && npm run build`、`make build-bigscreen`；手动冒烟（登录/切屏/刷新/新建/切历史/多用户）。

## 验证清单

- [ ] 同一用户进入专题屏 → 自动有会话；切到二级/三级再回首页 → 历史仍在。
- [ ] 不同屏（首页/二级/三级）会话互相独立；同一屏内切视角不换会话。
- [ ] 刷新页面/换浏览器（同一账号）→ 会话与历史恢复。
- [ ] 点「新建」→ 新会话生效，旧会话仍出现在历史列表。
- [ ] 历史列表：当前屏/本专题/全部 三个 tab、搜索、时间分组、置顶均可用。
- [ ] 大屏历史只包含 `screen:` 会话；dashboard 会话列表不出现大屏会话。
- [ ] 用户 A 与用户 B 的会话完全隔离；同一浏览器切换账号不串会话；**多用户同时使用同一公共专家互不干扰**。
- [ ] 流式中禁止新建/切换；401 弹登录浮层；绑定 thread 被删后自动重建。
- [ ] 历史消息只渲染文本，S2 前缀不展示；时间按服务端时区显示。
- [ ] 非法 screenKey（含 `:`、超长、未注册前缀）返回 400；`scope=topic` 不误匹配同前缀异物（如 `demo/investmentx`）。

## 后续（不在本期）

- 会话分组/标签（核心 thread 级能力，dashboard 与大屏共用）；
- 全文检索；
- 大屏会话管理（删除/批量归档）；
- 跨屏会话迁移/合并。
