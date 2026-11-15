"""OpenDesign plugin backend — 稿件建/改/查、批注读取与 revision 冲突保护.

Registers five tools (``design_new`` / ``design_context`` / ``design_update`` /
``design_open`` / ``design_annotations``). Every tool returns a JSON string in
the ``octop_ui`` envelope so the Dashboard renders the ``design_canvas`` UI:

    {"octop_ui": {"renderer": "design_canvas", "version": 1},
     "data": {...}, "text": "..."}

Workspace / storage resolution (research note)
----------------------------------------------

Plugin tools run in-process (``octop_harness.plugins``), but the harness does
**not** hand them the agent's ``BackendWorkspace`` or resolved ``workspace_dir``:

* ``PluginContext`` (packages/octop-harness/src/octop_harness/plugins/context.py)
  only exposes ``plugin_id`` / ``source_path`` / ``model_factory`` /
  ``get_protocol``; tools are registered as **bare functions**.
* ``build_plugin_tools`` (plugins/tools.py) wraps them in plain
  ``StructuredTool.from_function(fn)`` with no closure over the workspace —
  unlike builtin tools (e.g. ``build_send_file_to_user_tool(self._workspace)``
  in packages/octop-harness/src/octop_harness/agent.py) which capture the
  workspace at construction time.
* The running agents live in ``HarnessAgentManager._registry`` (manager.py),
  an instance attribute of Octop's ``AgentManager``; there is no module-level
  singleton a plugin could reach.
* ``ctx.model_factory`` / ``ctx.get_protocol`` exist only for model access.

What IS available at tool call time: ``langgraph.config.get_config()`` →
``configurable``, which ``ChatRequest.to_runnable_config()``
(packages/octop-harness/src/octop_harness/request.py) stamps with
``thread_id`` / ``agent_id`` / ``user`` / ``source`` / ... Octop always sets
``agent_id`` (``_prepare_stream_request`` in src/octop/infra/agents/manager.py).

Decision / trade-off
^^^^^^^^^^^^^^^^^^^^

We resolve the **default agent workspace** as
``{AGENTBUDDY_HOME|OCTOP_HOME|~/.agentbuddy}/agents/<agent_id>/`` (same layout
as ``octop.infra.utils.paths.PathLayout.agent_workspace_dir``, mirrored here so
the plugin stays self-contained) and store documents workspace-relative at
``designs/<slug>/``.

* For default-configured agents this is byte-for-byte the directory the
  workspace HTTP API serves, so the Dashboard UI (`host.request` on
  ``GET/POST /agents/{id}/workspace/{download,upload}?...&from_workspace=true``)
  reads and writes the same files as the backend tools.
* Agents with a custom ``workspace_dir`` or a remote/docker backend are NOT
  covered by the in-process tools: their authoritative workspace is resolved
  per-agent by the harness resolver and cannot be observed from a plugin tool.
  For those agents the UI still targets the workspace API (its real workspace),
  while the tools here fall back to the default path — the mismatch is
  documented rather than silently bridged.
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
from pathlib import Path
from typing import Any

from octop_harness.plugins import PluginContext

from .design_store import (
    ACTIVE_ANNOTATION_STATUSES,
    DesignError,
    DesignExistsError,
    DesignNotFoundError,
    RevisionConflictError,
    consume_annotations,
    create_design,
    design_exists,
    list_designs,
    list_history,
    read_annotations,
    read_context,
    update_design,
)

# Model-visible workflow contract, inherited from the Cindy OpenDesign plugin.
TOOL_DESCRIPTION_TAIL = (
    "\n\nWorkflow (mandatory): call `design_context` before every `design_update` "
    "to load the current draft and revision, then update from that snapshot. "
    "Never rewrite a draft from memory. Use `design_annotations` to read user "
    "notes before editing; mark them consumed (`consume=true`) after applying."
)

RENDERER = "design_canvas"


# ---------------------------------------------------------------------------
# Runtime context
# ---------------------------------------------------------------------------


def _current_agent_id() -> str:
    """Agent id of the current graph run, or the ``OCTOP_DESIGN_AGENT_ID`` override.

    ``ChatRequest.to_runnable_config()`` stamps ``configurable.agent_id``; when
    the tool runs outside a graph (direct invocation / tests) the environment
    override keeps the tools addressable.
    """
    try:
        from langgraph.config import get_config

        cfg = get_config()
        if isinstance(cfg, dict):
            agent_id = (cfg.get("configurable") or {}).get("agent_id")
            if isinstance(agent_id, str) and agent_id.strip():
                return agent_id.strip()
    except Exception:
        pass
    return os.environ.get("OCTOP_DESIGN_AGENT_ID", "").strip()


def _current_call_id() -> str:
    """Best-effort identifier for the emitting call (graph run id, else random)."""
    try:
        from langgraph.config import get_config

        cfg = get_config()
        if isinstance(cfg, dict):
            run_id = cfg.get("run_id")
            if isinstance(run_id, str) and run_id:
                return run_id
    except Exception:
        pass
    return secrets.token_hex(4)


def resolve_design_base(agent_id: str) -> Path:
    """Default agent workspace for *agent_id* (see module docstring for trade-offs)."""
    home = (
        os.environ.get("AGENTBUDDY_HOME")
        or os.environ.get("OCTOP_HOME")
        or str(Path.home() / ".agentbuddy")
    ).strip()
    return Path(home) / "agents" / agent_id


def _store_error_data(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, RevisionConflictError):
        return {
            "ok": False,
            "status": "CONFLICT",
            "slug": exc.slug,
            "expected": exc.expected,
            "revision": exc.current,
            "reason": exc.reason,
            "message": str(exc),
        }
    if isinstance(exc, DesignNotFoundError):
        return {"ok": False, "status": "NOT_FOUND", "slug": exc.slug, "message": str(exc)}
    if isinstance(exc, DesignExistsError):
        return {"ok": False, "status": "EXISTS", "slug": exc.slug, "message": str(exc)}
    return {"ok": False, "status": "ERROR", "message": str(exc)}


def _envelope(data: dict[str, Any] | None, text: str) -> str:
    return json.dumps(
        {
            "octop_ui": {"renderer": RENDERER, "version": 1},
            "data": data,
            "text": text,
        },
        ensure_ascii=False,
    )


def _bind() -> tuple[str, Path] | None:
    agent_id = _current_agent_id()
    if not agent_id:
        return None
    return agent_id, resolve_design_base(agent_id)


async def _agent_or_error() -> tuple[str, Path, dict[str, Any] | None]:
    bound = _bind()
    if bound is None:
        return (
            "",
            Path("."),
            {
                "ok": False,
                "status": "NO_AGENT",
                "message": (
                    "cannot determine the current agent: plugin tools run inside an "
                    "agent turn; set OCTOP_DESIGN_AGENT_ID for direct invocation"
                ),
            },
        )
    return bound[0], bound[1], None


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


async def design_new(title: str, html: str, slug: str | None = None) -> str:
    """Create a new design draft at rev 1 (rejects an existing slug)."""
    agent_id, base, error = await _agent_or_error()
    if error is not None:
        return _envelope(error, str(error.get("message", "")))

    from .design_store import slugify  # noqa: PLC0415  (plugin-local helper)

    target = (slug or "").strip() or slugify(title)
    try:

        def _run() -> dict[str, Any]:
            meta = create_design(
                base,
                target,
                html,
                title=title,
                tool_call_id=_current_call_id(),
            )
            return {
                "ok": True,
                "slug": meta.slug,
                "title": meta.title,
                "revision": meta.rev,
                "html": html,
                "annotations": [],
                "history": [entry.to_dict() for entry in list_history(base, target)],
            }

        data = await asyncio.to_thread(_run)
    except DesignError as exc:
        data = _store_error_data(exc)
    return _envelope(
        data,
        data.get("ok")
        and f"已创建稿件 {target}（rev {data['revision']}）"
        or str(data.get("message", "")),
    )


async def design_context(slug: str | None = None) -> str:
    """Load a design's current draft + revision + annotations + history.

    Optional ``slug``: when omitted, lists every design so the agent can pick.
    """
    agent_id, base, error = await _agent_or_error()
    if error is not None:
        return _envelope(error, str(error.get("message", "")))

    target = (slug or "").strip().lower()
    if not target:
        designs = await asyncio.to_thread(list_designs, base)
        return _envelope(
            {
                "ok": True,
                "designs": designs,
                "message": "choose one of the existing designs and call again with its slug",
            },
            f"找到 {len(designs)} 个稿件",
        )

    def _run() -> dict[str, Any]:
        context = read_context(base, target)
        return {
            "ok": True,
            "slug": context["slug"],
            "title": context["title"],
            "revision": context["rev"],
            "sha256": context["sha256"],
            "updated_at": context["updated_at"],
            "html": context["html"],
            "annotations": context["annotations"],
            "history": context["history"],
        }

    try:
        data = await asyncio.to_thread(_run)
    except DesignError as exc:
        data = _store_error_data(exc)
    return _envelope(
        data, data.get("ok") and f"已读取稿件 {target}" or str(data.get("message", ""))
    )


async def design_update(
    html: str,
    expectedRevision: int,
    slug: str | None = None,
    title: str | None = None,
) -> str:
    """Overwrite a design at ``expectedRevision``; returns CONFLICT instead of clobbering."""
    agent_id, base, error = await _agent_or_error()
    if error is not None:
        return _envelope(error, str(error.get("message", "")))

    target = (slug or "").strip().lower()
    if not target:
        designs = await asyncio.to_thread(list_designs, base)
        return _envelope(
            {
                "ok": False,
                "status": "NEED_SLUG",
                "designs": designs,
                "message": "slug is required for design_update",
            },
            "design_update 需要 slug 参数",
        )

    def _run() -> dict[str, Any]:
        meta = update_design(
            base,
            target,
            html,
            expected_revision=int(expectedRevision),
            title=title or "",
            tool_call_id=_current_call_id(),
        )
        return {
            "ok": True,
            "slug": meta.slug,
            "title": meta.title,
            "revision": meta.rev,
            "html": html,
            "updated_at": meta.updated_at,
            "history": [entry.to_dict() for entry in list_history(base, target)],
        }

    try:
        data = await asyncio.to_thread(_run)
    except DesignError as exc:
        data = _store_error_data(exc)
    if data.get("ok"):
        text = f"已更新稿件 {target}（rev {data['revision']}）"
    elif data.get("status") == "CONFLICT":
        text = (
            f"稿件 {target} 冲突：期望 rev {data.get('expected')}，当前 rev "
            f"{data.get('revision')}（{data.get('reason')}）。未写入任何内容，"
            "请先调 design_context 重新读取最新稿再修改。"
        )
    else:
        text = str(data.get("message", ""))
    return _envelope(data, text)


async def design_open(slug: str) -> str:
    """Open the canvas for *slug* (UI-only payload: no html body)."""
    agent_id, base, error = await _agent_or_error()
    if error is not None:
        return _envelope(error, str(error.get("message", "")))

    target = slug.strip().lower()

    def _run() -> dict[str, Any]:
        if not design_exists(base, target):
            raise DesignNotFoundError(target)
        meta = read_context(base, target)
        return {
            "ok": True,
            "slug": meta["slug"],
            "title": meta["title"],
            "revision": meta["rev"],
            "updated_at": meta["updated_at"],
            "annotations": meta["annotations"],
            "history": meta["history"],
        }

    try:
        data = await asyncio.to_thread(_run)
    except DesignError as exc:
        data = _store_error_data(exc)
    return _envelope(
        data, data.get("ok") and f"已打开稿件 {target}" or str(data.get("message", ""))
    )


async def design_annotations(slug: str, consume: bool = False) -> str:
    """Read pending user annotations for *slug*; ``consume=true`` marks them done."""
    agent_id, base, error = await _agent_or_error()
    if error is not None:
        return _envelope(error, str(error.get("message", "")))

    target = (slug or "").strip().lower()
    mode = "consume" if consume else "read"

    def _run() -> list[dict[str, Any]]:
        if not design_exists(base, target):
            raise DesignNotFoundError(target)
        if consume:
            return consume_annotations(base, target)
        return read_annotations(base, target)

    try:
        annotations = await asyncio.to_thread(_run)
    except DesignError as exc:
        return _envelope(_store_error_data(exc), str(exc))
    pending = [a for a in annotations if a.get("status") in ACTIVE_ANNOTATION_STATUSES]
    return _envelope(
        {
            "ok": True,
            "slug": target,
            "mode": mode,
            "annotations": annotations,
            "pending_count": len(pending),
        },
        f"稿件 {target} 有 {len(pending)} 条待处理批注",
    )


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "design_new",
        design_new,
        description=(
            "Create a new design draft (OpenDesign). Returns the rendered HTML "
            "with a canvas UI. Rejects an existing slug — reuse design_update."
            + TOOL_DESCRIPTION_TAIL
        ),
        config_fields=[],
    )
    ctx.tool(
        "design_context",
        design_context,
        description=(
            "Load an OpenDesign draft: full HTML, current revision, annotations, "
            "and version history. Call this before every edit." + TOOL_DESCRIPTION_TAIL
        ),
        config_fields=[],
    )
    ctx.tool(
        "design_update",
        design_update,
        description=(
            "Save a new version of an OpenDesign draft. Takes expectedRevision "
            "from design_context; on mismatch it returns CONFLICT without "
            "overwriting anything." + TOOL_DESCRIPTION_TAIL
        ),
        config_fields=[],
    )
    ctx.tool(
        "design_open",
        design_open,
        description=(
            "Open an OpenDesign draft canvas in the dashboard (metadata only)."
            + TOOL_DESCRIPTION_TAIL
        ),
        config_fields=[],
    )
    ctx.tool(
        "design_annotations",
        design_annotations,
        description=(
            "Read user annotations left on an OpenDesign draft, and optionally "
            "mark them consumed after applying a fix." + TOOL_DESCRIPTION_TAIL
        ),
        config_fields=[],
    )
