"""Unit tests for chat SSE / WebSocket chunk serialization."""

from __future__ import annotations

import json

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from octop.api.routers.chat.serialize import (
    _legacy_stream_aggregate_indexes,
    _serialize_history_message,
)
from octop.api.routers.chat.sse import json_chunk_default


def test_legacy_stream_aggregate_is_dropped() -> None:
    """Old projections appended one id-less AI row concatenating the whole turn."""
    messages = [
        HumanMessage(content="查数据", id="u1"),
        AIMessage(content="正在搜索。\n\n", id="a1"),
        AIMessage(content="结论是 42。", id="a2"),
        AIMessage(content="正在搜索。\n\n结论是 42。"),  # synthetic aggregate
        HumanMessage(content="再查", id="u2"),
        AIMessage(content="好的。", id="a3"),
    ]
    message_ids = ["u1", "a1", "a2", None, "u2", "a3"]

    assert _legacy_stream_aggregate_indexes(messages, message_ids) == {3}


def test_legacy_stream_aggregate_is_dropped_when_page_starts_mid_turn() -> None:
    """History pages can begin mid-turn; the page text is a suffix of the aggregate."""
    messages = [
        AIMessage(content="第二段。\n\n", id="a2"),
        AIMessage(content="结论。", id="a3"),
        AIMessage(content="第一段。\n\n第二段。\n\n结论。"),  # aggregate for the full turn
    ]

    assert _legacy_stream_aggregate_indexes(messages, ["a2", "a3", None]) == {2}


def test_legacy_stream_aggregate_keeps_idless_message_with_new_text() -> None:
    messages = [
        HumanMessage(content="hi", id="u1"),
        AIMessage(content="hello"),
    ]

    assert _legacy_stream_aggregate_indexes(messages, ["u1", None]) == set()


def test_json_chunk_default_serializes_langchain_messages() -> None:
    chunk = {
        "type": "state_update",
        "node": "BootstrapMiddleware.before_agent",
        "data": {
            "messages": [
                SystemMessage(content="bootstrap"),
                HumanMessage(content="hi"),
                AIMessage(content="hello"),
            ],
        },
    }
    payload = json.dumps(chunk, default=json_chunk_default)
    parsed = json.loads(payload)
    assert parsed["type"] == "state_update"
    assert len(parsed["data"]["messages"]) == 3
    assert parsed["data"]["messages"][0]["content"] == "bootstrap"


def test_json_chunk_default_keeps_tool_message_artifact() -> None:
    """Live WS/SSE frames must carry the offloaded octop_ui payload."""
    msg = ToolMessage(
        content='{"octop_ui": {"renderer": "bilibili_player"}, "data_ref": "artifact"}',
        tool_call_id="call_1",
        name="bilibili_search_anime",
        artifact={"results": [{"season_id": 1, "episodes": [{"index": 1}]}]},
    )
    payload = json.dumps({"type": "tool_result", "messages": [msg]}, default=json_chunk_default)
    parsed = json.loads(payload)
    wire_msg = parsed["messages"][0]
    assert wire_msg["artifact"]["results"][0]["season_id"] == 1
    assert "episodes" not in wire_msg["content"]


def test_serialize_history_message_keeps_client_message_id() -> None:
    entry = _serialize_history_message(
        HumanMessage(content="画一张图", id="1710000000000-ab12cd"),
    )
    assert entry is not None
    assert entry["id"] == "1710000000000-ab12cd"


def test_serialize_history_message_includes_tool_artifact() -> None:
    msg = ToolMessage(
        content='{"octop_ui": {"renderer": "bilibili_player"}, "data_ref": "artifact"}',
        tool_call_id="call_1",
        name="bilibili_search_anime",
        artifact={"results": [{"season_id": 1}]},
    )
    entry = _serialize_history_message(msg)
    assert entry is not None
    block = entry["content"][0]
    assert block["type"] == "tool_result"
    assert block["artifact"]["results"][0]["season_id"] == 1


def test_serialize_history_message_includes_decision_savings() -> None:
    msg = AIMessage(
        content="done",
        usage_metadata={"input_tokens": 100, "output_tokens": 4, "total_tokens": 104},
        additional_kwargs={"context_usage": {"input_tokens": 100, "decision_saved": 5972}},
    )
    entry = _serialize_history_message(msg)
    assert entry is not None
    assert entry["usage"]["decision_saved"] == 5972


def test_serialize_history_message_keeps_decision_savings_without_provider_usage() -> None:
    msg = AIMessage(
        content="done",
        additional_kwargs={"context_usage": {"decision_saved": 5972}},
    )
    entry = _serialize_history_message(msg)
    assert entry is not None
    assert entry["usage"] == {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "decision_saved": 5972,
    }


def test_serialize_history_message_includes_decision() -> None:
    msg = AIMessage(
        content="done",
        additional_kwargs={
            "octop_decision": {
                "kind": "decision",
                "model": "typesafe/jev-1.13",
                "empty": False,
                "parts": [{"kind": "skill", "kept": [{"name": "pdf", "score": 0.9}]}],
            }
        },
    )
    entry = _serialize_history_message(msg)
    assert entry is not None
    assert entry["decision"]["model"] == "typesafe/jev-1.13"
    assert entry["decision"]["parts"][0]["kept"][0]["name"] == "pdf"


def test_serialize_history_message_omits_artifact_key_when_absent() -> None:
    msg = ToolMessage(content="found", tool_call_id="call_1", name="search")
    entry = _serialize_history_message(msg)
    assert entry is not None
    assert "artifact" not in entry["content"][0]
