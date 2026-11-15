# make_pptx.py spec 契约（生成 PowerPoint）

## 用法

```bash
uv run python make_pptx.py --spec spec.json --out output/report.pptx
```

stdout：`{"ok":true,"path":"...","bytes":12345,"summary":"..."}`

## 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | 字符串 | 文稿标题（core properties） |
| `author` | 字符串 | 作者（缺省 Octop） |
| `aspect` | 字符串 | `16:9`（默认）或 `4:3` |
| `font` | 字符串 | 强制字体；缺省走中文字体链 |
| `colors` | 对象 | 覆盖配色（primary/accent/heading/body/light） |
| `slides` | 数组 | 幻灯片定义（至少一张） |
| `overwrite` | 布尔 | 默认拒绝覆盖已存在文件，`true` 才允许 |

## slides 字段

每张幻灯片统一可选 `notes`（演讲者备注）与 `subtitle`（按版式生效）。

| layout | 必备字段 | 说明 |
|--------|----------|------|
| `title` | `title`, `subtitle?` | 标题页：深色背景 + 居中大标题 + 强调线 |
| `section` | `title`, `subtitle?` | 章节页：主色条 + 章标题 |
| `bullets` | `title`, `bullets[]` | 要点页：一页一主题，要点 ≤ 6 行 |
| `content_image` | `title`, `body`(字符串或数组), `image` | 图文页：左文右图（宽高按比例） |
| `table` | `title`, `headers[]`, `rows[]` | 表格页：主色表头 + 斑马纹数据行 |
| `chart` | `title`, `data{categories[],series[]}` | 图表页：`chart_type` = `line`/`bar`/`column`（缺省 bar） |

## 最小可用示例

```json
{
  "title": "2026 Q1 经营汇报",
  "aspect": "16:9",
  "slides": [
    {"layout": "title", "title": "2026 Q1 经营汇报", "subtitle": "Octop · 4月12日"},
    {"layout": "section", "title": "01 经营概览", "subtitle": "收入 / 成本 / 利润"},
    {"layout": "bullets",
     "title": "收入达成",
     "bullets": ["Q1 收入 320 万，达成率 107%", "环比增长 18%", "新签客户 23 家"],
     "notes": "数据口径：财务月结，税后口径。"},
    {"layout": "content_image",
     "title": "渠道分布",
     "body": ["线上直销占比 61%", "渠道伙伴 27%", "其余 12%"],
     "image": "output/channel.png"},
    {"layout": "table",
     "title": "分区域收入",
     "headers": ["区域", "收入", "达成率"],
     "rows": [["华北", 120, "105%"], ["华东", 140, "110%"], ["华南", 60, "90%"]]},
    {"layout": "chart",
     "title": "月度趋势",
     "chart_type": "line",
     "data": {"categories": ["1月", "2月", "3月"],
              "series": [{"name": "收入", "values": [90, 105, 125]}]}},
    {"layout": "bullets", "title": "下季度展望",
     "bullets": ["发布 2.0", "进入 3 个新行业"]}
  ]
}
```

## 提醒（也是反例）

- 每页要点 ≤ 6 行，每行尽量 1 行收住；详细说明放 `notes`，不要堆满正文。
- 图文页图片路径相对脚本 CWD 或 spec 同目录；图片过大会拖慢打开，先压缩。
- 版式用标准占位（脚本几何常量），不搞绝对坐标堆叠，跨 Office 版本更稳。
- 图表数据列要一组 categories 配至少一个 series；series 的 values 数量对齐。