# Octop 专家市场调研与自建方案

> 调研日期:2026-11-08。针对 Octop(前身 agentbuddy)的「专家市场/技能市场」上游、腾讯侧开源情况、自建市场的完整接口清单与落地骨架。

## 0. 结论先行

- Octop 的专家/插件市场对接 **腾讯 `octop.cloud`** 门户(目录)+ `download.octop.cloud`(zip 包),技能市场对接 **腾讯 `api.skillhub.cn`**。**两者服务端均未开源**。
- 腾讯开源了 `github.com/Tencent/skillhub`(Open API 文档 + DeepSeek Harness 客户端插件 + 官方 skills),以及 `TencentCloud/Octop` 系产品仓库。开源的是**协议和客户端消费方**,不是市场服务端。
- 好消息:Octop 客户端把完整交互协议写进了自身仓库(`docs/private-market.md`、`docs/skill-market.md`、`docs/expert-package.md`),且通过 4 个环境变量天然支持指向任意自建源站 —— **零代码即可自建兼容市场(方案 A 具备实现条件)**。
- 若需发布/审核/多用户/独立展示门户,需自研服务端(方案 C),客户端侧已就绪,仅缺「上传发布」接口的对接。

## 1. 腾讯侧开源情况(代码证据)

### 1.1 `Tencent/skillhub`(https://github.com/Tencent/skillhub)

skillhub.cn 官方仓库,2026-08-24 创建,持续更新。开源三部分:

| 目录 | 内容 | 说明 |
|---|---|---|
| `docs/` | Open API 参考 + 可运行示例(curl/Node/Python) | **完整公开的协议文档**,覆盖搜索/详情/榜单/下载/文件/版本/评测/分类 |
| `dsh-plugin/` | DeepSeek Harness 的 SkillHub 客户端插件 | 对话内搜索/安装/插件广场 UI,**客户端参考实现**,npm 包 `@tencent/skillhub` |
| `skills/` | SkillHub 官方维护的 Skill | 内容资产 |

**该仓库不含市场服务端代码**。`api.skillhub.cn` 后端是闭源 SAAS。

### 1.2 `TencentCloud/Octop` 系仓库

`download.octop.cloud/octop/scripts/install.sh` 头部明确写 `OCTOP_REPO=https://github.com/TencentCloud/Octop.git`,确认是腾讯产品线。开源的是「市场消费者」:

- `TencentCloud/Octop` — 主仓库(本仓库),含 `infra/market/`、`infra/skills/`、`infra/agents/experts/` 全部客户端实现,以及三份协议文档
- `octop-harness` / `octop-gateway` / `octop-memory` / `octop-browser` — 运行库

`octop.cloud` 门户本身未开源,但其目录协议已随主仓库文档公开。

### 1.3 其他相关仓库

Tencent / TencentCloud 两个 org 下按 market / expert / skill 检索,**无其他市场服务端项目**。`tencentcloud-*-skills`(ocr/speech/vita 等)是技能内容,不是市场。

## 2. Octop 专家/技能市场的对接架构

### 2.1 两条上游

| 市场 | 上游 | 客户端实现 | 环境变量 | 线上实测(2026-11-08) |
|---|---|---|---|---|
| 专家市场 | `octop.cloud/api/market/experts`(目录)+ `download.octop.cloud`(zip) | `src/octop/infra/market/{source,experts,install,http}.py` | `OCTOP_PORTAL_ORIGIN` / `OCTOP_MARKET_REMOTE_ORIGIN` | 目录 200,**76 个专家**,734KB,单条含 content/quick_prompts 全字段 |
| 插件市场 | 同上,`/api/market/plugins` | `infra/market/plugins.py` | 同上 | 目录 200,条目含 version/download_url |
| 技能市场 | `api.skillhub.cn`(search/showcase/download) | `infra/skills/skillhub_market.py` | `SKILL_MARKET_ORIGIN` | search/showcase/download 全 200,zip 302→腾讯 COS |
| 技能集(专家模板) | `api.skillhub.cn`(skillsets) | `infra/agents/experts/skillhub_market.py` | `SKILLSET_ORIGIN`(默认同 `SKILL_MARKET_ORIGIN`) | `/api/v1/skillsets?page=&pageSize=` 200,返回真实技能集 |

### 2.2 客户端关键行为(决定自建市场接口约束)

