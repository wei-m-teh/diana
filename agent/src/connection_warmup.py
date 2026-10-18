"""Best-effort DNS/TCP/TLS warm-up; never synthesizes speech or runs inference."""

import asyncio
from contextlib import suppress

import httpx


class ConnectionWarmup:
    def __init__(self, client, url):
        self.client = client
        self.url = url
        self.task = None
        self.closed = False

    def start(self):
        if self.closed or self.task is not None:
            return
        # Construction without a running session loop is supported.
        with suppress(RuntimeError):
            self.task = asyncio.get_running_loop().create_task(self._run())

    async def _run(self):
        try:
            # Reuse the exact pool that serves real requests. No redirects,
            # credentials, prompts, user audio, or paid inference request.
            async with asyncio.timeout(3):
                await self.client.head(self.url, timeout=3, follow_redirects=False)
        except (httpx.HTTPError, asyncio.TimeoutError):
            pass

    async def close(self):
        self.closed = True
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task


class OpenRouterWarmupMixin:
    """Connection adapter for the pinned livekit-plugins-openai 1.5.17 client."""

    def prewarm(self):
        if getattr(self, "_warmup_closed", False):
            return
        if not hasattr(self, "_connection_warmup"):
            # The plugin owns an OpenAI client, which owns the HTTPX pool.
            self._connection_warmup = ConnectionWarmup(
                self._client._client, "https://openrouter.ai/api/v1/models"
            )
        self._connection_warmup.start()

    async def aclose(self):
        self._warmup_closed = True
        if hasattr(self, "_connection_warmup"):
            await self._connection_warmup.close()
        await super().aclose()


def latency_sample(metric, counters):
    """Allowlisted stage timings only: never transcript, audio or credentials."""
    stage = getattr(metric, "type", "")
    fields = {
        "llm_metrics": "ttft",
        "tts_metrics": "ttfb",
        "stt_metrics": "duration",
        "eou_metrics": "end_of_utterance_delay",
    }
    if stage not in fields or getattr(metric, "cancelled", False):
        return None
    seconds = getattr(metric, fields[stage], None)
    if not isinstance(seconds, (int, float)) or seconds < 0:
        return None
    counters[stage] = counters.get(stage, 0) + 1
    return {
        "stage": stage,
        "sample": counters[stage],
        "milliseconds": round(seconds * 1000),
    }
