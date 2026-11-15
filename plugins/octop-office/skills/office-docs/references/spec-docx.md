# make_docx.py spec 契约（生成 Word）

## 用法

```bash
uv run python make_docx.py --spec spec.json --out output/report.docx
```

stdout：`{"ok":true,"path":"...","bytes":48213,"summary":"..."}`

## 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | 字符串 | 文档标题（写入 core properties） |
| `author` | 字符串 | 作者（缺省 Octop） |
| `font` | 字符串 | 强制字体；缺省走中文字体链 |
| `colors` | 对象 | 覆盖配色 |
| `page_size` | 字符串 | `a4`（默认）或 `letter` |
| `margins` | 对象 | `{"top":"2.54","bottom":"2.54","left":"3.18","right":"3.18"}`（cm） |
| `header` | 字符串 | 页眉文字（默认右对齐） |
| `footer` | 布尔/字符串 | `true`=第 X 页 / 共 Y 页 页码域；字符串=页脚文字 |
| `toc` | 布尔 | `true` 在正文前插入“目录”TOC 域占位 + 分页 |
| `blocks` | 数组 | 文档正文内容块（见下） |
| `overwrite` | 布尔 | 默认拒绝覆盖已存在文件，`true` 才允许 |

## blocks 内容块

| type | 字段 | 说明 |
|------|------|------|
| `heading` | `level`(1-4), `text` | 标题，走 Heading 样式（TOC/大纲可用） |
| `para` | `text`, `align`(left/center/right/justify), `bold`,`italic`,`size`,`color` | 正文段落 |
| `quote` | `text` | 引用块（浅底缩进） |
| `ul` | `items` | 无序列表 |
| `ol` | `items` | 有序列表 |
| `table` | `headers`, `rows`, `col_widths`(cm 数组), `merges` | 表格（Table Grid） |
| `image` | `path`, `width_cm`, `caption` | 图片（居中；路径相对脚本 CWD 或 spec 同目录） |
| `pagebreak` | — | 分页 |

### 表格与合并

- `headers` 为第一行（白字主色底加粗）；`rows` 为数据行。
- `col_widths` 给每列宽度（cm）；不给则用 4cm 兜底并自动补足。
- 合并单元格：

```json
{"type":"table","headers":["季度","1月","2月","3月"],
 "rows":[[100,200,300],[150,250,350]],
 "col_widths":[3.5,2.5,2.5,2.5],
 "merges":[{"from":"A1","to":"B1","text":"2026 春夏"}]}
```

## 最小可用示例

```json
{
  "title": "项目周报",
  "author": "Octop",
  "font": "微软雅黑",
  "toc": true,
  "header": "内部资料",
  "footer": true,
  "blocks": [
    {"type": "heading", "level": 1, "text": "一、本周进展"},
    {"type": "para", "text": "本周完成核心模块联调，性能达标。"},
    {"type": "ul", "items": ["修复登录超时", "补充 3 个报表页面"]},
    {"type": "heading", "level": 2, "text": "1.1 数据指标"},
    {"type": "table",
     "headers": ["指标", "目标", "实际"],
     "rows": [["成功率", "99%", "99.2%"], ["响应时间", "200ms", "180ms"]],
     "col_widths": [5, 3, 3]},
    {"type": "image", "path": "output/chart.png", "width_cm": 12, "caption": "本周趋势"},
    {"type": "heading", "level": 1, "text": "二、下周计划"},
    {"type": "ol", "items": ["灰度发布", "撰写使用文档"]}
  ]
}
```

## 提醒

- 标题用 `heading`，别把标题伪装成加粗段落（否则目录/大纲抓不到）。
- 大段内容分成多个 `para`，别塞进一个超长段落。
- 图片路径写工作区里的相对路径即可；`.png/.jpg` 均可。
- 页码与目录是脚本生成的 Word 域，在 Word/WPS 里按 F9 或右键更新域刷新。