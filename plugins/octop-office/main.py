"""Office 文档技能插件（kind=skill）。

技能插件不注册可调用工具，只通过 ctx.skills("skills") 声明技能目录。
Agent 启动时 octop 会把 skills/ 下每个含 SKILL.md 的子目录整目录复制到
工作区 skills/<name>/（SKILL.md 之外还包含 scripts/ 与 references/）。

脚本依赖（python-docx / python-pptx / openpyxl / pypdf）已在主依赖中，
本插件无需安装额外依赖。
"""

from __future__ import annotations

from octop_harness.plugins import PluginContext


def setup(ctx: PluginContext) -> None:
    # 相对插件根的目录；其下每个含 SKILL.md 的子目录是一项技能。
    ctx.skills("skills")