- **目录一次取全量**,不传查询参数;专家的搜索/场景筛选在 Octop 本地做(`infra/market/experts.py:_haystack`)。所以 `content`/`quick_prompts`/`task_examples` 等详情字段**必须放在目录条目里**。
- 成功结果进程内缓存 **30 秒**(`infra/market/source.py`);技能集列表缓存 300 秒。
- 目录响应 ≤ **1 MiB**、超时 **8 秒**、带头 `Accept: application/json` + `User-Agent: Octop`;`success` 必须为 JSON 布尔 `true`,`data.items` 必须是数组。
- 安装包 `download_url` 的协议/主机/端口必须与 `OCTOP_MARKET_REMOTE_ORIGIN` 完全一致,路径不限(`infra/market/http.py:is_market_archive_url`)。
- 专家 zip 校验:`manifest.json` 必须存在且 `id` == 目录里的 `slug`;zip 安全校验(条目 ≤2000、解压 ≤64MiB、压缩比 ≤100、路径不能含 `..`)(`infra/market/install.py`)。
- 专家的 `icon_url` 是 `http(s)` 图片时由 **Octop 进程**创建时下载,失败则跳过用 `icon_name`;插件的 `icon` 由**浏览器**加载 —— 自建环境图标不能指向内网不可达的公网地址。
- **请求不带登录态**,靠网络边界控制访问。

## 3. 完整接口清单

### 3.1 专家/插件目录协议(自建市场源站,见 `docs/private-market.md`)

```
GET {OCTOP_PORTAL_ORIGIN}/api/market/experts   → ExpertCatalog
GET {OCTOP_PORTAL_ORIGIN}/api/market/plugins   → PluginCatalog
GET {download_url}                             → zip(源站须与 OCTOP_MARKET_REMOTE_ORIGIN 同源)
```

**ExpertCatalog**

```json
{
  "success": true,
  "data": {
    "items": [{
      "id": "ops-engineer",          // 建议与 slug 相同
      "slug": "ops-engineer",        // 必须与 zip 内 manifest.json 的 id 一致
      "label": { "zh": "运维工程师", "en": "Ops Engineer" },
      "description": { "zh": "…", "en": "…" },
      "scene": "tech",               // 已知场景见下
      "sub_scene": "…",
      "icon_url": "https://…",       // 可选;Octop 进程下载,失败回退 icon_name
      "icon_name": "terminal",       // 内置图标名
      "color": "#16a34a",
      "skill_slugs": ["k8s-triage"],
      "skill_count": 1,
      "content": { "zh": "…mermaid 工作流…", "en": "…" },
      "quick_prompts": [{ "title": {"zh":"…","en":"…"}, "description": {"zh":"…","en":"…"}, "prompt": {"zh":"…","en":"…"}, "color":"#e8f4ff", "icon_name":"zap" }],
      "task_examples": { "zh": ["…"], "en": ["…"] },
      "download_url": "https://market.internal/octop/market/experts/ops-engineer/1.0.0/ops-engineer-1.0.0.zip",
      "updated_at": "2026-10-26T00:00:00Z"   // ISO-8601,Octop 按字符串倒序排
    }]
  }
}
```

**PluginCatalog**

```json
{
  "success": true,
  "data": {
    "items": [{
      "id": "weather",
      "version": "0.1.0",                    // 必须与 zip 内 plugin.yaml 的 version 一致
      "name": { "zh": "天气", "en": "Weather" },
      "description": { "zh": "…", "en": "…" },
      "kind": "tool",
      "icon": "☀️",                           // emoji 或浏览器可加载的 http(s) 地址
      "group": "lifestyle",
      "requires": [],
      "download_url": "…/weather-0.1.0.zip",
      "updated_at": "2026-10-26T00:00:00Z"
    }]
  }
}
```

**约束**:`id`/`slug` 字符集 `^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$`;两表一次取全量 ≤1MiB;`updated_at` 用同一 ISO-8601 形式(如 `2026-10-26T00:00:00Z`)。

**已知插件分组文案**:`lifestyle` `news` `finance` `media` `fun` `games` `tools` `ops`(其他归「其他」)。

**已知专家场景文案**:`ecommerce` `finance` `content-creation` `lifestyle` `marketing` `mysticism` `academic` `legal` `tech` `education` `healthcare` `hr` `media` `design`。

### 3.2 专家包格式(见 `docs/expert-package.md`)

zip 内布局两种均可(根上 `manifest.json` 或唯一一层子目录):

