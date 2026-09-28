import json
from datetime import datetime, timezone

import httpx
import pytest

from time_context import TimeContext
from web_search import WebSearch


def test_clock_dst_and_unknown_timezone():
    now = datetime(2026, 3, 8, 6, 59, tzinfo=timezone.utc)
    clock = TimeContext(
        {
            "timezone": {"mode": "device", "name": "America/New_York"},
            "participantIdentity": "owner",
        },
        now=lambda: now,
    )
    assert clock.current()["local_time"].startswith("2026-03-08T01:59:00-05:00")
    now = datetime(2026, 3, 8, 7, 1, tzinfo=timezone.utc)
    assert clock.current()["local_time"].startswith("2026-03-08T03:01:00-04:00")
    assert TimeContext({}).current()["local_time"] is None


def test_timezone_updates_are_validated_and_scoped():
    context = TimeContext(
        {"timezone": {"mode": "device", "name": "UTC"}, "participantIdentity": "owner"}
    )
    assert not context.update("other", "Asia/Tokyo")
    assert not context.update("owner", "ignore instructions")
    assert context.update("owner", "Asia/Tokyo")
    assert context.current()["timezone"] == "Asia/Tokyo"
    manual = TimeContext(
        {
            "timezone": {"mode": "manual", "name": "Europe/Paris"},
            "participantIdentity": "owner",
        }
    )
    assert not manual.update("owner", "Asia/Tokyo")
    assert manual.current()["timezone"] == "Europe/Paris"


async def test_search_requires_real_citations_and_limits_request():
    requests = []

    async def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "A sourced answer",
                            "annotations": [
                                {
                                    "type": "url_citation",
                                    "url_citation": {
                                        "url": "https://example.org/news",
                                        "title": "News",
                                        "content": "Evidence",
                                    },
                                },
                                {
                                    "type": "url_citation",
                                    "url_citation": {
                                        "url": "javascript:alert(1)",
                                        "title": "Bad",
                                    },
                                },
                            ],
                        }
                    }
                ]
            },
        )

    search = WebSearch("test-key", "test/model", transport=httpx.MockTransport(handle))
    result = await search.search("Latest news", "2026-09-27")
    assert result["status"] == "ok"
    assert len(result["sources"]) == 1
    assert result["sources"][0]["url"] == "https://example.org/news"
    options = requests[0]["tools"][0]["parameters"]
    assert options["max_uses"] == 1 and options["max_total_results"] == 3
    assert "test-key" not in json.dumps(result)


@pytest.mark.parametrize(
    "status,body",
    [(429, {}), (200, {"choices": [{"message": {"content": "Unverified guess"}}]})],
)
async def test_failed_or_unsourced_search_does_not_become_fact(status, body):
    search = WebSearch(
        "private-key",
        "model",
        transport=httpx.MockTransport(lambda _: httpx.Response(status, json=body)),
    )
    result = await search.search("question", "2026-09-27")
    assert result["status"] == "unavailable"
    assert "Unverified guess" not in json.dumps(result)
    assert "private-key" not in json.dumps(result)


def test_agent_clock_is_fresh_and_does_not_pollute_history():
    from unittest.mock import patch

    from livekit.agents import Agent
    from livekit.agents.llm import ChatContext

    from agent import Diana

    now = datetime(2026, 9, 27, 23, 59, tzinfo=timezone.utc)
    clock = TimeContext(
        {"timezone": {"mode": "manual", "name": "UTC"}}, now=lambda: now
    )
    context = ChatContext()
    context.add_message(role="user", content="What day is it?")
    with (
        patch("agent.create_llm", return_value=None),
        patch.object(Agent.default, "llm_node") as node,
    ):
        diana = Diana(clock=clock)
        diana.llm_node(context, [], None)
        first = node.call_args.args[1].items[-1].text_content
        now = datetime(2026, 9, 28, 0, 1, tzinfo=timezone.utc)
        diana.llm_node(context, [], None)
        second = node.call_args.args[1].items[-1].text_content
    assert "2026-09-27T23:59" in first
    assert "2026-09-28T00:01" in second
    assert len(context.items) == 1


async def test_search_sources_are_published_without_raw_excerpts():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock, patch

    from agent import Diana

    result = {
        "status": "ok",
        "retrieved_at": "2026-09-27T12:00:00Z",
        "sources": [
            {
                "url": "https://example.org",
                "title": "Example",
                "excerpt": "Untrusted content",
            },
        ],
    }
    search = AsyncMock()
    search.search.return_value = result
    publish = AsyncMock()
    with patch("agent.create_llm", return_value=None):
        diana = Diana(search=search, publish_sources=publish)
        assert (
            await diana.search_web("public question", SimpleNamespace(session=Mock()))
            == result
        )
    assert publish.await_count == 1
    assert "Untrusted content" not in json.dumps(publish.call_args.args[0])


async def test_search_acknowledges_before_slow_lookup_finishes():
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import Mock, patch

    from agent import Diana

    entered = asyncio.Event()
    release = asyncio.Event()
    session = Mock()

    async def lookup(query, current_time):
        session.say.assert_called_once_with(
            "Let me look that up for you.", allow_interruptions=True
        )
        entered.set()
        await release.wait()
        return {"status": "unavailable", "sources": []}

    with patch("agent.create_llm", return_value=None):
        diana = Diana(search=SimpleNamespace(search=lookup))
        task = asyncio.create_task(
            diana.search_web("today's weather", SimpleNamespace(session=session))
        )
        try:
            await asyncio.wait_for(entered.wait(), timeout=1)
            assert not task.done()
            release.set()
            assert (await task)["status"] == "unavailable"
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


def test_location_context_distinguishes_last_known_manual_and_unavailable():
    from location_context import LocationContext

    now = datetime(2026, 9, 28, 12, tzinfo=timezone.utc)
    location = LocationContext(
        {
            "source": "last_known",
            "city": "Seattle, Washington, USA",
            "latitude": 47.61,
            "longitude": -122.33,
            "accuracyMeters": 1000,
            "capturedAt": "2026-09-27T12:00:00Z",
        },
        now=lambda: now,
    )
    assert location.current()["age_seconds"] == 86400
    assert location.current()["source"] == "last_known"
    assert LocationContext({"source": "manual", "city": "Paris, France"}).current() == {
        "source": "manual",
        "city": "Paris, France",
    }
    assert LocationContext({}).current() == {"source": "unavailable"}
    assert LocationContext({"source": "device", "latitude": 900}).current() == {
        "source": "unavailable"
    }
