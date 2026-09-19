"""Catalog of selectable TTS voices for Diana, plus helpers to resolve the
per-session voice from agent dispatch metadata.

This catalog is the source of truth for which voices Diana can render. The
web/mobile voice picker and the token service mirror these keys. The token
service is responsible for enforcing which ``tier`` a user may select (e.g.
"pro" voices require a paid plan); the agent simply renders whatever valid
voice it is handed, falling back to the default for unknown/missing values so a
bad metadata payload can never break a live session.
"""

from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass(frozen=True)
class Voice:
    """A selectable voice, mapped to a concrete LiveKit Inference TTS model."""

    key: str  # stable identifier stored in the DB / sent in metadata
    label: str  # human-friendly name shown in the voice picker
    model: str  # LiveKit Inference TTS model, e.g. "deepgram/aura-2"
    voice: str  # provider voice id, e.g. "delia"
    tier: str  # entitlement tier: "free" or "pro"


# Source of truth for selectable voices. Keep keys stable: they are persisted in
# user settings and sent to the agent as metadata.
VOICES: dict[str, Voice] = {
    # Free tier — Deepgram Aura-2 (lowest cost).
    "delia": Voice("delia", "Delia — warm, friendly", "deepgram/aura-2", "delia", "free"),
    "thalia": Voice("thalia", "Thalia — clear, upbeat", "deepgram/aura-2", "thalia", "free"),
    "andromeda": Voice("andromeda", "Andromeda — calm", "deepgram/aura-2", "andromeda", "free"),
    "apollo": Voice("apollo", "Apollo — confident", "deepgram/aura-2", "apollo", "free"),
    "orion": Voice("orion", "Orion — deep", "deepgram/aura-2", "orion", "free"),
    # Pro tier — more expressive / pricier providers.
    "aria": Voice(
        "aria", "Aria — expressive", "elevenlabs/eleven_v3", "21m00Tcm4TlvDq8ikWAM", "pro"
    ),
    "nova": Voice(
        "nova", "Nova — lively", "cartesia/sonic-3", "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc", "pro"
    ),
}

DEFAULT_VOICE_KEY = "delia"


def get_voice(key: str | None) -> Voice:
    """Return the :class:`Voice` for ``key``, or the default if unknown/None."""
    if key and key in VOICES:
        return VOICES[key]
    return VOICES[DEFAULT_VOICE_KEY]


def voice_from_metadata(metadata: str | None) -> Voice:
    """Resolve the session voice from agent dispatch metadata.

    The token service encodes the user's chosen voice as JSON, e.g.
    ``'{"voice": "thalia"}'``. Malformed metadata, missing keys, or unknown
    voices all fall back to the default voice.
    """
    if not metadata:
        return get_voice(None)
    try:
        data = json.loads(metadata)
    except (json.JSONDecodeError, TypeError, ValueError):
        return get_voice(None)
    if not isinstance(data, dict):
        return get_voice(None)
    key = data.get("voice")
    return get_voice(key if isinstance(key, str) else None)
