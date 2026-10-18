from unittest.mock import patch

import pytest

from speech_provider import OpenRouterTTS, create_stt, create_tts
from voices import get_voice


@pytest.fixture(autouse=True)
def provider_env(monkeypatch):
    for key in (
        "DIANA_TTS_PROVIDER",
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_VOICE_ID",
        "ELEVENLABS_TTS_MODEL",
        "OPENROUTER_TTS_MODEL",
        "OPENROUTER_TTS_VOICE",
    ):
        monkeypatch.delenv(key, raising=False)
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


async def test_elevenlabs_tts_does_not_change_stt(monkeypatch):
    monkeypatch.setenv("DIANA_TTS_PROVIDER", "elevenlabs")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "eleven-test-key")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "test-voice")
    from speech_provider import ElevenLabsTTS

    voice = create_tts(get_voice("delia"))
    stt = create_stt()
    try:
        assert isinstance(voice, ElevenLabsTTS)
        assert voice.model == "eleven_v4"
        assert voice.voice_id == "test-voice"
        assert not voice.capabilities.streaming  # HTTP audio; SDK segments text.
        assert str(stt._client.base_url) == "https://openrouter.ai/api/v1/"
    finally:
        await voice.aclose()
        await stt.aclose()


@pytest.mark.parametrize("missing", ["ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"])
def test_elevenlabs_requires_explicit_credentials_and_voice(monkeypatch, missing):
    monkeypatch.setenv("DIANA_TTS_PROVIDER", "elevenlabs")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "eleven-test-key")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "test-voice")
    monkeypatch.delenv(missing)
    with pytest.raises(ValueError, match=missing):
        create_tts(get_voice("delia"))


async def test_openrouter_tts_override_and_provider_switch(monkeypatch):
    monkeypatch.setenv("DIANA_TTS_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_TTS_MODEL", "vendor/speech-model")
    monkeypatch.setenv("OPENROUTER_TTS_VOICE", "provider-voice-id")
    voice = create_tts(get_voice("aria"))
    try:
        assert isinstance(voice, OpenRouterTTS)
        assert voice._opts.model == "vendor/speech-model"
        assert voice._opts.voice == "provider-voice-id"
    finally:
        await voice.aclose()
    monkeypatch.setenv("DIANA_TTS_PROVIDER", "livekit")
    with patch("speech_provider.inference.TTS") as gateway:
        create_tts(get_voice("delia"))
        gateway.assert_called_once_with(model="deepgram/aura-2", voice="delia")


def test_openrouter_override_pair_required(monkeypatch):
    monkeypatch.setenv("DIANA_TTS_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_TTS_MODEL", "vendor/speech")
    with pytest.raises(ValueError, match="OPENROUTER_TTS_VOICE"):
        create_tts(get_voice("delia"))


def test_explicit_openrouter_cannot_silently_use_livekit(monkeypatch):
    monkeypatch.setenv("DIANA_TTS_PROVIDER", "openrouter")
    with pytest.raises(ValueError, match="OpenRouter"):
        create_tts(get_voice("aria"))


def test_tts_provider_typo_rejected(monkeypatch):
    monkeypatch.setenv("DIANA_TTS_PROVIDER", "typo")
    with pytest.raises(ValueError, match="DIANA_TTS_PROVIDER"):
        create_tts(get_voice("delia"))


def test_legacy_premium_voice_routing_is_preserved():
    with patch("speech_provider.inference.TTS") as gateway:
        create_tts(get_voice("aria"))
        gateway.assert_called_once_with(
            model="elevenlabs/eleven_v3", voice="21m00Tcm4TlvDq8ikWAM"
        )


async def test_elevenlabs_model_can_be_selected(monkeypatch):
    monkeypatch.setenv("DIANA_TTS_PROVIDER", "elevenlabs")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "eleven-test-key")
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "test-voice")
    monkeypatch.setenv("ELEVENLABS_TTS_MODEL", "another-eleven-model")
    voice = create_tts(get_voice("delia"))
    assert voice.model == "another-eleven-model"
    await voice.aclose()
    assert voice._client.is_closed
