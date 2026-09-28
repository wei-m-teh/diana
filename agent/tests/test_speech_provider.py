from unittest.mock import patch

import pytest

from speech_provider import OpenRouterTTS, create_stt, create_tts
from voices import get_voice


@pytest.fixture(autouse=True)
def provider_env(monkeypatch):
    monkeypatch.setenv("DIANA_SPEECH_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")


async def test_tts_uses_raw_audio_stream():
    from livekit.plugins.openai.tts import AudioChunkedStream

    tts = create_tts(get_voice("delia"))
    try:
        assert isinstance(tts, OpenRouterTTS)
        assert tts._opts.voice == "aura-2-delia-en"
        with patch(
            "speech_provider.AudioChunkedStream", wraps=AudioChunkedStream
        ) as factory:
            async with tts.synthesize("Hello."):
                factory.assert_called_once()
    finally:
        await tts.aclose()


@pytest.mark.parametrize("voice", ["delia", "thalia", "andromeda", "apollo", "orion"])
async def test_deepgram_voice_mapping(voice):
    tts = create_tts(get_voice(voice))
    assert tts._opts.voice == f"aura-2-{voice}-en"
    assert str(tts._client.base_url) == "https://openrouter.ai/api/v1/"
    await tts.aclose()


async def test_stt_uses_segment_transcription():
    stt = create_stt()
    assert stt.model == "deepgram/nova-3"
    assert not stt.capabilities.streaming
    assert not stt.capabilities.interim_results
    assert str(stt._client.base_url) == "https://openrouter.ai/api/v1/"
    await stt.aclose()


def test_missing_key_fails_without_gateway_fallback(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY")
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        create_stt()
    with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
        create_tts(get_voice("delia"))


def test_livekit_default_preserved(monkeypatch):
    monkeypatch.delenv("DIANA_SPEECH_PROVIDER")
    with (
        patch("speech_provider.inference.STT") as stt,
        patch("speech_provider.inference.TTS") as tts,
    ):
        assert create_stt() is stt.return_value
        assert create_tts(get_voice("delia")) is tts.return_value


def test_typo_rejected(monkeypatch):
    monkeypatch.setenv("DIANA_SPEECH_PROVIDER", "typo")
    with pytest.raises(ValueError, match="DIANA_SPEECH_PROVIDER"):
        create_stt()
