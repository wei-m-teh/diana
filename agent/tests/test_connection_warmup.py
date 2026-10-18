import asyncio

import httpx

from connection_warmup import ConnectionWarmup


async def test_warmup_is_nonblocking_single_request_and_sends_no_content():
    started, release = asyncio.Event(), asyncio.Event()
    requests = []

    async def handler(request):
        requests.append(request)
        started.set()
        await release.wait()
        return httpx.Response(405)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        warm = ConnectionWarmup(client, "https://api.example.org/")
        warm.start()
        warm.start()
        await asyncio.wait_for(started.wait(), 1)
        assert len(requests) == 1
        assert requests[0].method == "HEAD"
        assert requests[0].content == b""
        assert "authorization" not in requests[0].headers
        await warm.close()
        assert not client.is_closed
        warm.start()
        assert len(requests) == 1


async def test_failed_warmup_does_not_break_session():
    async def handler(request):
        raise httpx.ConnectError("private connection detail")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        warm = ConnectionWarmup(client, "https://api.example.org/")
        warm.start()
        await warm.task
        await warm.close()


def test_latency_samples_keep_only_stage_timings():
    from types import SimpleNamespace

    from connection_warmup import latency_sample

    counts = {}
    metric = SimpleNamespace(
        type="tts_metrics", ttfb=0.25, text="private", api_key="private"
    )
    assert latency_sample(metric, counts) == {
        "stage": "tts_metrics",
        "sample": 1,
        "milliseconds": 250,
    }
    assert latency_sample(metric, counts)["sample"] == 2
    metric.cancelled = True
    assert latency_sample(metric, counts) is None


async def test_pinned_openai_adapter_warms_same_pool_then_stops_on_close():
    from openai import AsyncOpenAI

    from model_provider import WarmOpenRouterLLM

    requests = []

    async def handle(request):
        requests.append(request)
        return httpx.Response(200)

    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http,
        AsyncOpenAI(api_key="private", http_client=http) as client,
    ):
        model = WarmOpenRouterLLM(model="test", client=client)
        model.prewarm()
        await model._connection_warmup.task
        assert len(requests) == 1 and requests[0].method == "HEAD"
        assert "authorization" not in requests[0].headers
        await model.aclose()
        model.prewarm()
        assert len(requests) == 1
