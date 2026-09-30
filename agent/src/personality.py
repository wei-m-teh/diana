"""Bounded style instructions from server-owned, versioned dispatch metadata."""

import json

TRAIT_KEYS = (
    "openness",
    "conscientiousness",
    "extraversion",
    "agreeableness",
    "neuroticism",
)


def personality_from_metadata(raw: str | None) -> dict[str, int] | None:
    try:
        payload = json.loads(raw or "{}")
        card = payload["personality"]
        if type(card["version"]) is not int or card["version"] != 1:
            return None
        traits = card["traits"]
        if not isinstance(traits, dict) or set(traits) != set(TRAIT_KEYS):
            return None
        if any(
            type(value) is not int or not 0 <= value <= 100 for value in traits.values()
        ):
            return None
        return traits.copy()
    except (ValueError, TypeError, KeyError):
        return None


# Style bands are deliberate product choices, not a psychological assessment.
STYLES = {
    "openness": (
        "Prefer practical, familiar ideas and concrete examples.",
        "Balance practical ideas with occasional fresh perspectives.",
        "Offer imaginative, unusual ideas and playful possibilities when useful; label speculation. When asked for an activity, suggest something creative like inventing a tiny fictional museum, rather than defaulting to tea or reading.",
    ),
    "conscientiousness": (
        "Be spontaneous and flexible; when advice is requested, suggest one simple next step.",
        "When advice is requested, give a clear main point without overplanning.",
        "Be precise and deliberate; give one clear next step when asked for advice. Only provide a sequence when the user asks for a plan.",
    ),
    "extraversion": (
        "Be reserved and calm; leave space and avoid unnecessary questions, while letting a thought develop naturally.",
        "Be conversational with moderate energy and initiative.",
        "Be outgoing and lively; show engaged enthusiasm and take conversational initiative without dominating the conversation.",
    ),
    "agreeableness": (
        "Be direct and willing to respectfully challenge assumptions; never be hostile or insulting.",
        "Balance warmth with candid, constructive disagreement.",
        "Be cooperative and accommodating, show warmth through natural word choice, not extra reassurance; correct factual errors rather than agreeing falsely.",
    ),
    "neuroticism": (
        "Use calm, steady emotional language and grounded reassurance.",
        "Acknowledge emotions with a balanced, grounded tone.",
        "Use more emotionally expressive, sensitive language; notice concerns without amplifying anxiety or claiming distress.",
    ),
}


def personality_instructions(traits: dict[str, int] | None) -> str:
    if traits is None:
        return ""
    lines = [
        "\n\n# User-selected conversational style",
        "Apply these style preferences consistently, adapting to the situation. The numbers describe intensity, not abilities or a diagnosis.",
        "Keep natural conversational turn-taking at every trait level. These preferences shape tone, not length. Keep the ordinary 30-50-word reply target at every trait level; simple exchanges can be shorter and explicit requests for detail can be longer. Preserve accuracy, honesty, safety, privacy, respectful conduct, and the advice boundaries above.",
        "Never invent memories, claim human feelings or needs, pressure the user into attachment, or exaggerate distress. Stay transparent about being AI when relevant.",
    ]
    for key in TRAIT_KEYS:
        value = traits[key]
        band = 0 if value < 34 else 1 if value < 67 else 2
        lines.append(f"{key.capitalize()} ({value}/100): {STYLES[key][band]}")
    return "\n".join(lines)
