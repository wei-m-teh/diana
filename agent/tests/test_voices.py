"""Unit tests for per-user voice resolution (no LiveKit/network required)."""

from voices import DEFAULT_VOICE_KEY, VOICES, get_voice, voice_from_metadata


def test_default_when_no_metadata() -> None:
    assert voice_from_metadata(None).key == DEFAULT_VOICE_KEY
    assert voice_from_metadata("").key == DEFAULT_VOICE_KEY


def test_valid_voice_selected() -> None:
    v = voice_from_metadata('{"voice": "thalia"}')
    assert v.key == "thalia"
    assert v.model == "deepgram/aura-2"
    assert v.voice == "thalia"


def test_unknown_voice_falls_back_to_default() -> None:
    assert voice_from_metadata('{"voice": "does-not-exist"}').key == DEFAULT_VOICE_KEY


def test_malformed_metadata_falls_back() -> None:
    assert voice_from_metadata("not json").key == DEFAULT_VOICE_KEY
    assert voice_from_metadata("[1, 2, 3]").key == DEFAULT_VOICE_KEY
    assert voice_from_metadata('{"voice": 123}').key == DEFAULT_VOICE_KEY
    assert voice_from_metadata("{}").key == DEFAULT_VOICE_KEY


def test_pro_voice_resolves_to_correct_model() -> None:
    v = voice_from_metadata('{"voice": "aria"}')
    assert v.key == "aria"
    assert v.tier == "pro"
    assert v.model == "elevenlabs/eleven_v3"


def test_get_voice_default_for_none_and_unknown() -> None:
    assert get_voice(None).key == DEFAULT_VOICE_KEY
    assert get_voice("nope").key == DEFAULT_VOICE_KEY


def test_catalog_integrity() -> None:
    assert DEFAULT_VOICE_KEY in VOICES
    for key, v in VOICES.items():
        assert v.key == key  # dict key matches the Voice.key
        assert v.tier in {"free", "pro"}
        assert "/" in v.model  # provider/model form, e.g. deepgram/aura-2
        assert v.voice
        assert v.label
