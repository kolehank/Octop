# octop-design — OpenDesign

在 Octop 里复刻 Cindy OpenDesign 的核心体验：稿件可建可改、右侧画板可点开、
能对元素做批注、批注能直接驱动 agent 改稿、有 revision 冲突保护。

## 安装

源码目录（开发机，改动即时生效）:

```bash
octop plugin install ./plugins/octop-design --force
```

**离线分发用 ZIP**（目标机无需 node/npm，UI 用仓库内预构建的 `ui/dist`）:

```bash
uv run python scripts/pack_plugin.py plugins/octop-design   # -> dist/plugins/design-0.1.0.zip
```

ZIP 的三种装法，任选其一:

1. **Dashboard 插件页上传**（推荐，离线机可用）——请求走 `POST /api/plugins/install`；
2. `octop plugin install <目录>`——把 ZIP 解包后的目录传给 CLI（CLI 只接受目录或 URL）；
3. 把 ZIP 放到 HTTP 服务上，`octop plugin install https://…/design-0.1.0.zip`。

装好后在 Dashboard「工具管理」为 Agent 启用 `design` 插件，即可在聊天中调用
`design_new` / `design_context` / `design_update` / `design_open` /
`design_annotations`。

## 组成

| 文件 | 职责 |
|------|------|
| `plugin.yaml` | 清单（id: design, kind: tool, icon 🎨, ui/dist 前端） |
| `main.py` | 注册 5 个工具，返回带 `octop_ui` 的 JSON 字符串 |
| `design_store.py` | 纯前置逻辑数据层（可注入 base path，离线可测） |
| `ui/src/` | Vite 前端源码（React 取自 `window.__AGENTBUDDY_REACT__`） |
| `ui/dist/` | 构建产物（`index.js` + `manifest.json`），安装时无需 npm |

## 数据布局

```text
<agent workspace>/designs/<slug>/
├── index.html        # 当前稿件（唯一真源）
├── meta.json         # {slug, title, rev, sha256, updated_at, tool_call_id, created_at}
├── annotations.json  # [{id, selector, tag, text, note, rect, created_at, status}]
└── history/          # vNNNN.html 快照，保留最近 20 份
```

`rev` 单调递增；每次 `design_update` 先比 `expectedRevision`，不一致返回
`CONFLICT` 且不写盘；`sha256` 用于检测磁盘内容被外部改动。旧版本写盘前复制进
`history/`。

## 工具契约

所有工具返回 JSON 字符串（`octop_ui.renderer = "design_canvas"`）：

```json
{
  "octop_ui": {"renderer": "design_canvas", "version": 1},
  "data": {"slug":"landing","title":"落地页","revision":3,"html":"…"},
  "text": "已更新稿件 landing（rev 3）"
}
```

工作流（工具描述中已写死给模型）：**先 `design_context` 再 `design_update`，
禁止凭记忆重写**。

## Workspace 访问权衡（后端）

插件工具运行时拿不到 harness 解析出的 `BackendWorkspace` / 自定义
`workspace_dir`（详见 `main.py` 模块 docstring 的调研说明），因此：

- 数据放在**默认 agent workspace** `{AGENTBUDDY_HOME}/agents/<agent_id>/designs/`
  （与 `octop.infra.utils.paths.PathLayout.agent_workspace_dir` 同构）；
- Dashboard 通过 workspace HTTP API（`download` / `upload`，`from_workspace=true`）
  读写同一份字节，默认配置的 agent 前后端完全对齐；
- 自定义 `workspace_dir` / 远程 / docker 后端的 agent：UC 工具无法感知其真实
  workspace，前后端会落在不同目录 —— 该偏差在 `main.py` 注释中说明，不做静默桥接。

## 前端

- 构建：`cd plugins/octop-design/ui && npm install && npm run build`
- 渲染器 `design_canvas` 同一组件两种形态：聊天卡片（标题 + rev 徽标 + 预览 +
  「打开画板」「版本历史」）与画板（工具栏 + iframe + 批注侧栏 + 历史抽屉）。
- iframe 用 `srcdoc` 渲染稿件（不加 sandbox），注入元素悬停高亮 + 点击选中 +
  批注；批注写回 `annotations.json`。
- 「让 Agent 修改」优先 `host.sendUserTurn`（develop 已接线），缺失时复制到
  剪贴板并提示粘贴。

## 测试

```bash
uv run pytest tests/unit/test_plugin_octop_design_store.py -q
```