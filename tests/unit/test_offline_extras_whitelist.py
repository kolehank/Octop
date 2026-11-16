"""offline_bundle.sh legacy extras 白名单守卫。

deploy-legacy extras 白名单(根包 pyproject)必须在解析期整链排除所有
缺 manylinux2014 轮子的重链包;上游给 harness 加新 feature extra 时,
若其依赖无 2014 档轮子而漏进白名单,本测试红——提示同步 deploy-legacy。

同时校验 deploy-full 与 deploy-legacy 的并集覆盖根包主 deps 的 harness
extras(standard/Docker 全量能力不回退)。
"""

from __future__ import annotations

import re
import subprocess
import tomllib
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
# pytest 会改 cwd;uv export 需在仓库根跑（pyproject 定位）。cwd 由传参显式指定。

# legacy 白名单导出不得出现的重链代表(各链的最深依赖,出现任何即失守)
LEGACY_FORBIDDEN = {
    # 云存储 SDK 链(object-storage extra)
    "oss2",
    "esdk-obs-python",
    "cos-python-sdk-v5",
    "crcmod",
    # Bedrock 链(bedrock extra;numpy>=2.3.2 与 2014 档天花板死锁)
    "langchain-aws",
    # remote COS/S3/PG 后端链(remote-backends extra;psycopg>=3.3.2 死锁)
    "deepagents-backends",
    # 键鼠控制链(desktop extra;pynput→evdev 无 2014 档)
    "pynput",
    "evdev",
    "mss",
}

# 主体功能代表:legacy 白名单导出必须保留
LEGACY_REQUIRED = [
    "fastapi",
    "uvicorn",
    "langchain-core",
    "langgraph",
    "openai",
    "anthropic",
    "tiktoken",
    "cryptography",
    "psycopg",
    "pypdf",
    "python-docx",
    "openpyxl",
    "playwright",
    "ldap3",
    "pyjwt",
    "webauthn",
    "edge-tts",
    "pydantic",
    "mcp",
    "pillow",
    # legacy 白名单保留的 harness extras
    "langchain-tavily",
    "langchain-community",
    "langfuse",
    "docker",
    "psutil",
    "agent-client-protocol",
    "google-api-python-client",
]

EXPORT_FLAGS = [
    "uv",
    "export",
    "--frozen",
    "--no-dev",
    "--no-hashes",
    "--no-emit-project",
    "--no-emit-package",
    "octop-harness",
    "--no-emit-package",
    "octop-gateway",
    "--no-emit-package",
    "octop-memory",
    "--no-emit-package",
    "octop-browser",
    "--format",
    "requirements-txt",
]


def _export(extra_args: list[str], tmp_path: Path) -> set[str]:
    out = tmp_path / "req.txt"
    proc = subprocess.run(
        [*EXPORT_FLAGS, *extra_args, "-o", str(out)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, f"uv export failed:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}"
    return {
        m.group(1).lower().replace("_", "-")
        for m in re.finditer(r"^([A-Za-z0-9_.-]+)==", out.read_text(), re.M)
    }


def _root_harness_extras(pyproject: dict) -> list[str]:
    """根包主 deps 里 octop-harness 声明的 extras。"""
    for dep in pyproject["project"]["dependencies"]:
        m = re.match(r"octop-harness\[([^\]]+)\]", dep)
        if m:
            return [e.strip() for e in m.group(1).split(",")]
    return []


@pytest.fixture(scope="module")
def root_pyproject() -> dict:
    with (REPO_ROOT / "pyproject.toml").open("rb") as f:
        return tomllib.load(f)


def test_legacy_whitelist_excludes_heavy_chains(tmp_path: Path) -> None:
    names = _export(["--no-all-extras", "--extra", "deploy-legacy"], tmp_path)
    leaked = sorted(LEGACY_FORBIDDEN & names)
    assert not leaked, (
        "deploy-legacy 白名单导出漏进重链包 "
        f"{leaked}——上游可能给 harness/根包加了新 extra,"
        "请同步根包 pyproject 的 deploy-legacy 白名单"
    )


def test_legacy_whitelist_keeps_core_stack(tmp_path: Path) -> None:
    names = _export(["--no-all-extras", "--extra", "deploy-legacy"], tmp_path)
    missing = [p for p in LEGACY_REQUIRED if p not in names]
    assert not missing, f"deploy-legacy 白名单缺失主体功能包: {missing}"


def test_deploy_full_restores_heavy_chains(tmp_path: Path, root_pyproject: dict) -> None:
    """standard/Docker 全量 = 默认主 deps + deploy-full;重链必须全部回来。"""
    names = _export(["--extra", "deploy-full"], tmp_path)
    leaked = sorted(LEGACY_FORBIDDEN & names)
    assert set(LEGACY_FORBIDDEN) <= names, (
        f"deploy-full 导出缺失重链包(standard 能力回退): {sorted(set(LEGACY_FORBIDDEN) - names)}"
    )
    assert not leaked or leaked == sorted(LEGACY_FORBIDDEN & names)


def test_legacy_harness_extras_are_subset_of_full(root_pyproject: dict) -> None:
    """deploy-legacy 点名的 harness extras ⊆ 主 deps 声明 + deploy-full 声明。

    防止白名单收了主 deps/全量组都没有的 extra(能力漂移)。
    """
    legacy = root_pyproject["project"]["optional-dependencies"]["deploy-legacy"]
    full = root_pyproject["project"]["optional-dependencies"]["deploy-full"]
    main_extras = set(_root_harness_extras(root_pyproject))
    full_extras: set[str] = set()
    for entry in full:
        m = re.match(r"octop-harness\[([^\]]+)\]", entry)
        if m:
            full_extras |= {e.strip() for e in m.group(1).split(",")}
    for entry in legacy:
        m = re.match(r"octop-harness\[([^\]]+)\]", entry)
        assert m, f"deploy-legacy 条目应为 harness extras 引用: {entry}"
        extras = {e.strip() for e in m.group(1).split(",")}
        unknown = extras - main_extras - full_extras
        assert not unknown, (
            f"deploy-legacy 引用了主 deps 与 deploy-full 都没有的 harness extra: {sorted(unknown)}"
        )
