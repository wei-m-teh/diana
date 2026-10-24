"""Diana's written life story (LIFE.md) and keyword recall over it."""

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

LIFE_PATH = Path(__file__).resolve().parents[1] / "LIFE.md"
LATELY = "Lately"
MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
STOPWORDS = {
    "the", "and", "you", "your", "her", "she", "was", "are", "for", "with",
    "about", "what", "how", "did", "does", "have", "has", "had", "any", "ever",
    "who", "when", "where", "why", "that", "this", "from", "like", "life",
}
NO_MATCH_NOTE = (
    "Your life story doesn't cover this. Don't invent it: say it never "
    "happened to you, or talk about something you do remember."
)


@dataclass(frozen=True)
class Memory:
    section: str
    title: str
    keywords: frozenset[str]
    text: str


def _words(text: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-zà-ÿ']+", text.lower())
        if len(w) > 2 and w not in STOPWORDS
    }


def load_life(path: Path = LIFE_PATH) -> list[Memory]:
    memories: list[Memory] = []
    section = title = None
    keywords: set[str] = set()
    body: list[str] = []

    def flush():
        if title and body:
            memories.append(
                Memory(section, title, frozenset(keywords), " ".join(body).strip())
            )

    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            flush()
            section, title, keywords, body = line[3:].strip(), None, set(), []
        elif line.startswith("### "):
            flush()
            title, keywords, body = line[4:].strip(), set(), []
        elif title and line.startswith("Keywords:"):
            keywords = {k.strip().lower() for k in line[9:].split(",") if k.strip()}
        elif title and line.strip():
            body.append(line.strip())
    flush()
    if not memories:
        raise ValueError("Diana's LIFE.md has no memories")
    return memories


class LifeStory:
    def __init__(self, memories: list[Memory] | None = None, *, now=None):
        self._memories = memories if memories is not None else load_life()
        self._now = now or (lambda: datetime.now(timezone.utc))

    def _current(self) -> list[Memory]:
        month = MONTHS[self._now().month - 1]
        return [
            m for m in self._memories
            if m.section != LATELY or m.title == month
        ]

    def topics(self) -> list[str]:
        return sorted({m.section for m in self._memories})

    def recall(self, topic: str, limit: int = 3) -> dict:
        query = _words(topic[:300]) if isinstance(topic, str) else set()
        phrase = topic.lower() if isinstance(topic, str) else ""
        scored = []
        for m in self._current():
            kw_words = set().union(*(_words(k) for k in m.keywords)) if m.keywords else set()
            score = (
                3 * len(query & kw_words)
                + 3 * sum(1 for k in m.keywords if " " in k and k in phrase)
                + 2 * len(query & _words(m.title))
                + len(query & _words(m.text))
            )
            if score:
                scored.append((score, m))
        scored.sort(key=lambda pair: -pair[0])
        found = [
            {"section": m.section, "title": m.title, "memory": m.text}
            for _, m in scored[:limit]
        ]
        if not found:
            return {"memories": [], "note": NO_MATCH_NOTE, "topics": self.topics()}
        return {"memories": found}
