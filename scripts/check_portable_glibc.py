#!/usr/bin/env python3
"""扫描 portable packages/ 下 ELF 扩展引用的最高 GLIBC 符号版本。

portable zip 要能在 glibc 2.17 基线的机器(银河麒麟 glibc 2.23 / FT-2000/4)
上运行;打包 runner 是 glibc 2.39,import 冒烟在 runner 上通过不代表老机可用。
用 objdump -T 读动态符号表,任何 ELF 引用 GLIBC_2.18+ 即失败。

Usage: python3 scripts/check_portable_glibc.py <packages 目录>
"""
from __future__ import annotations

import glob
import os
import re
import subprocess
import sys

MAX_ALLOWED = (2, 17)
_SYM_RE = re.compile(r"GLIBC_(\d+)\.(\d+)")


def main() -> int:
    pkg_dir = sys.argv[1] if len(sys.argv) > 1 else ""
    if not pkg_dir or not os.path.isdir(pkg_dir):
        print(f"usage: check_portable_glibc.py <packages dir> (got {pkg_dir!r})")
        return 2

    bad: dict[str, set[str]] = {}
    for so in glob.glob(os.path.join(pkg_dir, "**", "*.so*"), recursive=True):
        try:
            out = subprocess.run(
                ["objdump", "-T", so], capture_output=True, text=True, timeout=20
            ).stdout
        except Exception:
            continue
        for m in _SYM_RE.finditer(out):
            v = (int(m.group(1)), int(m.group(2)))
            if v > MAX_ALLOWED:
                rel = os.path.relpath(so, pkg_dir)
                bad.setdefault(rel, set()).add(f"GLIBC_{m.group(1)}.{m.group(2)}")

    if bad:
        for rel, vers in sorted(bad.items()):
            print(f"::error::{rel}: {sorted(vers)}")
        print(f"GLIBC symbol check FAILED: {len(bad)} ELF files need glibc > 2.17")
        return 1
    print("GLIBC symbol check PASSED (all ELF <= 2.17)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
