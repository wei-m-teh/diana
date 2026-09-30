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
    if not vision and model == "deepseek/deepseek-v4.1-flash":
        # The pinned with_openrouter helper does not expose extra_body. Use the
        # same Chat Completions endpoint to disable (not just hide) reasoning.
        return openai.LLM(
            model=model,
            api_key=key,
            base_url="https://openrouter.ai/api/v1",
            extra_body={"reasoning": {"enabled": False}},
        )
    return openai.LLM.with_openrouter(model=model, api_key=key)
