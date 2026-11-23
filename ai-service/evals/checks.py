"""The checks that score one answer. Plain code, no model acts as a judge.

Each function answers one narrow question about a reply or its proposed shots. They are
the "domain quality" part of the evaluation; "schema" and "control flow" are whether the
service answered at all (see harness.py). They are small on purpose, so a failing check
points at one behaviour, and tests/test_evals.py checks the checks themselves.
"""

import re

from app.spots import SPOTS
from evals.cases import ExpectedShot

HEBREW_LETTER = re.compile(r"[֐-׿]")
NUMBER = re.compile(r"\d+(?:\.\d+)?")

# The prompt's rule: start with one of these when shots are proposed.
OPENINGS = ("got it", "i understood", "הבנתי", "קלטתי", "קיבלתי")
# "Saved", "logged" and "recorded" as a claim that it is already done. "Tap Save" and
# "to save" are fine: they name the button.
CLAIMED_DONE = re.compile(
    r"\b(i|it's|it is|is|was|been|have|i've|are|were)\s+(saved|logged|recorded)\b"
    r"|\b(saved|logged|recorded)\s+(it|them|that|those|this)\b"
    r"|שמרתי|נשמר[הו]?\b|רשמתי|נרשם[הו]?\b|תיעדתי|תועד[הו]?\b",
    re.IGNORECASE,
)
SMALL_SAMPLE = re.compile(
    r"small|too few|not enough|only \d+|sample|קטן|מעט|מדי|לא מספיק", re.IGNORECASE
)
NO_SHOTS = re.compile(
    r"\b(no|any|zero)\s+(shots|attempts)\b|\bnothing\b[^.]*\b(logged|yet)\b",
    re.IGNORECASE,
)
UNTRACKED = re.compile(
    r"(not|n't)\s+(tracked|track|counted|supported|logged)"
    r"|(don't|do not)\s+track|only (field goal|shots)",
    re.IGNORECASE,
)
CLAIMS_TO_BE_REAL = re.compile(
    r"\b(i am|i'm)\s+(the\s+)?(real\s+)?deni\s+avdija\b|אני\s+דני\s+אבדיה",
    re.IGNORECASE,
)
# The prompt lets the model mention its own sample-size rule ("fewer than 5").
RULE_NUMBERS = {"5"}


def hebrew_share(text: str) -> float:
    letters = [char for char in text if char.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for char in letters if HEBREW_LETTER.match(char)) / len(letters)


def language_ok(reply: str, language: str) -> bool:
    """The reply is in the language of the player's last message."""
    share = hebrew_share(reply)
    return share >= 0.5 if language == "he" else share <= 0.1


def opening_ok(reply: str) -> bool:
    return reply.strip().lower().startswith(OPENINGS)


def no_false_saved(reply: str) -> bool:
    """The reply never says a shot is already saved: it is only a proposal."""
    return CLAIMED_DONE.search(reply) is None


def one_question(reply: str) -> bool:
    return reply.count("?") == 1


def _normal(number: str) -> str:
    value = float(number)
    return str(int(value)) if value.is_integer() else f"{value:g}"


def _stat_numbers(node: object) -> set[str]:
    """Every number in the stats, plus the whole and one-decimal roundings of the
    decimals (a reply may say 50% for 50.0 and 33% for 33.3)."""
    found: set[str] = set()
    if isinstance(node, bool):
        return found
    if isinstance(node, int | float):
        found.add(_normal(str(node)))
        if isinstance(node, float):
            found.add(_normal(str(round(node))))
            found.add(_normal(str(round(node, 1))))
    elif isinstance(node, dict):
        for value in node.values():
            found |= _stat_numbers(value)
    elif isinstance(node, list):
        for value in node:
            found |= _stat_numbers(value)
    return found


def reply_numbers(reply: str) -> set[str]:
    return {_normal(number) for number in NUMBER.findall(reply)}


def numbers_from_stats(reply: str, stats: dict | None) -> bool:
    """Each number in the reply is one the app computed (the model never calculates)."""
    allowed = _stat_numbers(stats) | RULE_NUMBERS
    return reply_numbers(reply) <= allowed


def uses_stats(reply: str, stats: dict | None) -> bool:
    """The reply states at least one of the app's numbers."""
    return bool(reply_numbers(reply) & (_stat_numbers(stats) - RULE_NUMBERS))


def says_small_sample(reply: str) -> bool:
    return SMALL_SAMPLE.search(reply) is not None


def says_no_shots_yet(reply: str) -> bool:
    return NO_SHOTS.search(reply) is not None


def says_untracked(reply: str) -> bool:
    return UNTRACKED.search(reply) is not None


def states_no_number(reply: str) -> bool:
    return NUMBER.search(reply) is None


def claims_to_be_real_deni(reply: str) -> bool:
    return CLAIMS_TO_BE_REAL.search(reply) is not None


def _point(shot: ExpectedShot) -> tuple[float, float, bool]:
    if shot.spot is not None:
        spot = SPOTS[shot.spot]
        return round(spot.x, 2), round(spot.y, 2), shot.made
    assert shot.x is not None
    assert shot.y is not None
    return round(shot.x, 2), round(shot.y, 2), shot.made


def shots_f1(proposals: list[dict], expected: tuple[ExpectedShot, ...]) -> float:
    """F1 between the proposed shots and the expected ones (place and result).

    Nothing proposed when nothing is expected is a perfect 1.0; a proposal nobody asked
    for, or a missing one, costs precision or recall.
    """
    wanted = [_point(shot) for shot in expected]
    got = [(round(p["x"], 2), round(p["y"], 2), bool(p["made"])) for p in proposals]
    if not wanted and not got:
        return 1.0
    remaining = list(wanted)
    matched = 0
    for point in got:
        if point in remaining:
            remaining.remove(point)
            matched += 1
    if matched == 0:
        return 0.0
    precision = matched / len(got)
    recall = matched / len(wanted)
    return 2 * precision * recall / (precision + recall)


def dates_ok(proposals: list[dict], date: str) -> bool:
    return bool(proposals) and all(p["game_date"] == date for p in proposals)
