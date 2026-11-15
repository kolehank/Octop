# Office 文档技能 → Octop 移植计划

目标：让 Octop 的专家能稳定产出可用的 Word / Excel / PowerPoint，并能读回、改写已有文档。

## 1. 为什么做成 Skill 而不是插件工具

- Octop 的 `python-docx`、`python-pptx`、`openpyxl`、`xlrd`、`pypdf` 已在主依赖里（`pyproject.toml:41-48`），无需安装。
- Skill 是目录 + `SKILL.md` + 任意脚本，安装后复制进 agent 工作区（`octop-harness/plugins/context.py:115-121`），模型自己用 `execute` 调脚本即可，扩展新模板不用改插件代码。
- 固定工具接口反而限制发挥：文档生成的参数空间太大，SKILL.md + 可组合脚本更合适。

## 2. 包结构

```text
octop-office/
├── plugin.yaml            # kind: skill
└── skills/
    └── office-docs/
        ├── SKILL.md
        ├── references/
        │   ├── spec-docx.md
        │   ├── spec-xlsx.md
        │   ├── spec-pptx.md
        │   └── pitfalls.md
        └── scripts/
            ├── _theme.py        # 字体链、配色、页边距、单位换算
            ├── _io.py           # 统一 JSON 入参 / 输出 / 文件校验
            ├── make_docx.py
            ├── make_pptx.py
            ├── make_xlsx.py
            ├── read_office.py   # docx/xlsx/pptx → markdown 或 json
            └── convert_pdf.py   # 探测 soffice，缺失时明确报错
```

`plugin.yaml`：

```yaml
id: office
version: 0.1.0
name: Office 文档
kind: skill
entry: main.py        # setup(ctx) 里只需 ctx.skills("skills")
icon: "📄"
group: tools
```

`main.py`：

```python
from octop_harness.plugins import PluginContext

def setup(ctx: PluginContext) -> None:
    ctx.skills("skills")
```

## 3. SKILL.md 要点

- **触发条件**：用户要生成/修改 Word、Excel、PPT、报表、方案、周报、汇报材料。
- **工作流**：先确认交付格式与受众 → 写 JSON spec → 调脚本生成 → **重新打开校验**（页数/工作表/幻灯片数、文件大小 > 0）→ 交付路径 + 摘要。
- **硬约束**：
  - 不覆盖用户原文件，输出到 `output/` 或加时间戳。
  - 不手写 OOXML，一律走脚本。
  - 中文优先，字体链 `微软雅黑 → 苹方 → Noto Sans CJK → DejaVu Sans`，缺字体要提示而不是静默替换。
  - 单文件 > 50 MB 或图片总字节过大时先压缩。
- **反例清单**：直接把 markdown 塞进 docx 段落导致没有样式；表格不给列宽导致内容挤压；PPT 每页文字超过 6 行。

## 4. 脚本契约

统一 `--spec <file.json> --out <path>`，stdout 输出 JSON：

```json
{"ok": true, "path": "output/report.docx", "bytes": 48213, "summary": "docx, 3 headings, 1 table, 2 charts"}
```

### `make_xlsx.py`

spec 支持：多 sheet、表头样式、列宽自适应、冻结窗格、数字格式、条件格式、折线/柱状图、公式。

```json
{
  "sheets": [{
    "name": "销售",
    "columns": [{"key":"month","title":"月份","width":12},
                {"key":"amount","title":"金额","numfmt":"#,##0"}],
    "rows": [{"month":"1月","amount":12000}],
    "freeze": "A2",
    "charts": [{"type":"line","x":"month","y":["amount"],"title":"趋势"}]
  }]
}
```

### `make_docx.py`

spec 支持：标题层级、正文段落、有序/无序列表、表格（含合并）、图片、页眉页脚、页码、目录占位、分页。

### `make_pptx.py`

spec 支持：版式（标题页/章节页/要点页/图文页/表格页/图表页）、主题色、母版占位符、备注。默认 16:9。

### `read_office.py`

- docx → 标题/段落/表格 markdown
- xlsx → 每个 sheet 的 markdown 表格（大表截断并提示）
- pptx → 每页文字与备注
- 供"改已有文档"场景：先读、再改 spec、再重新生成。

### `convert_pdf.py`

- 探测 `soffice` / `libreoffice`；存在则转 PDF。
- 不存在时返回 `{"ok":false,"reason":"libreoffice-missing"}`，SKILL.md 要求如实告知用户，不要伪造成功。

## 5. 阶段与验收

### O0 基础（2 人日）

- SKILL.md + `_theme.py` + `make_xlsx.py` + `read_office.py`（xlsx/docx 读）。
- **验收**：一句话生成含图表的两 sheet 报表；读回生成物内容一致；文件能被 Excel / WPS 正常打开。

### O1 主文档（2–3 人日）

- `make_docx.py` + `make_pptx.py` + 三份 spec 参考。
- **验收**：生成一份带目录占位、表格、图片、页码的 docx；一份 10 页、含章节页和图表页的 pptx。

### O2 闭环（1–3 人日）

- 读取→改写来回闭环（docx/xlsx/pptx）。
- PDF 导出 + 降级提示。
- 中文字体回退与缺字体告警。
- **验收**：拿一份现成公司文档，读回、改一段、重新生成，版式不崩。

## 6. 测试与分发

- 每个脚本配 golden 测试：固定 spec → 生成 → 用 `python-docx` / `openpyxl` 读回断言结构。
- 生成物加入 `.gitignore`，测试用临时目录。
- 分发三种方式：ZIP 装成 skill 插件；skill-manager 导入目录；发布到 SkillHub。
- 包体远小于 100 MiB 限制，不含二进制模板以外的大文件。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 运行环境缺中文字体 | 字体探测 + 明确告警；内置一套开源字体的回退名 |
| PPT 版式在不同 Office 版本错位 | 只用标准占位符，不用绝对坐标堆叠 |
| 大表格内存占用 | 流式写入 + 行数上限提示 |
| LibreOffice 不存在 | 探测后降级，不静默失败 |
| 覆盖用户原文件 | 输出路径策略强制，写前检查同名文件 |

## 8. 不做的事

- 不做 docx/xlsx 的像素级模板设计器。
- 不做在线协同编辑（那是 OpenDesign 的领域）。
- 不引入 python-pptx 之外的商业组件。
- 不保证与 Microsoft Office 逐像素一致，只保证结构与样式正确、可编辑。
