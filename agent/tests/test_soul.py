from pathlib import Path
from unittest.mock import patch

import pytest

from agent import Diana
from soul import load_soul


def test_shared_soul_is_loaded_independently_of_working_directory(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    text = load_soul()
    assert text == (Path(__file__).resolve().parents[1] / "SOUL.md").read_text().strip()
    assert "## Core character" in text


def test_missing_or_empty_soul_fails_explicitly(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_soul(tmp_path / "missing.md")
    empty = tmp_path / "empty.md"
    empty.write_text("  ")
    with pytest.raises(ValueError, match="empty"):
        load_soul(empty)


def test_shared_soul_reaches_mobile_and_web_without_losing_operational_rules():
    for traits in (
        None,
        dict.fromkeys(
            [
                "openness",
                "conscientiousness",
                "extraversion",
                "agreeableness",
                "neuroticism",
            ],
            90,
        ),
    ):
        with patch("agent.create_llm", return_value=None):
            prompt = Diana(personality=traits).instructions
        assert prompt.count(load_soul()) == 1
        assert "## Core character" in prompt
        assert "Ground every claim" in prompt
        assert "read_web_page" in prompt
        assert "Your replies are spoken aloud" in prompt
        assert "# Who you are" not in prompt
        if traits:
            assert prompt.index("## Core character") < prompt.index("Openness (90/100)")
