from unittest.mock import patch

import pytest

from model_provider import create_llm


@pytest.fixture(autouse=True)
def clean_provider_env(monkeypatch):
    for key in (
        "DIANA_LLM_PROVIDER",
        "OPENROUTER_API_KEY",
        "OPENROUTER_MODEL",
        "OPENROUTER_VISION_MODEL",
    ):
        monkeypatch.delenv(key, raising=False)


def test_existing_livekit_default():
    with patch("model_provider.inference.LLM") as factory:
        assert create_llm() is factory.return_value
        factory.assert_called_once_with(model="openai/gpt-5.2-chat-latest")


@pytest.mark.parametrize(
    "vision,expected", [(False, "vendor/chat"), (True, "vendor/vision")]
)
def test_openrouter_routes_both_paths(monkeypatch, vision, expected):
    monkeypatch.setenv("DIANA_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "vendor/chat")
    monkeypatch.setenv("OPENROUTER_VISION_MODEL", "vendor/vision")
    with (
        patch("model_provider.openai.LLM.with_openrouter") as factory,
        patch("model_provider.inference.LLM") as livekit,
    ):
        assert create_llm(vision=vision) is factory.return_value
        assert factory.call_args.kwargs["model"] == expected
        assert factory.call_args.kwargs["api_key"] == "test-key"
        livekit.assert_not_called()


def test_vision_defaults_to_selected_model(monkeypatch):
    monkeypatch.setenv("DIANA_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "vendor/multimodal")
    with patch("model_provider.openai.LLM.with_openrouter") as factory:
        create_llm(vision=True)
        assert factory.call_args.kwargs["model"] == "vendor/multimodal"


@pytest.mark.parametrize("missing", ["OPENROUTER_API_KEY", "OPENROUTER_MODEL"])
def test_incomplete_config_fails_without_fallback(monkeypatch, missing):
    monkeypatch.setenv("DIANA_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "private-test-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "vendor/chat")
    monkeypatch.delenv(missing)
    with (
        patch("model_provider.inference.LLM") as livekit,
        pytest.raises(ValueError) as error,
    ):
        create_llm()
    assert missing in str(error.value)
    assert "private-test-key" not in str(error.value)
    livekit.assert_not_called()


def test_unknown_provider_rejected(monkeypatch):
    monkeypatch.setenv("DIANA_LLM_PROVIDER", "typo")
    with pytest.raises(ValueError, match="DIANA_LLM_PROVIDER"):
        create_llm()


async def test_real_plugin_uses_openrouter_endpoint(monkeypatch):
    monkeypatch.setenv("DIANA_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key-not-real")
    monkeypatch.setenv("OPENROUTER_MODEL", "vendor/chat")
    async with create_llm() as model:
        assert str(model._client.base_url) == "https://openrouter.ai/api/v1/"
        assert model.model == "vendor/chat"


async def test_deepseek_conversation_disables_reasoning_on_wire(monkeypatch):
    import json

    import httpx
    from livekit.agents import llm
    from openai import AsyncOpenAI

    monkeypatch.setenv("DIANA_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "deepseek/deepseek-v4.1-flash")
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text='data: {"id":"test","choices":[{"index":0,"delta":{"content":"Hi."},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
        )

    async with (
        httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http,
        AsyncOpenAI(api_key="test-key", http_client=http) as client,
        create_llm() as model,
    ):
        model._client = client
        context = llm.ChatContext()
        context.add_message(role="user", content="Hi")
        async with model.chat(chat_ctx=context) as stream:
            async for _ in stream:
                pass
    assert requests[0]["reasoning"] == {"enabled": False}
    assert requests[0]["model"] == "deepseek/deepseek-v4.1-flash"


def test_deepseek_vision_keeps_existing_reasoning_default(monkeypatch):
    monkeypatch.setenv("DIANA_LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "deepseek/deepseek-v4.1-flash")
    with patch("model_provider.openai.LLM.with_openrouter") as factory:
        create_llm(vision=True)
        factory.assert_called_once_with(
            model="deepseek/deepseek-v4.1-flash", api_key="test-key"
        )
