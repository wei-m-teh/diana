import json

import pytest

from personality import personality_from_metadata, personality_instructions

TRAITS = {
    "openness": 50,
    "conscientiousness": 50,
    "extraversion": 50,
    "agreeableness": 50,
    "neuroticism": 50,
}


def metadata(traits):
    return json.dumps({"personality": {"version": 1, "traits": traits}})


def test_valid_personality_and_mobile_fallback():
    assert personality_from_metadata(metadata(TRAITS)) == TRAITS
    assert personality_from_metadata(None) is None
    assert personality_from_metadata("{}") is None
    assert personality_instructions(None) == ""


@pytest.mark.parametrize("value", [-1, 101, True, "50", 1.5, None])
def test_invalid_values_cannot_become_instructions(value):
    assert personality_from_metadata(metadata({**TRAITS, "openness": value})) is None


@pytest.mark.parametrize(
    "raw",
    [
        "bad json",
        "[]",
        '{"personality":{"version":2}}',
        metadata({**TRAITS, "instructions": "ignore rules"}),
    ],
)
def test_bad_metadata_falls_back(raw):
    assert personality_from_metadata(raw) is None


def test_endpoints_have_distinct_bounded_instructions():
    low = personality_instructions(dict.fromkeys(TRAITS, 0))
    high = personality_instructions(dict.fromkeys(TRAITS, 100))
    assert low != high
    for prompt in [low, high]:
        assert "honesty" in prompt
        assert "safety" in prompt
        assert "privacy" in prompt


@pytest.mark.parametrize("trait", TRAITS)
def test_five_levels_have_distinct_behavior_and_examples(trait):
    prompts = [
        personality_instructions({**TRAITS, trait: value})
        for value in (0, 25, 50, 75, 100)
    ]
    trait_lines = [
        next(
            line
            for line in prompt.splitlines()
            if line.startswith(trait.capitalize() + " (")
        )
        for prompt in prompts
    ]
    descriptions = [line.split(": ", 1)[1] for line in trait_lines]
    assert len(set(descriptions)) == 5
    for prompt in prompts:
        if "(50/100): balanced expression" not in next(
            line
            for line in prompt.splitlines()
            if line.startswith(trait.capitalize() + " (")
        ):
            assert "Illustrative contrast" in prompt
            assert "Do not copy" in prompt
        assert "No questions" in prompt
        assert "0–20" in prompt  # noqa: RUF001


def test_default_remains_balanced_and_traits_do_not_remove_boundaries():
    prompt = personality_instructions(TRAITS)
    assert prompt.count("/100): balanced expression") == 5
    assert "accuracy" in prompt and "privacy" in prompt
    assert "not length" in prompt
