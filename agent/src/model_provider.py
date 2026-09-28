"""Backend-only model selection for conversation and camera analysis.

https://docs.livekit.io/agents/models/llm/openrouter/
"""

import os

from livekit.agents import inference, llm
from livekit.plugins import openai


def create_llm(*, vision: bool = False) -> llm.LLM:
    provider = os.getenv("DIANA_LLM_PROVIDER", "livekit").strip().lower()
    if provider == "livekit":
        return inference.LLM(model="openai/gpt-5.2-chat-latest")
    if provider != "openrouter":
        raise ValueError("DIANA_LLM_PROVIDER must be livekit or openrouter")
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    model = os.getenv("OPENROUTER_MODEL", "").strip()
    if not key:
        raise ValueError("OPENROUTER_API_KEY is required for OpenRouter")
    if not model:
        raise ValueError("OPENROUTER_MODEL is required for OpenRouter")
    if vision:
        model = os.getenv("OPENROUTER_VISION_MODEL", "").strip() or model
    # Never silently fall back to LiveKit Inference when OpenRouter is selected.
    return openai.LLM.with_openrouter(model=model, api_key=key)
