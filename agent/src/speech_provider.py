"""Speech routing, with segment STT and raw streaming audio for OpenRouter.

The raw stream adapter is pinned to livekit-plugins-openai 1.5.17. Its default
TTS implementation assumes SSE for unknown models; OpenRouter returns bytes.
"""

import os

from livekit.agents import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions, inference
from livekit.plugins import openai
from livekit.plugins.openai.tts import AudioChunkedStream

from voices import Voice

OPENROUTER_URL = "https://openrouter.ai/api/v1"


def speech_provider() -> str:
    provider = os.getenv("DIANA_SPEECH_PROVIDER", "livekit").strip().lower()
    if provider not in {"livekit", "openrouter"}:
        raise ValueError("DIANA_SPEECH_PROVIDER must be livekit or openrouter")
    return provider


def _key() -> str:
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not key:
        raise ValueError("OPENROUTER_API_KEY is required for OpenRouter speech")
    return key


class OpenRouterTTS(openai.TTS):
    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> AudioChunkedStream:
        return AudioChunkedStream(tts=self, input_text=text, conn_options=conn_options)


def create_stt():
    if speech_provider() == "livekit":
        return inference.STT(model="deepgram/nova-3", language="multi")
    # AgentSession wraps non-streaming STT with its existing Silero VAD, so each
    # completed speech segment becomes a transcription request. No gateway used.
    return openai.STT(
        model="deepgram/nova-3",
        language="multi",
        use_realtime=False,
        base_url=OPENROUTER_URL,
        api_key=_key(),
    )


def create_tts(voice: Voice):
    provider = speech_provider()
    if provider == "livekit" or voice.model != "deepgram/aura-2":
        # Premium ElevenLabs/Cartesia voices retain their existing provider;
        # this migration only covers the verified Deepgram voice catalog.
        return inference.TTS(model=voice.model, voice=voice.voice)
    return OpenRouterTTS(
        model=voice.model,
        voice=f"aura-2-{voice.voice}-en",
        base_url=OPENROUTER_URL,
        api_key=_key(),
        response_format="mp3",
    )
