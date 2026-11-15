# 常见坑与对策（Office 文档生成）

## 内容组织

| 坑 | 后果 | 对策 |
|----|------|------|
| 把 markdown 原文塞进 docx 段落 | 无样式、无标题层级、目录失效 | 内容拆到 `blocks` 的 `heading/para/ul/ol/table/image` 结构 |
| 用 `**加粗**` 冒充标题 | 大纲/目录抓不到 | 用 `heading` 块写标题 |
| 表格不给列宽 | 列被挤压、文字换行 | docx 配 `col_widths`，xlsx 配 `width` 或交给自适应 |
| 一个段落装一大段文字 | 阅读困难、排版崩 | 拆成多个 `para`，每段一个主题 |
| PPT 每页超 6 行文字 | 观众读稿，页面拥挤 | 一页一主题，要点 ≤ 6 行，细节进 `notes` |
| xlsx 全塞一个 sheet | 结构混乱、图表引用串行 | 每 sheet 一个主题，图表 x/y 引用同 sheet 列 |
| 公式引用不存在的单元格 | 打开报错或 #REF! | 先保证被引用单元格存在于同一 sheet |

## 文件与覆盖

- **不覆盖用户原文件**：输出一律 `output/` 或带时间戳新路径。脚本默认拒绝写已存在
  的输出文件（会返回 `{"ok":false,"reason":"exists"}`）；确需覆盖再设 `"overwrite":true`。
- 改已有文档：`read_office.py` 读回 → 改 spec → 生成**新路径**，保留原文件，交付时
  说明改了什么、新旧文件各在哪。
- 大文件：预计 > 50 MB、xlsx > 5 万行、多张原图时先压缩/拆分，写进交付摘要。

## 字体与中文

- 中文字体链 `微软雅黑 → 苹方 → Noto Sans CJK → DejaVu Sans`：脚本自动探测，全缺失
  会在 summary 告警 —— 把告警转告用户，不要假装没问题。
- 需要锁定字体时 spec 显式指定 `"font": "Microsoft YaHei"` 等（PowerPoint 端打开时
  若机器无此字体仍会替换，属正常现象）。
- 不要只设西文字体就以为中文没问题：docx 必须同时落到 `w:eastAsia`，pptx 同时设置
  `a:ea`/`a:cs`，脚本已处理。

## 读回与校验

- 生成后必须 `read_office.py` 读回核对（页数/工作表/幻灯片数、内容、大小 > 0）再交付；
  别把“脚本没报错”当成“文件正确”。
- xlsx 公式：生成器不缓存计算结果，读回默认显示公式文本；要缓存值在 read spec 里设
  `"data_only": true`（仅当文件由 Excel/WPS 保存过才有缓存）。
- xlsx 大表：`read_office.py` 默认每个 sheet 最多输出 200 行，超出会注明截断。

## PDF 导出

- 机器没有 LibreOffice：`convert_pdf.py` 返回 `{"ok":false,"reason":"libreoffice-missing"}`。
  **不许伪造成功** —— 如实告知，并提议替代方案（markdown 交付 / 指导安装 LibreOffice）。
- LibreOffice 转换输出文件名取源文件主名（`report.docx` → `report.pdf`），脚本会搬到
  你指定的 `--out`；转换需要几秒到几十秒，设好 `timeout`。

## 兼容性

- 只保证结构与样式正确、可编辑，不保证与 Microsoft Office 逐像素一致（不同版本
  对默认样式/字体回退处理不同）。
- 生成物不用绝对坐标堆叠版式、不依赖特定主题，跨 Word/WPS/LibreOffice 更稳。
- 图片 `.png/.jpg` 均可；WebP 等非常规格式先转成 png/jpg 再嵌入。