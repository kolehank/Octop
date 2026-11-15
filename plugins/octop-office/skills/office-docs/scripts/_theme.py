"""Office 文档主题模块：字体链、配色、页边距、单位换算。

所有生成脚本（make_docx.py / make_xlsx.py / make_pptx.py）共用本模块，
保证三种文件在字体、颜色、布局上使用一致的视觉语言与单位约定。

本模块只含纯函数和常量，不依赖任何 octop 内部代码，也没有第三方库导入
（python-docx / python-pptx 的字体设置辅助函数在内部按需导入）。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 单位换算（OOXML 内部统一以 EMU 为长度单位）
# ---------------------------------------------------------------------------
INCH = 914400  # 1 inch = 914400 EMU
CM = 360000  # 1 cm   = 360000 EMU
PT = 12700  # 1 pt   = 12700 EMU


def cm_to_emu(cm_value: float) -> int:
    """厘米 → EMU。"""
    return int(round(float(cm_value) * CM))


def inch_to_emu(inch_value: float) -> int:
    """英寸 → EMU。"""
    return int(round(float(inch_value) * INCH))


def pt_to_emu(pt_value: float) -> int:
    """磅 → EMU。"""
    return int(round(float(pt_value) * PT))


def emu_to_cm(emu: int) -> float:
    """EMU → 厘米。"""
    return emu / CM


def cm_to_inch(cm_value: float) -> float:
    """厘米 → 英寸。"""
    return float(cm_value) / 2.54


def parse_length(value: object, default_unit: str = "cm") -> float:
    """把 spec 里的长度解析成厘米。

    纯数字按 default_unit 解释；带单位字符串支持 cm / mm / in / inch / pt / px。
    例：parse_length("2.54cm") == 2.54，parse_length(30, "mm") == 3.0。
    """
    if isinstance(value, bool):
        raise ValueError("长度不能是布尔值")
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().lower()
    if not text:
        raise ValueError("长度不能为空")
    unit = default_unit
    for suffix in ("cm", "mm", "in", "inch", "pt", "px"):
        if text.endswith(suffix):
            unit = suffix
            text = text[: -len(suffix)].strip()
            break
    num = float(text)
    if unit == "mm":
        return num / 10.0
    if unit in ("in", "inch"):
        return num * 2.54
    if unit == "pt":
        return num * (2.54 / 72.0)
    if unit == "px":
        return num * (2.54 / 96.0)  # 按标准 96dpi 换算
    return num  # cm


# ---------------------------------------------------------------------------
# 配色（十六进制，不含 #）。spec 可用 "colors" 覆盖任意键。
# ---------------------------------------------------------------------------
PALETTE = {
    "primary": "2F5496",  # 深蓝：表头、标题强调、主色
    "accent": "C55A11",  # 橙：图表强调、色条
    "heading": "1F3864",  # 深蓝黑：标题文字
    "body": "333333",  # 正文灰黑
    "light": "DEEBF7",  # 浅蓝底：表头浅底、引用块
    "border": "BFBFBF",  # 表格边框灰
    "white": "FFFFFF",
    "ok": "538135",  # 绿（成功/达成）
    "warn": "BF8F00",  # 黄（警示）
    "danger": "C00000",  # 红（未达成/风险）
}


def merged_palette(colors: object | None) -> dict:
    """默认配色 + spec["colors"] 覆盖，返回新字典。"""
    out = dict(PALETTE)
    if not isinstance(colors, dict):
        return out
    for key, value in colors.items():
        if isinstance(value, str) and value.startswith("#"):
            value = value[1:]
        if key in out and value:
            out[key] = value
    return out


# ---------------------------------------------------------------------------
# 中文字体链：按优先级排列；缺字体时顺序回退，全缺失则告警而不是静默替换。
# ---------------------------------------------------------------------------
FONT_CHAIN = ["微软雅黑", "PingFang SC", "Noto Sans CJK SC", "DejaVu Sans"]

# 每个族在文件系统中的检出关键字（文件名小写后匹配）。
_FONT_TOKENS = {
    "微软雅黑": ("msyh", "yahei"),
    "PingFang SC": ("pingfang",),
    "Noto Sans CJK SC": ("notosanscjk", "notosanssc", "noto sans cjk", "sourcehansans"),
    "DejaVu Sans": ("dejavusans",),
}

_DETECT_CACHE: dict[str, bool] = {}


def _font_roots() -> list[Path]:
    if sys.platform.startswith("win"):
        windir = os.environ.get("WINDIR", r"C:\Windows")
        return [Path(windir) / "Fonts"]
    if sys.platform == "darwin":
        return [
            Path("/System/Library/Fonts"),
            Path("/Library/Fonts"),
            Path.home() / "Library" / "Fonts",
        ]
    return [Path("/usr/share/fonts"), Path("/usr/local/share/fonts")]


def _family_detected(family: str) -> bool:
    if family in _DETECT_CACHE:
        return _DETECT_CACHE[family]
    tokens = _FONT_TOKENS.get(family, (family.lower(),))
    found = False
    for root in _font_roots():
        if not root.is_dir():
            continue
        try:
            walker = os.walk(root)
            for _dir, _subs, files in walker:
                for name in files:
                    low = name.lower()
                    if low.endswith((".ttf", ".ttc", ".otf")) and any(
                        token in low for token in tokens
                    ):
                        found = True
                        break
                if found:
                    break
        except OSError:
            continue
        if found:
            break
    _DETECT_CACHE[family] = found
    return found


def available_fonts() -> dict:
    """扫描系统字体目录，返回 {族名: 是否检测到}。"""
    return {family: _family_detected(family) for family in FONT_CHAIN}


def resolve_font(preferred: str | None = None, chain: list[str] | None = None):
    """解析实际使用的字体名。

    返回 (字体名, 警告列表)。
    - preferred 非空时直接采用（通常来自 spec["font"]，允许强行指定任意字体）。
    - 否则按 chain（缺省 FONT_CHAIN）顺序取第一个检测到的字体。
    - 链上全部缺失时返回链首并在警告里明说，绝不静默替换。
    """
    order = list(chain) if chain else list(FONT_CHAIN)
    warnings: list[str] = []
    if preferred:
        return preferred, warnings
    for family in order:
        if _family_detected(family):
            return family, warnings
    warnings.append(
        "系统未检测到中文字体（" + " → ".join(order) + "），"
        "已回退使用 “" + order[0] + "”，请在目标机器确认该字体已安装，"
        "否则中文可能显示为方块。"
    )
    return order[0], warnings


# ---------------------------------------------------------------------------
# 字体设置的文档类辅助函数（按需导入对应库）
# ---------------------------------------------------------------------------
def set_docx_run_font(run, name: str) -> None:
    """python-docx Run：同时设置西文与中文（w:eastAsia）字体。"""
    from docx.oxml.ns import qn

    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rpr.get_or_add_rFonts().set(qn("w:eastAsia"), name)


def set_docx_style_font(style, name: str) -> None:
    """python-docx Style：设置默认西文与中文（w:eastAsia）字体。"""
    from docx.oxml.ns import qn

    style.font.name = name
    rpr = style.element.get_or_add_rPr()
    rpr.get_or_add_rFonts().set(qn("w:eastAsia"), name)


def set_pptx_run_font(run, name: str) -> None:
    """python-pptx Run：设置 latin + eastAsia + cs 三个 typeface。

    python-pptx 只暴露 a:latin，这里手工补 a:ea / a:cs 并保持 Schema 顺序。
    """
    from pptx.oxml.ns import qn

    run.font.name = name
    rpr = run._r.get_or_add_rPr()
    latin = rpr.get_or_add_latin()
    latin.set("typeface", name)
    ea = rpr.find(qn("a:ea"))
    if ea is None:
        ea = rpr.makeelement(qn("a:ea"), {})
        latin.addnext(ea)
    ea.set("typeface", name)
    cs = rpr.find(qn("a:cs"))
    if cs is None:
        cs = rpr.makeelement(qn("a:cs"), {})
        ea.addnext(cs)
    cs.set("typeface", name)
