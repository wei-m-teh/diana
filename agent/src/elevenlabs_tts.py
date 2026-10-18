"""Direct ElevenLabs HTTP audio streaming compatible with Eleven v4.

The SDK segments incoming text for this non-input-streaming TTS provider. Each
segment's PCM response is forwarded as it arrives, without buffering the reply.
"""

import re

import httpx
from livekit.agents import (
    DEFAULT_API_CONNECT_OPTIONS,
    APIConnectionError,
    APIConnectOptions,
    APIStatusError,
    APITimeoutError,
    tts,
)

from connection_warmup import ConnectionWarmup


class ElevenLabsTTS(tts.TTS):
    def __init__(
        self,
        *,
        api_key: str,
        voice_id: str,
        model: str = "eleven_v4",
        client: httpx.AsyncClient | None = None,
    ):
        if not api_key.strip():
            raise ValueError("ELEVENLABS_API_KEY is required")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", voice_id):
            raise ValueError("ELEVENLABS_VOICE_ID must be a provider voice ID")
        if not model.strip():
            raise ValueError("ELEVENLABS_TTS_MODEL must not be empty")
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=24000,
            num_channels=1,
        )
        self._api_key = api_key
        self.voice_id = voice_id
        self._model = model
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            limits=httpx.Limits(keepalive_expiry=120)
        )
        self._connection_warmup = ConnectionWarmup(
            self._client, "https://api.elevenlabs.io/v1/models"
        )

    @property
    def model(self) -> str:
        return self._model

    @property
    def provider(self) -> str:
        return "ElevenLabs"

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        return ElevenLabsChunkedStream(
            tts=self, input_text=text, conn_options=conn_options
        )

    def prewarm(self):
        self._connection_warmup.start()

    async def aclose(self):
        await self._connection_warmup.close()
        if self._owns_client:
            await self._client.aclose()


class ElevenLabsChunkedStream(tts.ChunkedStream):
    def __init__(
        self, *, tts: ElevenLabsTTS, input_text: str, conn_options: APIConnectOptions
    ):
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._tts = tts

    async def _run(self, output_emitter: tts.AudioEmitter):
        try:
            async with self._tts._client.stream(
                "POST",
                f"https://api.elevenlabs.io/v1/text-to-speech/{self._tts.voice_id}/stream",
                headers={"xi-api-key": self._tts._api_key},
                params={"output_format": "pcm_24000"},
                json={"text": self.input_text, "model_id": self._tts.model},
                timeout=httpx.Timeout(30, connect=self._conn_options.timeout),
            ) as response:
                request_id = response.headers.get("request-id", "")
                if response.status_code != 200:
                    # Do not put provider error bodies (which can echo text) in logs.
                    raise APIStatusError(
                        "ElevenLabs speech request failed",
                        status_code=response.status_code,
                        request_id=request_id,
                        body=None,
                    )
                output_emitter.initialize(
                    request_id=request_id,
                    sample_rate=24000,
                    num_channels=1,
                    mime_type="audio/pcm",
                )
                async for chunk in response.aiter_bytes():
                    output_emitter.push(chunk)
                output_emitter.flush()
        except httpx.TimeoutException:
            raise APITimeoutError() from None
        except httpx.HTTPError:
            raise APIConnectionError("ElevenLabs speech connection failed") from None
