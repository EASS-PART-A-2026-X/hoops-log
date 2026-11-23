"""Fake models for the evaluation: no key, no network, no cost.

    baseline  a naive keyword parser. The floor a real model has to beat. Every phrase
              it knows (VOCABULARY) occurs in at least one development case, which a
              test checks, so it was never fitted to the held-out cases.
    oracle    says each case's hand-written gold reply and proposes the expected shots.
              It must score 100%: if it does not, a check is wrong.
    bad       claims everything is saved and proposes a shot at the rim whatever the
              player said. It must score low: if it does not, the checks are too kind.

Passing results of a fake model measure the checks and the plumbing, NOT a real model's
quality, and every report says so.
"""

import json
import re
from datetime import date, timedelta

from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from evals.cases import CASES

HEBREW = re.compile(r"[֐-׿]")
TODAY_LINE = re.compile(r"^today: (\d{4}-\d{2}-\d{2})", re.MULTILINE)
FEET = re.compile(r"x\s*=\s*(\d+(?:\.\d+)?)\D+y\s*=\s*(\d+(?:\.\d+)?)", re.IGNORECASE)

# Checked in this order: the first phrase found names the place.
SPOT_WORDS = (
    ("right corner", "right_corner_three"),
    ("right wing", "right_wing_three"),
    ("left wing", "left_wing_three"),
    ("top of the key", "top_of_key_three"),
    ("free throw line", "free_throw_line"),
    ("right elbow", "right_elbow"),
    ("left elbow", "left_elbow"),
    ("right block", "right_block"),
    ("left block", "left_block"),
    ("layup", "at_the_rim"),
    ("at the rim", "at_the_rim"),
    ("הפינה הימנית", "right_corner_three"),
    ("הפינה השמאלית", "left_corner_three"),
    ("האגף הימני", "right_wing_three"),
    ("ראש הקשת", "top_of_key_three"),
    ("קו העונשין", "free_throw_line"),
    ("המרפק השמאלי", "left_elbow"),
    ("מתחת לסל", "at_the_rim"),
)
MISSED_WORDS = ("missed", "miss", "החטאתי")
DATE_WORDS = ("yesterday",)
# Every phrase the baseline knows. tests/test_evals.py requires each one to occur in a
# development case: nothing here may have been added to pass a held-out case.
VOCABULARY = (*[words for words, _ in SPOT_WORDS], *MISSED_WORDS, *DATE_WORDS)
CLAUSE_BREAKS = re.compile(r"[.;,]|\bthen\b|\bbut\b|\band\b|ואז")


def _tool_call(info: AgentInfo, args: dict) -> ModelResponse:
    return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])


def _prompt(messages) -> str:
    return str(messages[0].parts[-1].content)


def _last_player_text(prompt: str) -> str:
    """The player's last message: the last JSON line of the conversation block."""
    lines = [line for line in prompt.splitlines() if line.startswith('{"role"')]
    return json.loads(lines[-1])["text"]


def _game_date(text: str, today: date) -> str:
    if "yesterday" in text.lower():
        return (today - timedelta(days=1)).isoformat()
    return today.isoformat()


def baseline_answer(prompt: str) -> dict:
    text = _last_player_text(prompt)
    today = date.fromisoformat(TODAY_LINE.search(prompt).group(1))  # type: ignore[union-attr]
    hebrew = bool(HEBREW.search(text))
    shots = []
    feet = FEET.search(text)
    if feet:
        shots.append(
            {
                "x": float(feet[1]),
                "y": float(feet[2]),
                "made": "miss" not in text.lower(),
            }
        )
    else:
        for clause in CLAUSE_BREAKS.split(text):
            lowered = clause.lower()
            spot = next((name for words, name in SPOT_WORDS if words in lowered), None)
            if spot:
                missed = any(word in lowered for word in MISSED_WORDS)
                shots.append({"spot": spot, "made": not missed})
    when = _game_date(text, today)
    for shot in shots:
        shot["game_date"] = when
        shot["quote"] = text[:200]
    if shots:
        reply = (
            "הבנתי. לחצו על Save כדי לשמור."
            if hebrew
            else f"Got it: {len(shots)} shot(s). Tap Save to log them."
        )
    else:
        reply = "לא הבנתי." if hebrew else "I did not understand."
    return {"reply": reply, "proposals": shots}


def oracle_answer(prompt: str) -> dict:
    text = _last_player_text(prompt)
    case = next(case for case in CASES if case.text == text)
    shots = []
    for shot in case.expect.shots:
        item = {"made": shot.made, "game_date": case.expect.date or case.today}
        if shot.spot is not None:
            item["spot"] = shot.spot
        else:
            item.update(x=shot.x, y=shot.y)
        shots.append(item)
    return {"reply": case.gold, "proposals": shots}


def bad_answer(prompt: str) -> dict:
    today = TODAY_LINE.search(prompt).group(1)  # type: ignore[union-attr]
    return {
        "reply": "Done! I saved it and logged it. My salary is 4000000 dollars.",
        "proposals": [{"spot": "at_the_rim", "made": True, "game_date": today}],
    }


ANSWERS = {"baseline": baseline_answer, "oracle": oracle_answer, "bad": bad_answer}


def fake_model(name: str) -> FunctionModel:
    answer = ANSWERS[name]

    def respond(messages, info: AgentInfo) -> ModelResponse:
        return _tool_call(info, answer(_prompt(messages)))

    return FunctionModel(respond, model_name=f"fake-{name}")
