from livekit.agents import llm

from prompt import (
    CLOSING,
    EXAMPLES_CLOSE,
    VOICE_EXAMPLES,
    build_instructions,
    with_voice_examples,
)
from soul import load_soul

TRAITS = dict.fromkeys(
    ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"],
    90,
)


def test_character_opens_and_closes_the_prompt():
    for traits in (None, TRAITS):
        prompt = build_instructions(traits, media=True, attachments=True, camera=True)
        assert prompt.index(load_soul()) < prompt.index("# How this app works")
        assert prompt.endswith(CLOSING)
        if traits:
            assert prompt.index("Openness (90/100)") < prompt.index(CLOSING)


def test_app_rules_stay_compact_and_tool_rules_live_on_tools():
    prompt = build_instructions(None, media=True, attachments=True, camera=True)
    assert len(prompt) - len(load_soul()) < 4500
    assert "three pages" not in prompt


def test_voice_examples_sit_after_system_prompt_and_before_real_turns():
    context = llm.ChatContext.empty()
    context.add_message(role="system", content="instructions")
    context.add_message(role="user", content="real message")
    roles = [item.role for item in with_voice_examples(context).items]
    assert roles[0] == "system" and roles[-1] == "user"
    assert roles.count("assistant") == len(VOICE_EXAMPLES)
    assert context.items[-2].content == [EXAMPLES_CLOSE]
    assert context.items[-1].content == ["real message"]
