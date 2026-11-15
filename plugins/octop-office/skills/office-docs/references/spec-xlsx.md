# make_xlsx.py spec 契约（生成 Excel）

## 用法

```bash
uv run python make_xlsx.py --spec spec.json --out output/report.xlsx
```

stdout：`{"ok":true,"path":"...","bytes":12345,"summary":"..."}`

## 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sheets` | 数组 | 是 | 至少一个 sheet |
| `font` | 字符串 | 否 | 强制指定字体；缺省走中文字体链自动探测 |
| `colors` | 对象 | 否 | 覆盖默认配色（primary/accent/heading/body/light/border…），值可带 `#` |
| `overwrite` | 布尔 | 否 | 默认拒绝覆盖已存在的输出文件；设为 `true` 才允许 |

## sheet 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | 字符串 | sheet 名（缺省 Sheet1/2…） |
| `columns` | 数组 | 每列 `{"key","title","width","numfmt","align"}` |
| `rows` | 数组 | 每行为对象 `{key: value}`；若没有 `columns` 则从首行对象键推断 |
| `freeze` | 字符串 | 冻结窗格，如 `"A2"` |
| `cond` | 数组 | 条件格式规则（见下） |
| `charts` | 数组 | 图表定义（见下） |

- 表头自动加粗、白字、主色底、居中；行高 24。
- 列宽：显式 `width` 优先；否则按内容自适应（中文按 2 个字节宽计），范围 [6, 50]。
- 单元格值以 `=` 开头即公式（如 `"=SUM(B2:B4)"`）。
- `numfmt` 缺省不给数字格式；示例：`"#,##0"`、`"0.0%"`、`"yyyy-mm-dd"`。

## 条件格式（cond）

```json
{"range":"B2:B13","type":"dataBar","color":"2F5496"}
{"range":"C2:C13","type":"colorScale","min":"F8696B","mid":"FFEB84","max":"63BE7B"}
{"range":"D2:D13","type":"cellIs","operator":"greaterThan","formula":["100"],
 "fill":"FFC7CE","font_color":"9C0006"}
```

operator 支持：`greaterThan / greaterThanOrEqual / lessThan / lessThanOrEqual /
equal / between / notBetween`。

## 图表（charts）

```json
{"type":"line","x":"month","y":["amount"],"title":"趋势","height_cm":8,"width_cm":12}
{"type":"bar","x":"month","y":["amount","cost"],"title":"对比"}   // 竖直柱状图
```

- `x` / `y` 必须是 sheet 的列 `key`（至少一列 y）。
- `anchor` 可选，缺省放在数据区右侧。

## 最小可用示例

```json
{
  "sheets": [
    {
      "name": "销售",
      "columns": [
        {"key": "month", "title": "月份", "width": 12},
        {"key": "amount", "title": "销售额", "numfmt": "#,##0"},
        {"key": "rate", "title": "完成率", "numfmt": "0.0%"}
      ],
      "rows": [
        {"month": "1月", "amount": 12000, "rate": 0.6},
        {"month": "2月", "amount": 15000, "rate": 0.75},
        {"month": "3月", "amount": 16000, "rate": 0.8}
      ],
      "freeze": "A2",
      "cond": [{"range": "B2:B4", "type": "dataBar", "color": "2F5496"}],
      "charts": [{"type": "line", "x": "month", "y": ["amount"], "title": "销售趋势"}]
    }
  ]
}
```

## 提醒

- 建议每个 sheet 一个主题；别把所有指标堆进一张表。
- 行数 > 5 万会在 summary 提示，优先压缩数据再生成。
- 公式依赖的单元格要先存在于同一 sheet。