---
name: office-docs
description: >-
  生成、读取、改写 Word（.docx）、Excel（.xlsx）、PowerPoint（.pptx）文档，并可用
  LibreOffice 导出 PDF。触发条件：用户要生成/修改 Word、Excel、PPT、报表、方案、
  周报、汇报材料、数据分析表、会议纪要、演讲稿等 Office 文件。
metadata:
  octop:
    emoji: "📄"
---

# Office 文档（Word / Excel / PowerPoint / PDF）

本技能通过 `scripts/` 下的脚本按 **JSON spec（一份结构化描述）** 稳定产出可正常
打开的 Office 文件，绝不手写 OOXML，也不直接往用户原文件里改。

## 触发条件

- 用户要求“生成 / 新建 / 修改 / 更新”Word、Excel、PPT；
- 用户要求产出报表、数据表、方案、周报、月报、汇报材料、会议纪要、演讲稿、商业计划书；
- 用户要求“把这个文档改一下”、“把这个表格整理成 Excel / PPT”。

## 工作流（每次必走）

1. **确认交付格式与受众**：问清（或合理推断）文档类型（Word/Excel/PPT）、给谁看、
   语言（默认中文）、页数/sheet 数/幻灯片数的量级。不要上来就写代码。
2. **写 JSON spec**：按 `references/spec-docx.md` / `spec-xlsx.md` / `spec-pptx.md`
   的结构把内容组织成 JSON（内容不要用 markdown 堆进段落，要落到对应结构里）。
   spec 文件写到工作区，脚本用它生成。
3. **调脚本生成**：在脚本目录执行，例如：

   ```bash
   cd skills/office-docs/scripts
   uv run python make_xlsx.py --spec /tmp/spec.json --out output/report.xlsx
   uv run python make_docx.py --spec /tmp/spec.json --out output/report.docx
   uv run python make_pptx.py --spec /tmp/spec.json --out output/report.pptx
   ```

   脚本 stdout 返回 JSON：`{"ok":true,"path":"...","bytes":12345,"summary":"..."}`。
4. **重新打开校验（必须）**：生成后不要直接交付，先用读回脚本核对：

   ```bash
   cd skills/office-docs/scripts
   printf '{"source":"output/report.docx"}' > /tmp/read.json
   uv run python read_office.py --spec /tmp/read.json --out /tmp/check.md
   ```

   或写成 spec 文件再跑。核对重点：
   - docx：标题层级、段落、表格、图片、页数估算；
   - xlsx：sheet 数量、每 sheet 行/列、图表是否在 summary 里；
   - pptx：幻灯片数量、每页文字、备注；
   - 与用户要求的目标一致；文件大小 > 0。
5. **交付**：给出文件路径（工作区相对路径或绝对路径）+ 一段中文摘要（几页/几个
   sheet/几张幻灯片、哪些内容、占多少字节）。如需 PDF，跑
   `convert_pdf.py`（见下）。

## 脚本与契约

所有脚本统一 `--spec <json> --out <path>`，stdout 输出 JSON：

```json
{"ok": true, "path": "output/report.docx", "bytes": 48213,
 "summary": "docx，3 个标题，1 张表格，2 张图片；字体 微软雅黑"}
```

| 脚本 | 用途 |
|------|------|
| `make_xlsx.py` | 多 sheet、表头样式、列宽自适应、冻结窗格、数字格式、条件格式、折线/柱状图、公式 |
| `make_docx.py` | 标题层级、正文、有序/无序列表、表格（含合并）、图片、页眉页脚、页码、目录占位、分页 |
| `make_pptx.py` | 标题页/章节页/要点页/图文页/表格页/图表页版式，主题色，备注，默认 16:9 |
| `read_office.py` | 读回 docx/xlsx/pptx → markdown（改已有文档的第一步） |
| `convert_pdf.py` | 探测 soffice/libreoffice 转 PDF；没装时返回 `{"ok":false,"reason":"libreoffice-missing"}` |

规格参考：`references/spec-docx.md`、`references/spec-xlsx.md`、`references/spec-pptx.md`；
常见坑：`references/pitfalls.md`。

## 硬约束

- **不覆盖用户原文件**：输出一律进 `output/`（或带时间戳的新路径）。spec 里设置
  `"overwrite": true` 才会允许覆盖，默认拒绝写已存在的输出文件。
- **不手写 OOXML**：所有 docx/xlsx/pptx 一律由脚本生成，绝不在 spec/markdown 里塞
  原始 XML；页码、目录等 Word 域由脚本生成。
- **中文字体链**：`微软雅黑 → 苹方 → Noto Sans CJK → DejaVu Sans`。脚本自动探测系统
  字体并选第一个可用的；若全部缺失会在 summary 里给出**告警**（只提示，不静默替换）。
  spec 可用 `"font": "具体字体名"` 强制指定。
- **大文件先压缩**：单文件预计 > 50 MB，或 xlsx 数据行 > 5 万行、文档带多张原图时，
  先压缩图片（缩小分辨率/转 jpg）或拆分文件再生成，并把取舍写进交付摘要。
- **公式值**：xlsx 单元格值以 `=` 开头即公式；读回时默认显示公式文本（生成器没缓存
  结果值），如需 Excel 缓存的结果值在 read spec 里设 `"data_only": true`。

## 反例清单（不要这么干）

- ❌ 把 markdown 直接塞进 docx 段落：得到乱排、无样式、无标题层级的文本。
  正确做法：内容落到 `blocks` 的 `heading`/`para`/`ul`/`ol`/`table`/`image` 结构。
- ❌ 表格不给列宽：文字被挤压换行、列宽失控。正确做法：docx 用 `col_widths`，xlsx 用
  `width` 或交给自适应。
- ❌ PPT 每页超过 6 行文字，或整段粘贴大段文字：变成没人能看的“读稿会”。
  正确做法：一页一个主题，要点 ≤ 6 行，详细内容放备注（`notes`）。
- ❌ 生成后不读回就交付：结构错了（缺 sheet、缺页、文件损坏）用户当场发现。
- ❌ 发现没装 LibreOffice 还谎报“PDF 已生成”：必须如实返回 libreoffice-missing 并
  提供替代方案（read_office.py 出 markdown，或让用户装 LibreOffice）。
- ❌ 直接改用户原文件：改为生成新版（`output/xxx_v2.docx`），保留原文件。
- ❌ 图表类型/行列引用瞎写导致脚本报错或图表空白：先按 references 的样例构造 spec。

## 改已有文档（读 → 改 → 生成）

1. `read_office.py` 把原文件读成 markdown 观察结构；
2. 根据内容重写一份 JSON spec（可以只改要改的段落/sheet/页）；
3. `make_*.py` 生成到**新路径**，读回校验后交付，与原文件对比差异并说明。

## PDF 导出

```bash
cd skills/office-docs/scripts
printf '{"source":"output/report.docx"}' > /tmp/convert.json
uv run python convert_pdf.py --spec /tmp/convert.json --out output/report.pdf
```

- 机器装了 LibreOffice：正常转换，返回 `ok:true`。
- 没装：返回 `{"ok":false,"reason":"libreoffice-missing","detail":"..."}`。
  如实告诉用户，并主动提议替代方案（要 markdown，或指导安装 LibreOffice）。