```
ops-engineer-1.0.0.zip
├── manifest.json          # 必需;id 必须 == 目录 slug
├── SOUL.md                # 建议:人格(写进工作区根)
├── IDENTITY.md            # 可选
├── USER.md                # 可选
├── AGENTS.md              # 可选
├── avatar.svg             # 可选(实测线上包有)
├── skills/
│   └── k8s-triage/
│       ├── SKILL.md       # 必需,frontmatter 含 name/description
│       └── references/…
└── agents/
    └── reviewer.md        # 可选:子 Agent
```

体积限制:zip ≤32MiB;解压后 ≤64MiB;成员 ≤2000;解压/压缩比 ≤100(>1MiB 成员时)。

**manifest.json 字段表**

| 字段 | 说明 |
|---|---|
| `id` | 专家标识,必填;与安装请求的 slug 一致 |
| `label` | 名称,字符串或 `{zh,en}` |
| `description` | 简介,同上 |
| `welcome_message` | 对话页欢迎语,同上 |
| `icon_name` | 内置图标名(如 `terminal`) |
| `icon_url` | http(s) 图片,Octop 进程下载,失败则跳过 |
| `color` | 卡片颜色,如 `#16a34a` |
| `prompt_files` | 创建页要预览的根目录 Markdown,如 `["SOUL.md"]`,只认根下 `*.md` |
| `quick_prompts` | 欢迎页快捷提示数组,见下 |
| `task_examples` | 任务页空状态示例,`{zh:[],en:[]}` 或字符串数组 |

`quick_prompts` 每项:`title`/`description`/`prompt`(字符串或 `{zh,en}`)、`color`(缺省 `#e8f4ff`)、`icon_name`(可选)。

`task_examples`:最多展示 3 或 6 条;未填时界面按专家名生成默认;`[]` 表示不显示。

安装行为:目录条目管列表/详情展示;写进工作区的是包内文件 + 包内 manifest 的 welcome/quick_prompts;创建请求另带 quick_prompts 时以请求为准。

### 3.3 技能市场协议(见 `docs/skill-market.md`;自建源站 `SKILL_MARKET_ORIGIN`)

```
GET {SKILL_MARKET_ORIGIN}/api/v1/search?q=…&limit=…                 → { "results": [Skill] }
GET {SKILL_MARKET_ORIGIN}/api/v1/showcase/{hot|featured|newest|recommended|trending|paid} → Ranking
GET {SKILL_MARKET_ORIGIN}/api/v1/download?slug=…                    → zip(根上须有 SKILL.md)
```

- 六个榜单各自请求,单个失败其余仍返回;榜单没有合并路径,Octop 自行并发拼装。
- 空关键字被换成 `a`,`limit` 夹到 1–100。搜索/榜单超时 10s、≤4MiB;下载超时 30s、≤32MiB。
- 包内根上要有 `SKILL.md`;全在一个顶层目录时 Octop 剥一层。解压 ≤2000 条、≤64MiB;拒绝符号链接/绝对路径/`..`/加密条目。
- `iconUrl` 由**浏览器**加载。

**Skill 条目字段**:`slug`(必需)、`displayName`/`name`、`summary`/`description`、`version`、`description_zh`、`iconUrl`、`downloads`/`installs`/`stars`、`category`、`labels`。

### 3.4 技能集协议(`SKILLSET_ORIGIN`,Octop 技能包页「从技能市场导入」)

```
GET {SKILLSET_ORIGIN}/api/v1/skillsets/{slug}             → 详情(带 skillSlugs 时不再要包)
GET {SKILLSET_ORIGIN}/api/v1/skillsets/{slug}/download    → zip(manifest.json + 工作流 md)
```

- 详情字段:`slug`、`displayName`/`name`、`summary`/`description`、`iconUrl`、`scene`、`skillSlugs`。
- 无 `skillSlugs` 时 `/download` 须为 zip:含 `manifest.json`(用 `skillSlugs` 或 `skillSets[].skillSlugs` 列技能)+ 工作流说明(优先 `skillsets/{slug}.md`,否则任意 `skillsets/*.md`,再否则 `identify.md`)。
- 导入后按集内每个技能 slug 回到 `SKILL_MARKET_ORIGIN` 下载。超时 30s、≤32MiB。

### 3.5 腾讯 SkillHub 官方 Open API(来自 `Tencent/skillhub` 仓库 docs,线上实测可用)

