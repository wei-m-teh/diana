import asyncio
import json

import httpx
import pytest
from livekit.agents import APIConnectOptions, APIStatusError, APITimeoutError

from elevenlabs_tts import ElevenLabsTTS


async def test_v4_streams_audio_before_response_finishes_and_keeps_tags():
    release = asyncio.Event()
    closed = asyncio.Event()
    requests = []

    class Audio(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"\x10\x00" * 4800
            await release.wait()
            yield b"\x20\x00" * 4800

        async def aclose(self):
            closed.set()

    async def handler(request):
        requests.append(request)
        return httpx.Response(
            200, stream=Audio(), headers={"request-id": "test-stream"}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        voice = ElevenLabsTTS(api_key="test-secret", voice_id="voice-id", client=client)
        async with voice.synthesize("[warmly] Good to hear from you.") as stream:
            first = await asyncio.wait_for(stream.__anext__(), timeout=3)
            assert first.frame.sample_rate == 24000
            assert first.frame.num_channels == 1
            assert not release.is_set()  # Audible frames before all audio is received.
            release.set()
            rest = [event async for event in stream]
        assert rest and closed.is_set()
        request = requests[0]
        assert request.url.host == "api.elevenlabs.io"
        assert request.url.path == "/v1/text-to-speech/voice-id/stream"
        assert request.url.params["output_format"] == "pcm_24000"
        assert request.headers["xi-api-key"] == "test-secret"
        assert "authorization" not in request.headers
        assert json.loads(request.content) == {
            "text": "[warmly] Good to hear from you.",
            "model_id": "eleven_v4",
        }
        await voice.aclose()
        assert (
            not client.is_closed
        )  # Caller-owned clients aren't closed by the adapter.


@pytest.mark.parametrize("status", [401, 429, 500])
async def test_provider_errors_surface_without_sensitive_body(status):
    async def handler(request):
        return httpx.Response(
            status, json={"detail": "private spoken text test-secret"}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        voice = ElevenLabsTTS(api_key="test-secret", voice_id="voice-id", client=client)
        with pytest.raises(APIStatusError) as error:
            async with voice.synthesize(
                "Hello", conn_options=APIConnectOptions(max_retry=0)
            ) as stream:
                await stream.collect()
        assert error.value.status_code == status
        assert "private spoken text" not in str(error.value)
        assert "test-secret" not in str(error.value)


async def test_timeout_is_reported():
    async def handler(request):
        raise httpx.ReadTimeout("timeout", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        voice = ElevenLabsTTS(api_key="test-secret", voice_id="voice-id", client=client)
        with pytest.raises(APITimeoutError):
            async with voice.synthesize(
                "Hello", conn_options=APIConnectOptions(max_retry=0)
            ) as stream:
                await stream.collect()


async def test_interruption_closes_stream():
    closed = asyncio.Event()

    class Audio(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"\x10\x00" * 4800
            await asyncio.Event().wait()

        async def aclose(self):
            closed.set()

    async def handler(request):
        return httpx.Response(200, stream=Audio())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        voice = ElevenLabsTTS(api_key="test-secret", voice_id="voice-id", client=client)
        async with voice.synthesize("Hello") as stream:
            await asyncio.wait_for(stream.__anext__(), 3)
        await asyncio.wait_for(closed.wait(), 3)
