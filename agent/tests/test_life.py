from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from agent import Diana
from life import LifeStory, load_life
from soul import load_soul


def story(month):
    return LifeStory(now=lambda: datetime(2026, month, 5, tzinfo=timezone.utc))


def test_life_file_parses_with_every_lately_month():
    memories = load_life()
    lately = [m.title for m in memories if m.section == "Lately"]
    assert len(lately) == 12
    assert all(m.text and m.keywords for m in memories)


def test_recall_finds_relevant_memories():
    titles = [m["title"] for m in story(10).recall("my grandmother")["memories"]]
    assert "Avó Rosa's bakery" in titles
    first = story(10).recall("first job")["memories"][0]["title"]
    assert first == "First job: the café disaster"


def test_lately_returns_only_the_current_month():
    october = story(10).recall("what's new lately")["memories"]
    assert [m["title"] for m in october if m["section"] == "Lately"] == ["October"]
    march = story(3).recall("what's new lately")["memories"]
    assert "October" not in [m["title"] for m in march]


def test_unknown_topic_says_not_to_invent():
    result = story(10).recall("skydiving in Peru")
    assert result["memories"] == []
    assert "Don't invent" in result["note"]
    assert "Lisbon, now" in result["topics"]


def test_empty_life_file_fails_explicitly(tmp_path):
    empty = tmp_path / "LIFE.md"
    empty.write_text("# Diana's life\n")
    with pytest.raises(ValueError):
        load_life(empty)


def test_agent_exposes_recall_and_soul_keeps_ai_honesty():
    with patch("agent.create_llm", return_value=None):
        diana = Diana()
    assert "recall_my_life" in [t.id for t in diana.tools]
    soul = load_soul()
    assert "recall_my_life" in soul
    assert "Never claim to be human" in soul