| 能力 | 路径 | 备注 |
|---|---|---|
| Skill 列表(分页筛选) | `GET /api/skills?page=&pageSize=&sortBy=&order=&keyword=&category=&source=&labels=` | 信封格式 `{code:0,data:{total,skills}}`;`sortBy` 支持 `downloads/stars/installs/score/updated_at`;`labels` 语法 `k:v,k2:!v2` |
| Top 排行榜 | `GET /api/skills/top` | |
| Skill 详情 | `GET /api/v1/skills/{slug}` | 直接返回业务对象 |
| 批量详情 | `POST /api/v1/skills/batch` | `{slugs:[…]}` ≤1000,返回 `{items,missing}` |
| 下载 | `GET /api/v1/download?slug=&version=&tag=` | **302 重定向**到腾讯 COS,带时效签名,勿缓存 |
| 文件列表 | `GET /api/v1/skills/{slug}/files` | 返回 sha256 可校验 |
| 单文件内容 | `GET /api/v1/skills/{slug}/file` | 302 |
| 版本列表 / 差异 | `GET /api/v1/skills/{slug}/versions` / `diff` / `diff/file` | |
| 质量评测 | `GET /api/v1/skills/{slug}/evaluation` | TRACE 评测 |
| 一级分类 | `GET /api/v1/categories` | 线上 13 个分类 |
| 技能集列表 | `GET /api/v1/skillsets?page=&pageSize=` | Octop 轮询全量(单页 100,上限 20 页) |

调用标识 Header(建议带):`X-API-Key`(团队标识,服务端专用)、`X-Client-User-Id`(脱敏用户标识)。错误统一 `{error:"…"}`,404 不区分不存在与不可见;时间戳为 **Unix 毫秒**;`429/5xx` 需指数退避。

## 4. 可复用 JSON 模板

### 4.1 专家目录最小条目(`/api/market/experts` items 元素)

```json
{
  "id": "ops-engineer",
  "slug": "ops-engineer",
  "label": { "zh": "运维工程师", "en": "Ops Engineer" },
  "description": { "zh": "Linux、Kubernetes 和网络诊断。", "en": "Linux, K8s, network diagnostics." },
  "scene": "tech",
  "sub_scene": "infra",
  "icon_name": "terminal",
  "color": "#16a34a",
  "skill_slugs": ["k8s-triage"],
  "skill_count": 1,
  "content": {
    "zh": "## 步骤 1:采集现场\n…引用任意在线 mermaid/文本均可…",
    "en": "## Step 1: Gather context\n…"
  },
  "quick_prompts": [
    {
      "title": { "zh": "K8s Pod 排障", "en": "Debug a K8s pod" },
      "description": { "zh": "查看状态、事件和日志", "en": "Status, events, logs" },
      "prompt": { "zh": "请给出排查 Pod 异常的命令", "en": "Commands to debug a failing pod" },
      "color": "#e8f4ff",
      "icon_name": "server"
    }
  ],
  "task_examples": {
    "zh": ["每天「09:00」巡检集群，有异常再通知我"],
    "en": ["Every day at 09:00, inspect the cluster and notify me only on failure"]
  },
  "download_url": "http://market.internal:9000/octop/market/experts/ops-engineer/1.0.0/ops-engineer-1.0.0.zip",
  "updated_at": "2026-10-26T00:00:00Z"
}
```

### 4.2 专家包 `manifest.json` 模板

```json
{
  "id": "ops-engineer",
  "label": { "zh": "运维工程师", "en": "Ops Engineer" },
  "description": { "zh": "Linux、Kubernetes 和网络诊断。", "en": "Linux, K8s, network diagnostics." },
  "welcome_message": { "zh": "告诉我你要排查的问题", "en": "Tell me what to troubleshoot" },
  "icon_name": "terminal",
  "color": "#16a34a",
  "prompt_files": ["SOUL.md", "IDENTITY.md"],
  "quick_prompts": [
    {
      "title": { "zh": "K8s Pod 排障", "en": "Debug a K8s pod" },
      "description": { "zh": "查看状态、事件和日志", "en": "Status, events, and logs" },
      "prompt": { "zh": "请给出排查 Pod 异常的命令", "en": "Commands to debug a failing pod" },
      "color": "#e8f4ff",
      "icon_name": "server"
    }
  ],
  "task_examples": {
    "zh": ["每天「09:00」巡检集群，有异常再通知我"],
    "en": ["Every day at 09:00, inspect the cluster and notify me only on failure"]
  }
}
```

