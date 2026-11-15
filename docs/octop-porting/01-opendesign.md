# OpenDesign → Octop 移植计划

目标：在 Octop 里复刻 Cindy OpenDesign 的使用体验——稿件可建可改、右侧画板可点开、能对元素做批注、批注能直接驱动 agent 改稿、有 revision 冲突保护。

## 1. 现有零件（已核对）

| 需要的东西 | Octop 对应 | 位置 |
|---|---|---|
| 右侧画板 | `host.openSidePanel({callId,title,toolName})` → dock tab | `dashboard/src/plugins/toolRenderers/types.ts:70-76`、`pages/Chat/hooks/useChatDockPanel.ts:248` |
| 插件前端 | 自包含 ESM，React 在 `window.__OCTOP_REACT__` | `toolRenderers/loader.ts:27-50` |
| 鉴权 API | `host.request(path, init)` | `toolRenderers/host.ts:66-68` |
| 读稿件 | `GET /agents/{id}/workspace/download?path=` | `api/routers/workspace.py:339` |
| 写稿件 | `POST /agents/{id}/workspace/upload`（multipart） | `api/routers/workspace.py:315` |
| 发消息给 agent | **缺失**，需补丁 | 见 §5 |
| 无全局 CSP | 已确认 | `workspace.py:471` 仅 media preview |

## 2. 数据布局

```text
<agent workspace>/
└── designs/
    └── <slug>/
        ├── index.html        # 当前稿件（唯一真源）
        ├── meta.json         # {rev, sha256, title, updated_at, tool_call_id}
        ├── annotations.json  # [{id, selector, tag, text, note, rect, created_at, status}]
        └── history/
            ├── v0001.html
            └── v0002.html
```

- `rev` 单调递增；`sha256` 用于校验磁盘内容未被外部改动。
- 每次 `design_update` 先读 `meta.json` 比对 `expectedRevision`；不一致直接返回冲突，不写盘。
- 旧版本在写盘前复制进 `history/`，保留最近 20 份。

## 3. 插件结构

```text
octop-design/
├── plugin.yaml
├── main.py
├── design_store.py      # 读写 / revision / 冲突
├── ui/dist/index.js     # 构建产物（自包含 ESM）
└── ui/src/              # 源码，用 vite 构建，不进 ZIP 也行
```

`plugin.yaml`：

```yaml
id: design
version: 0.1.0
name: Design
kind: tool
entry: main.py
icon: "🎨"
ui:
  entry: ui/dist/index.js
  manifest: ui/dist/manifest.json
```

## 4. 工具契约

所有工具返回 JSON 字符串，带 `octop_ui`：

```json
{
  "octop_ui": {"renderer": "design_canvas", "version": 1},
  "data": {"slug":"landing","title":"落地页","revision":3,"html":"<!doctype html>…"},
  "text": "已更新稿件 landing（rev 3）"
}
```

| 工具 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `design_new` | `title`, `html`, `slug?` | rev + html | 已存在则拒绝，提示改用 `design_update` |
| `design_context` | `slug?` | html + rev + annotations + 历史列表 | 改稿前必须先调 |
| `design_update` | `html`, `expectedRevision`, `slug?` | 新 rev，或 `CONFLICT` | 冲突时返回当前 rev 和差异摘要，不覆盖 |
| `design_open` | `slug?` | 仅 UI 数据 | 打开画板，不改内容 |
| `design_annotations` | `slug?`, `consume?` | 批注列表 | 供 agent 主动读取；`consume=true` 后标记已处理 |

工具描述里写死工作流：**先 `design_context` 再 `design_update`，禁止凭记忆重写**——这条从 Cindy 插件继承。

## 5. 前端设计

### 5.1 渲染器

`setup(host)` 注册 `design_canvas`。同一个组件两种形态：

- **聊天卡片**：标题 + rev 徽标 + 小预览 + 「打开画板」「版本历史」按钮。
- **dock 画板**：整块区域，工具栏 + iframe + 批注侧栏。

打开画板：`host.openSidePanel({callId, title, toolName:"design_new"})`。

### 5.2 iframe

