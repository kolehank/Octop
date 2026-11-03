"""Big-screen session model (ADR 004) — key validation, scope listing, title strip."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.sessions import SessionRepo
from octop.infra.db.repos.thread_messages import ThreadMessageInput, ThreadMessageRepo
from octop.infra.db.repos.threads import ThreadRepo
from octop.infra.db.repos.users import UserRepo
from octop.infra.gateway.threads import (
    ThreadRegistry,
    is_valid_screen_key,
    screen_topic_prefix,
    strip_s2_page_prefix,
)

AGENT = "a1"
USER = 1


@pytest.fixture
def ctx(tmp_path: Path) -> SimpleNamespace:
    db = SqlitePool(tmp_path / "agentbuddy.db")
    run_migrations(db)
    UserRepo(db).create(username="u", password_hash="h", role="user")
    AgentRepo(db).create(agent_id=AGENT, user_id=USER, name="Agent 1")
    return SimpleNamespace(
        registry=ThreadRegistry(session_repo=SessionRepo(db), thread_repo=ThreadRepo(db)),
        message_repo=ThreadMessageRepo(db),
    )


async def _screen_thread(
    ctx: SimpleNamespace, *, screen_key: str, title: str | None = None
) -> tuple[str, str]:
    sk = ThreadRegistry.screen_key(agent_id=AGENT, user_id=USER, screen_key=screen_key)
    tid = await ctx.registry.reset(
        agent_id=AGENT,
        user_id=USER,
        channel_type=ThreadRegistry.CHANNEL_DASHBOARD,
        channel_subject_id=str(USER),
        channel_chat_type=f"screen:{screen_key}",
    )
    if title:
        ctx.registry.set_title_if_null(tid, title)
    return sk, tid


async def _dashboard_thread(ctx: SimpleNamespace) -> str:
    return await ctx.registry.reset(
        agent_id=AGENT,
        user_id=USER,
        channel_type=ThreadRegistry.CHANNEL_DASHBOARD,
        channel_subject_id=str(USER),
    )


def _human_wire(content: str) -> str:
    return json.dumps(
        {"type": "human", "data": {"content": content, "additional_kwargs": {}}},
        ensure_ascii=False,
    )


# ── screenKey validation (ADR 004 D2) ────────────────────────────────────────


def test_valid_screen_keys() -> None:
    for key in (
        "demo/overview",
        "demo/investment",
        "demo/investment/region",
        "demo/investment/department/fagai"[:0] or "demo/topic_1/region",
        "demo/" + "a" * 115,
    ):
        assert is_valid_screen_key(key), key


def test_invalid_screen_keys() -> None:
    for key in (
        "",  # empty
        "demo",  # no second segment
        "overview",  # missing registered prefix
        "invest/demo",  # unknown prefix
        "demo/a:b",  # colon banned (session keys split on :)
        "demo/a%",  # LIKE wildcard banned
        "demo/a_b%x",  # % banned even mixed with _
        "demo/a b",  # no whitespace
        "demo/投资",  # CJK outside charset
        "demo/a?b",  # query chars banned
        "demo/a#b",
        "demo/a/b/c/d",  # more than 3 segments
        "demo/" + "a" * 116,  # over length cap
    ):
        assert not is_valid_screen_key(key), key


def test_underscore_and_hyphen_are_allowed() -> None:
    assert is_valid_screen_key("demo/over-view")
    assert is_valid_screen_key("demo/a_b")
    assert is_valid_screen_key("demo/topic/dim_1")


def test_screen_topic_prefix() -> None:
    assert screen_topic_prefix("demo/overview") == "demo/overview"
    assert screen_topic_prefix("demo/investment") == "demo/investment"
    assert screen_topic_prefix("demo/investment/region") == "demo/investment"
    assert screen_topic_prefix("demo/topic/dim") == "demo/topic"


def test_screen_key_method_builds_dashboard_channel_session_key() -> None:
    sk = ThreadRegistry.screen_key(agent_id="a1", user_id=7, screen_key="demo/investment")
    assert sk == "a1:dashboard:7:screen:demo/investment"
    assert ThreadRegistry.is_virtual_channel("dashboard")
    with pytest.raises(ValueError, match="invalid screen_key"):
        ThreadRegistry.screen_key(agent_id="a1", user_id=7, screen_key="demo/a:b")


# ── scope semantics (ADR 004 D7) ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_scope_screen_exact_match(ctx: SimpleNamespace) -> None:
    sk, tid = await _screen_thread(ctx, screen_key="demo/investment/region")
    await _screen_thread(ctx, screen_key="demo/investment")
    await _screen_thread(ctx, screen_key="demo/economic")
    await _dashboard_thread(ctx)

    rows = ctx.registry.list_threads(
        agent_id=AGENT, user_id=USER, scope="screen", screen_key="demo/investment/region"
    )
    assert [r.thread_id for r in rows] == [tid]
    assert {r.session_key for r in rows} == {sk}


@pytest.mark.asyncio
async def test_scope_topic_prefix_enforces_segment_boundary(ctx: SimpleNamespace) -> None:
    _, topic_tid = await _screen_thread(ctx, screen_key="demo/investment")
    _, region_tid = await _screen_thread(ctx, screen_key="demo/investment/region")
    await _screen_thread(ctx, screen_key="demo/investmentx", title="lookalike")
    await _screen_thread(ctx, screen_key="demo/economic", title="other")
    await _dashboard_thread(ctx)

    rows = ctx.registry.list_threads(
        agent_id=AGENT, user_id=USER, scope="topic", screen_key="demo/investment/region"
    )
    ids = {r.thread_id for r in rows}
    assert ids == {topic_tid, region_tid}


@pytest.mark.asyncio
async def test_scope_all_dashboard_and_legacy(ctx: SimpleNamespace) -> None:
    _, screen_tid = await _screen_thread(ctx, screen_key="demo/overview")
    dash_tid = await _dashboard_thread(ctx)

    all_rows = ctx.registry.list_threads(agent_id=AGENT, user_id=USER, scope="all")
    assert {r.thread_id for r in all_rows} == {screen_tid}

    dash_rows = ctx.registry.list_threads(agent_id=AGENT, user_id=USER, scope="dashboard")
    assert {r.thread_id for r in dash_rows} == {dash_tid}

    legacy = ctx.registry.list_threads(agent_id=AGENT, user_id=USER)
    assert {r.thread_id for r in legacy} == {screen_tid, dash_tid}


@pytest.mark.asyncio
async def test_screen_bound_thread_deleted_reads_unbound(ctx: SimpleNamespace) -> None:
    sk, tid = await _screen_thread(ctx, screen_key="demo/overview")
    assert ctx.registry.get_bound_thread_id(sk) == tid
    ctx.registry.delete_thread(tid)
    assert ctx.registry.get_bound_thread_id(sk) is None
    # Recreate path: reset makes a new thread and rebinds the same session key.
    tid2 = await ctx.registry.reset(
        agent_id=AGENT,
        user_id=USER,
        channel_type=ThreadRegistry.CHANNEL_DASHBOARD,
        channel_subject_id=str(USER),
        channel_chat_type="screen:demo/overview",
    )
    assert tid2 != tid
    assert ctx.registry.get_bound_thread_id(sk) == tid2
    # The deleted thread is physically gone; only the recreated one lists.
    assert {r.thread_id for r in ctx.registry.list_threads_for_session(session_key=sk)} == {
        tid2,
    }


# ── q / LIKE escaping ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_q_matches_title_with_escaped_wildcards(ctx: SimpleNamespace) -> None:
    _, wild_tid = await _screen_thread(ctx, screen_key="demo/economic", title="project_2024%Q1")
    await _screen_thread(ctx, screen_key="demo/investment", title="projectX2024YQ1")

    rows = ctx.registry.list_threads(agent_id=AGENT, user_id=USER, q="project_2024%Q1")
    assert [r.thread_id for r in rows] == [wild_tid]


@pytest.mark.asyncio
async def test_q_underscore_does_not_wildcard(ctx: SimpleNamespace) -> None:
    await _screen_thread(ctx, screen_key="demo/economic", title="abc_xyz")
    await _screen_thread(ctx, screen_key="demo/investment", title="abcXxyz")
    rows = ctx.registry.list_threads(agent_id=AGENT, user_id=USER, q="abc_xyz")
    # Only the literal-underscore title matches; \_ is not a wildcard.
    assert len(rows) == 1
    assert rows[0].title == "abc_xyz"


@pytest.mark.asyncio
async def test_q_matches_first_user_message_text(ctx: SimpleNamespace) -> None:
    sk, tid = await _screen_thread(ctx, screen_key="demo/economic")
    ctx.message_repo.append_if_ready(
        tid,
        [
            ThreadMessageInput(
                message_id="m1",
                role="human",
                message_json=_human_wire("投资50%以上" if False else "帮我看看招商数据%"),
                created_at=1,
            )
        ],
    )
    rows = ctx.registry.list_threads(agent_id=AGENT, user_id=USER, q="招商数据")
    assert {r.thread_id for r in rows} == {tid}
    rows_only = ctx.registry.list_threads(agent_id=AGENT, user_id=USER, q="招商数据x")
    assert rows_only == []
    # A % in the stored message matches a literal % query safely.
    rows_pct = ctx.registry.list_threads(agent_id=AGENT, user_id=USER, q="数据%")
    assert {r.thread_id for r in rows_pct} == {tid}


@pytest.mark.asyncio
async def test_first_user_text_returns_raw_then_strip(ctx: SimpleNamespace) -> None:
    _, tid = await _screen_thread(ctx, screen_key="demo/economic")
    ctx.message_repo.append_if_ready(
        tid,
        [
            ThreadMessageInput(
                message_id="m1",
                role="human",
                message_json=_human_wire(
                    "〔当前页：招商（仅供参考，以用户问题为准）〕帮我分析投资"
                ),
                created_at=1,
            )
        ],
    )
    raw = ctx.message_repo.first_user_text(tid)
    assert raw == "〔当前页：招商（仅供参考，以用户问题为准）〕帮我分析投资"
    assert strip_s2_page_prefix(raw) == "帮我分析投资"
    assert ctx.message_repo.first_user_text("thr_missing") is None


# ── pagination ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_pagination_limit_offset(ctx: SimpleNamespace) -> None:
    tids = []
    for _ in range(5):
        _sk, tid = await _screen_thread(ctx, screen_key="demo/overview")
        tids.append(tid)
    expected = set(tids)

    page0 = ctx.registry.list_threads(
        agent_id=AGENT, user_id=USER, scope="screen", screen_key="demo/overview", limit=2
    )
    assert len(page0) == 2
    page1 = ctx.registry.list_threads(
        agent_id=AGENT,
        user_id=USER,
        scope="screen",
        screen_key="demo/overview",
        limit=2,
        offset=2,
    )
    assert len(page1) == 2
    tail = ctx.registry.list_threads(
        agent_id=AGENT,
        user_id=USER,
        scope="screen",
        screen_key="demo/overview",
        limit=2,
        offset=4,
    )
    assert len(tail) == 1
    seen = {r.thread_id for r in [*page0, *page1, *tail]}
    assert seen == expected
    assert (
        len(
            {r.thread_id for r in page0}
            | {r.thread_id for r in page1}
            | {r.thread_id for r in tail}
        )
        == 5
    )


# ── S2 prefix stripping (ADR 003 D10 / ADR 004 D9) ───────────────────────────


def test_strip_s2_page_prefix_matches_exact_fixed_format() -> None:
    assert (
        strip_s2_page_prefix("〔当前页：招商（仅供参考，以用户问题为准）〕帮我分析") == "帮我分析"
    )
    assert (
        strip_s2_page_prefix("〔当前页：招商/投资（仅供参考，以用户问题为准）〕帮我分析")
        == "帮我分析"
    )
    assert strip_s2_page_prefix("〔当前页：招商（仅供参考，以用户问题为准）〕") == ""
    assert strip_s2_page_prefix("〔当前页：另类前缀〕帮我分析") == "〔当前页：另类前缀〕帮我分析"
    assert (
        strip_s2_page_prefix("〔当前页：招商（仅供参考）〕帮我分析")
        == "〔当前页：招商（仅供参考）〕帮我分析"
    )
    assert strip_s2_page_prefix("聊聊招商") == "聊聊招商"


def test_touch_thread_after_turn_strips_s2_prefix_from_autotitle() -> None:
    from octop.infra.gateway.process.processor import GlobalProcessor

    proc = GlobalProcessor.__new__(GlobalProcessor)
    proc._thread_registry = MagicMock()
    proc._touch_thread_after_turn(
        "thr_1", "〔当前页：招商（仅供参考，以用户问题为准）〕帮我分析投资"
    )
    proc._thread_registry.touch_last_active.assert_called_once_with("thr_1")
    proc._thread_registry.set_title_if_null.assert_called_once_with("thr_1", "帮我分析投资")


def test_touch_thread_after_turn_keeps_plain_autotitle() -> None:
    from octop.infra.gateway.process.processor import GlobalProcessor

    proc = GlobalProcessor.__new__(GlobalProcessor)
    proc._thread_registry = MagicMock()
    proc._touch_thread_after_turn("thr_1", "帮我分析投资")
    proc._thread_registry.set_title_if_null.assert_called_once_with("thr_1", "帮我分析投资")