### 4.3 技能市场 JSON 模板

```json
// GET /api/v1/search?q=…&limit=…
{ "results": [
  {
    "slug": "weather",
    "displayName": "天气",
    "summary": "查询城市天气",
    "version": "0.1.0",
    "description_zh": "查询城市天气",
    "iconUrl": "http://market.internal:9000/icons/weather.png"
  }
] }

// GET /api/v1/showcase/recommended
{ "section": "recommended", "total": 1, "skills": [
  { "slug": "weather", "displayName": "天气", "summary": "查询城市天气", "version": "0.1.0" }
] }
```

## 5. 方案对比

| 维度 | A:静态协议市场 | B:技能市场源站 | C:自研门户 |
|---|---|---|---|
| 做什么 | nginx 挂静态目录 JSON + zip | 实现 search/showcase/download/skillsets 接口 | 完整服务端:发布/审核/多用户/展示站 |
| 覆盖资产 | 专家、插件 | 技能、技能集 | 专家、技能、插件统一管理 |
| 是否需要写代码 | 否(脚本/配置即可) | 少量(一个源站服务) | 是(门户 + API) |
| 接入 agentbuddy | `OCTOP_PORTAL_ORIGIN` / `OCTOP_MARKET_REMOTE_ORIGIN` | `SKILL_MARKET_ORIGIN` / `SKILLSET_ORIGIN` | 兼容四份协议即可按需接入 |
| 发布/上下架 | 改 JSON + 放 zip(可脚本化) | 需自己写上传管理 | 完整的管理后台 |
| 独立展示页(列表/详情) | 可加一个静态列表页 | — | 天然拥有 |
| 风险 | 目录 ≤1MiB/8s、icon 内网可达性、条目多需精简 | 需自管包存储与校验 | 开发量大 |

## 6. 方案 A 落地骨架(已实现,见仓库外 `~/agentbuddy-market/`)

```
agentbuddy-market/
├── srv/
│   ├── api/market/experts        # 生成的专家目录 JSON(全量,≤1MiB)
│   ├── api/market/plugins        # 生成的插件目录 JSON(可空)
│   └── octop/market/
│       ├── experts/{slug}/{version}/{slug}-{version}.zip   # 线上 76 个专家已下载
│       └── plugins/…
├── nginx.conf                    # 示例: market.internal:9000, JSON 显式标类型
├── scripts/fetch-and-build.sh    # 从可替换的上游拉目录+下载 zip+生成目录 JSON
├── scripts/serve.sh              # 本地起静态服务用于验证
└── README.md                     # 部署/替换地址步骤
```

接入 agentbuddy(在跑 `octop run` 的机器上):

```bash
OCTOP_PORTAL_ORIGIN=http://market.internal:9000
OCTOP_MARKET_REMOTE_ORIGIN=http://market.internal:9000
# 可选:SKILL_MARKET_ORIGIN / SKILLSET_ORIGIN 指向技能市场
```

后续替换地址:改 `fetch-and-build.sh` 顶部的 `UPSTREAM_*` 变量(或直接指向自建门户),重跑脚本即重建目录与包清单。

## 7. 风险与注意事项

- **目录体积**:线上 76 个专家含全字段 734KB,逼近 1MiB 上限。自建时若持续增长:精简 `content`(详情页仍可用)、拆分场景文件或缩短描述;技能集不走此目录不受影响。
- **图标内网可达性**:目录 `icon_url` 由 Octop 进程下载(专家)/浏览器加载(插件),内网环境应改用 `icon_name` + `color`,或放内网可达的静态资源。
- **无鉴权**:协议不带 Token,公网部署必须自行加网络层防护(IP 白名单 / 网关)。方案 C 若做公网,务必在自研门户加鉴权与限流,或先经网关。
- **缓存**:目录 30s 进程缓存,改 JSON 后等一会儿或重启 `octop run`。
- **版本一致性**:插件目录 `version` == `plugin.yaml` 的 `version`;专家 `slug` == `manifest.json` 的 `id`,否则「安装报没有安装包」。
- **SkillHub 官方 API 差异**:Octop 客户端用的 `/api/v1/search`、`/api/v1/showcase/*` 与官方文档的 `/api/skills`、`/api/v1/skills/{slug}` 并存(实测均可用);自建技能市场以第 3.3 节的 Octop 侧协议为准,对接官方平台则用 3.5 节。