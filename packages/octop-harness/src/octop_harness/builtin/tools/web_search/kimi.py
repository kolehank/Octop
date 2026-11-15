"""Kimi (Moonshot AI) web search tool.

Uses Kimi's dedicated search endpoint (``/v1/tools/search_pro``), which
returns ranked pages plus the excerpts most relevant to the query. That is
one REST call with no model turn, so it neither burns chat rate limit nor
waits on reasoning — the same shape as the other search tools here.
Requires ``MOONSHOT_API_KEY``.

https://platform.kimi.com/docs/api/tools-search-pro
"""

from __future__ import annotations

import json
import os

import httpx
from langchain_core.tools import tool

DEFAULT_ENDPOINT = "https://api.moonshot.cn/v1/tools/search_pro"
DEFAULT_TIMEOUT = 60.0
# Per result, keep the tool output bounded: five pages of full text would
# otherwise dominate the agent's context.
_MAX_CHUNKS = 3
_MAX_TEXT_CHARS = 2000

_HTTP_ERRORS = {
    401: "Error: Kimi search authentication failed. Check MOONSHOT_API_KEY.",
    402: "Error: Kimi search account has insufficient balance.",
    403: "Error: Kimi search refused the request for this account.",
    429: "Error: Kimi search rate limit reached. Retry later.",
}


def _http_error(status_code: int, detail: str) -> str:
    known = _HTTP_ERRORS.get(status_code)
    if known is not None:
        return known
    suffix = f" {detail[:300]}" if detail else ""
    return f"Error: Kimi search returned HTTP {status_code}.{suffix}"


def _slim(item: dict[str, object]) -> dict[str, str]:
    """Keep the fields an agent can act on, dropping icons and scores."""
    out: dict[str, str] = {}
    for source, target in (
        ("title", "title"),
        ("url", "url"),
        ("site_name", "site"),
        ("date", "date"),
        ("snippet", "snippet"),
    ):
        value = item.get(source)
        if isinstance(value, str) and value.strip():
            out[target] = value.strip()
    raw_chunks = item.get("chunks")
    texts: list[str] = []
    for chunk in raw_chunks if isinstance(raw_chunks, list) else []:
        text = chunk.get("text") if isinstance(chunk, dict) else None
        if isinstance(text, str) and text.strip():
            texts.append(text.strip())
        if len(texts) >= _MAX_CHUNKS:
            break
    if texts:
        out["text"] = "\n".join(texts)[:_MAX_TEXT_CHARS]
    return out


@tool
async def kimi_search(query: str, limit: int = 5) -> str:  # noqa: PLR0911 - explicit API failures keep remediation clear
    """Search the web with Kimi (Moonshot) Search Pro and return ranked pages.

    Each result carries the title, URL, site, date, snippet and the page
    excerpts most relevant to the query, so the caller can quote and cite
    the sources itself.

    Args:
        query: Search query. Kimi searches it verbatim — no rewriting.
        limit: Number of results to return, 1 to 20. The default is 5.

    Returns:
        A JSON array of results, ``"No results found."``, or a plain-text
        error when the key is missing or the upstream call fails.
    """
    api_key = os.getenv("MOONSHOT_API_KEY", "").strip()
    if not api_key:
        return "Error: MOONSHOT_API_KEY environment variable is not set."
    clean_query = query.strip()
    if not clean_query:
        return "Error: Kimi search query must not be empty."
    if not 1 <= limit <= 20:
        return "Error: Kimi search limit must be between 1 and 20."

    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            response = await client.post(
                DEFAULT_ENDPOINT,
                headers={"Authorization": f"Bearer {api_key}"},
                json={"text_query": clean_query, "limit": limit, "timeout_seconds": 20},
            )
    except httpx.HTTPError as exc:
        return f"Error: Kimi search request failed: {exc}"

    if response.status_code >= 400:
        return _http_error(response.status_code, (response.text or "").strip())
    try:
        body = response.json()
    except ValueError:
        return "Error: Kimi search returned a non-JSON response."
    results = body.get("search_results") if isinstance(body, dict) else None
    if not isinstance(results, list):
        return "Error: Kimi search returned an invalid response."
    slimmed = [_slim(item) for item in results if isinstance(item, dict)]
    slimmed = [item for item in slimmed if item]
    return json.dumps(slimmed, ensure_ascii=False) if slimmed else "No results found."
