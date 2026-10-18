"""Save current slider prompts for a later before/after evaluation (no API calls)."""

import argparse
import json
from pathlib import Path
from unittest.mock import patch

from agent import Diana
from personality import TRAIT_KEYS

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
args = parser.parse_args()
with patch("agent.create_llm", return_value=None):
    prompts = {
        f"{trait}:{level}": Diana(
            personality={**dict.fromkeys(TRAIT_KEYS, 50), trait: level}
        ).instructions
        for trait in TRAIT_KEYS
        for level in (10, 50, 90)
    }
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(prompts, indent=2))