- 文本通过 `host.request` 取，取不到则 `fetch('/api/agents/.../workspace/download?...', {headers:{Authorization:"Bearer "+localStorage.auth_token}})`。
- 写入 `<iframe srcdoc={html}>`，**不加 sandbox**（同源才能注 DOM）。
- `onLoad` 后注入：

```js
const doc = iframe.contentDocument;
const overlay = doc.createElement('div'); // 绝对定位高亮框
doc.addEventListener('mousemove', highlight, true);
doc.addEventListener('click', pick, true);
```

- 选择器生成：从元素往上拼 `tag:nth-of-type(n)`，存稳定路径；同时存文本片段和 `getBoundingClientRect`。
- 批注锚点用 `rect` 相对文档坐标，窗口尺寸变化时按比例重算。

### 5.3 批注交互

1. 工具栏切「批注」→ 悬停高亮非交互元素。
2. 点击元素 → 弹出输入框（右下角气泡或侧栏行）。
3. 提交 → 写 `annotations.json`（`POST workspace/upload`，multipart 覆盖写）。
4. 侧栏列出未处理批注，可编辑、删除。
5. 「让 Agent 修改」→ 见 §5.4。

### 5.4 发回 agent（依赖补丁）

补丁后：

```js
host.sendUserTurn(`按以下批注修改稿件 ${slug}（当前 rev ${rev}）：\n` +
  annotations.map((a,i)=>`${i+1}. [${a.selector}] ${a.note}`).join('\n'));
```

零补丁降级：把同样文本复制到剪贴板 + 提示用户粘贴发送；或写 `annotations.json` 由 hook 注入（第三个包，暂不做）。

### 5.5 直接编辑（P2）

- 选中元素 → 右侧属性面板（文本、字号、颜色、间距、对齐）。
- 改动即时写回 iframe DOM，点保存时序列化 `documentElement.outerHTML`。
- 保存前做一次 sha256 比对：磁盘被别人改过就提示冲突，不静默覆盖。

## 6. 阶段与验收

### P0 骨架（3 人日）

- 插件可安装、`plugin.yaml` 校验通过。
- 四个工具落地，revision / 冲突逻辑有单测。
- 聊天卡片 + 画板能显示稿件；dock 可开关。
- **验收**：让 agent 建稿、改稿、故意用旧 rev 改，能看到拒绝提示。

### P1 批注闭环（3–4 人日）

- 元素悬停高亮、点击选中、批注增删改、落盘。
- 核心补丁 `sendUserTurn` + `host.ts` / `Chat/index.tsx` 接线。
- **验收**：点元素 → 写一句批注 → 点按钮 → agent 自动收到并改稿，画板刷新到新 rev。

### P2 体验对齐（4 人日）

- 属性面板直接改稿、保存冲突提示。
- `html2canvas` 截图随批注（可选开关）。
- 版本历史列表 + 回滚。
- 同 slug 收敛到同一 dock tab，3 秒轮询磁盘 rev 自动刷新。
- 深色模式、320px 宽度适配。
- **验收**：与 Cindy 并排使用，操作路径一致。

## 7. 补丁细节

```diff
# dashboard/src/plugins/toolRenderers/types.ts
+  /** Send a user turn through the chat pipeline (same path as ACP cards). */
+  sendUserTurn(text: string): void;

# host.ts
 let dockHandlers: {
   openSidePanel?: ...
   closeSidePanel?: ...
+  sendUserTurn?: (text: string) => void;
 }
 ...
+    sendUserTurn(text: string) { dockHandlers.sendUserTurn?.(text); },

# pages/Chat/index.tsx (setPluginUiDockHandlers effect)
   setPluginUiDockHandlers({
     openSidePanel: openToolUiTab,
+    sendUserTurn: wrappedHandleSend,
   });
```

注意：`wrappedHandleSend` 的引用要进 effect 依赖数组，避免闭包拿到旧状态。

## 8. 不做的事

- 不做独立的 `localhost` 预览地址。
- 不做多文件稿件（单 HTML 自包含是硬约束，和 Cindy 一致）。
- 不做稿件版本 diff 可视化（P2 只做列表 + 回滚）。
- 不引入 npm 构建进 Octop 安装流程，`ui/dist` 预先构建好。
