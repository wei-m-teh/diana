"""Load the shared, deployment-versioned character for every client."""

from pathlib import Path

SOUL_PATH = Path(__file__).resolve().parents[1] / "SOUL.md"


def load_soul(path: Path = SOUL_PATH) -> str:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("Diana's SOUL.md is empty")
    return text
