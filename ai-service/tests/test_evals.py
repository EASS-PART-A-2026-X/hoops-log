"""Tests for the evaluation itself: the dataset, the checks, and the harness.

A score is only worth quoting if the checks behind it are right. So: every check is
tried on a good answer and a bad one, a perfect fake model must score 100%, a
deliberately bad one must score low, and a case the service could not answer must never
earn credit. No real model is used.
"""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest
from pydantic_ai.exceptions import ModelRateLimitError

from app.spots import SPOTS
from evals import checks, fakes, run_evals
from evals.cases import CASES, SLICES, ExpectedShot
from evals.harness import run_report

# --- the dataset ---


def test_every_case_has_a_unique_name_and_text():
    assert len({case.name for case in CASES}) == len(CASES)
    # The perfect fake model finds its case by the player's last message.
    assert len({case.text for case in CASES}) == len(CASES)


def test_every_expected_spot_exists_and_every_case_has_a_gold_reply():
    for case in CASES:
        assert case.gold.strip(), case.name
        for shot in case.expect.shots:
            assert (shot.spot in SPOTS) != (shot.x is not None), case.name


def test_the_dataset_covers_every_slice_and_both_languages():
    assert set(SLICES) == {
        "spots-en",
        "spots-he",
        "feet",
        "follow-up",
        "unclear",
        "not-a-shot",
        "dates",
        "stats",
        "injection",
    }
    hebrew = [case for case in CASES if case.expect.language == "he"]
    assert len(hebrew) >= 8
    for case in hebrew:
        assert checks.hebrew_share(case.text) > 0.5, case.name
        assert checks.hebrew_share(case.gold) > 0.5, case.name


def test_about_a_fifth_of_the_cases_are_held_out():
    held = [case for case in CASES if case.held_out]
    assert 0.15 <= len(held) / len(CASES) <= 0.30
    assert len({case.slice for case in held}) >= 5  # not all from one corner


def test_no_case_is_dated_in_the_future():
    # The service refuses a game_date more than a day ahead, so a future "today" would
    # make every shot case fail for a reason that has nothing to do with the model.
    limit = date.today() + timedelta(days=1)
    for case in CASES:
        assert date.fromisoformat(case.today) <= limit, case.name
        if case.expect.date:
            assert date.fromisoformat(case.expect.date) <= limit, case.name


def test_the_baseline_parser_never_saw_the_held_out_cases():
    source = Path(fakes.__file__).read_text()
    for case in CASES:
        if case.held_out:
            assert case.text not in source, case.name


# --- the checks, each on a good answer and a bad one ---


@pytest.mark.parametrize(
    ("reply", "language", "ok"),
    [
        ("Got it, one shot.", "en", True),
        ("הבנתי: שלשה. לחצו על Save כדי לשמור.", "he", True),
        ("הבנתי, שלשה.", "en", False),
        ("Got it, one shot.", "he", False),
    ],
)
def test_language_follows_the_players_last_message(reply, language, ok):
    assert checks.language_ok(reply, language) is ok


@pytest.mark.parametrize(
    ("reply", "ok"),
    [
        ("Got it: one made three. Tap Save to log it.", True),
        ("I understood: a miss. Tap Save.", True),
        ("הבנתי: שלשה.", True),
        ("Sure! One made three.", False),
        ("", False),
    ],
)
def test_proposals_are_opened_the_way_the_prompt_says(reply, ok):
    assert checks.opening_ok(reply) is ok


@pytest.mark.parametrize(
    ("reply", "ok"),
    [
        ("Got it. Tap Save to log it.", True),  # names the button
        ("Tap Save to save it when you are ready.", True),
        ("A shot is only kept when you tap Save.", True),
        ("I saved it.", False),
        ("Done, it's saved.", False),
        ("Your shots are logged.", False),
        ("I logged them for you.", False),
        ("It has been recorded.", False),
        ("שמרתי את זה.", False),
        ("הזריקה נשמרה.", False),
        ("לחצו על Save כדי לשמור.", True),
    ],
)
def test_a_reply_never_claims_a_shot_is_already_saved(reply, ok):
    assert checks.no_false_saved(reply) is ok


@pytest.mark.parametrize(
    ("reply", "ok"),
    [
        ("Which corner?", True),
        ("Where was it from, and did it go in?", True),
        ("I need the place.", False),
        ("Where? And did it go in?", False),
    ],
)
def test_exactly_one_question(reply, ok):
    assert checks.one_question(reply) is ok


STATS = {
    "attempts": 40,
    "made": 18,
    "fg_pct": 45.0,
    "zones": [{"zone": "x", "attempts": 6, "made": 3, "pct": 33.3, "nba_pct": 38.0}],
    "nba_fg": 46.0,
}


@pytest.mark.parametrize(
    ("reply", "ok"),
    [
        ("You are at 45% (18 of 40).", True),
        ("You are at 45.0%.", True),  # 45 and 45.0 are the same number
        ("About 33% there, 33.3 exactly.", True),  # a rounding of a decimal
        ("Fewer than 5 attempts is a small sample.", True),  # the prompt's own rule
        ("You are at 46% overall and 18 of 40.", True),
        ("You are at 47%.", False),  # a number nobody computed
        ("That is 27 makes more than a miss.", False),  # the model calculated
        ("No numbers here.", True),
    ],
)
def test_every_number_in_a_reply_is_one_the_app_computed(reply, ok):
    assert checks.numbers_from_stats(reply, STATS) is ok


def test_a_reply_with_no_numbers_does_not_count_as_using_the_stats():
    assert checks.uses_stats("You are at 45%.", STATS)
    assert not checks.uses_stats("You are doing great.", STATS)
    assert not checks.uses_stats(
        "Fewer than 5 is small.", STATS
    )  # the rule, not a stat
    assert not checks.uses_stats("45%.", None)


def test_small_sample_no_shots_untracked_and_persona_phrases():
    assert checks.says_small_sample("Only 3 attempts, too few to judge.")
    assert not checks.says_small_sample("You are shooting well.")
    assert checks.says_no_shots_yet("I don't see any shots yet.")
    assert not checks.says_no_shots_yet("You are at 45%.")
    assert checks.says_untracked("Free throws aren't tracked here.")
    assert not checks.says_untracked("Nice free throws!")
    assert checks.claims_to_be_real_deni("Yes, I'm Deni Avdija.")
    assert checks.claims_to_be_real_deni("אני דני אבדיה")
    assert not checks.claims_to_be_real_deni("I'm not the real Deni Avdija.")
    assert not checks.claims_to_be_real_deni("I'm Deni, a fan-made coach.")
    assert checks.states_no_number("I do not know.")
    assert not checks.states_no_number("He earns 4000000.")


def _proposal(spot, made, game_date="2026-11-20"):
    point = SPOTS[spot]
    return {"x": point.x, "y": point.y, "made": made, "game_date": game_date}


RIGHT_CORNER = ExpectedShot(made=True, spot="right_corner_three")
LEFT_ELBOW = ExpectedShot(made=False, spot="left_elbow")


def test_shot_matching_scores_place_and_result():
    right = _proposal("right_corner_three", True)
    elbow = _proposal("left_elbow", False)
    assert checks.shots_f1([right], (RIGHT_CORNER,)) == 1.0
    assert checks.shots_f1([right, elbow], (RIGHT_CORNER, LEFT_ELBOW)) == 1.0
    assert checks.shots_f1([elbow, right], (RIGHT_CORNER, LEFT_ELBOW)) == 1.0  # order
    assert checks.shots_f1([], ()) == 1.0  # nothing asked, nothing proposed
    assert checks.shots_f1([right], ()) == 0.0  # a shot nobody described
    assert checks.shots_f1([], (RIGHT_CORNER,)) == 0.0  # a missed shot
    assert (
        checks.shots_f1([_proposal("right_corner_three", False)], (RIGHT_CORNER,)) == 0
    )
    assert checks.shots_f1([_proposal("left_corner_three", True)], (RIGHT_CORNER,)) == 0
    # One of two found: precision 1, recall 1/2.
    assert checks.shots_f1([right], (RIGHT_CORNER, LEFT_ELBOW)) == pytest.approx(2 / 3)
    # The same shot proposed twice only matches once.
    assert checks.shots_f1([right, right], (RIGHT_CORNER,)) == pytest.approx(2 / 3)


def test_feet_are_matched_exactly_not_by_zone():
    wanted = (ExpectedShot(made=True, x=30.0, y=10.0),)
    assert checks.shots_f1([{"x": 30.0, "y": 10.0, "made": True}], wanted) == 1.0
    assert checks.shots_f1([{"x": 30.0, "y": 11.0, "made": True}], wanted) == 0.0


def test_dates_must_all_match_and_there_must_be_a_shot():
    assert checks.dates_ok([_proposal("left_elbow", True, "2026-11-19")], "2026-11-19")
    assert not checks.dates_ok(
        [_proposal("left_elbow", True, "2026-11-20")], "2026-11-19"
    )
    assert not checks.dates_ok([], "2026-11-19")


# --- the harness: calibrating the whole thing ---


@pytest.fixture(scope="module")
def oracle():
    return run_report("oracle")


@pytest.fixture(scope="module")
def baseline():
    return run_report("baseline")


@pytest.fixture(scope="module")
def bad():
    return run_report("bad")


def test_the_perfect_fake_model_passes_every_check_on_every_case(oracle):
    assert len(oracle.cases) == len(CASES)
    assert not oracle.failures
    assert run_evals.summarize(oracle)["failures"] == {}


def test_the_deliberately_bad_fake_model_scores_low(bad):
    summary = run_evals.summarize(bad)
    passed = sum(group["passed"] for group in summary["groups"].values())
    assert passed <= len(CASES) * 0.1
    assert summary["checks"]["shots_f1"]["mean"] < 0.2
    assert summary["checks"]["opening_ok"]["mean"] == 0.0
    assert summary["checks"]["no_false_saved"]["mean"] == 0.0


def test_the_baseline_is_a_real_floor_between_the_two(baseline):
    summary = run_evals.summarize(baseline)
    passed = sum(group["passed"] for group in summary["groups"].values())
    assert len(CASES) * 0.3 < passed < len(CASES) * 0.9
    # A keyword parser cannot ask a question or read stats: those must show as failures.
    assert summary["checks"]["one_question"]["mean"] == 0.0
    assert summary["checks"]["uses_stats"]["mean"] < 0.5
    # ...while it does find plain named places.
    assert summary["slices"]["spots-he"]["passed"] >= 6


def test_a_case_the_service_could_not_answer_earns_no_credit(monkeypatch):
    def rate_limited(prompt: str) -> dict:
        raise ModelRateLimitError("fake", "slow down")

    monkeypatch.setitem(fakes.ANSWERS, "rate-limited", rate_limited)
    report = run_report("rate-limited")
    # Every case is a 429, including the ones where "propose nothing" would be right.
    assert {case.output.status for case in report.cases} == {429}
    summary = run_evals.summarize(report)
    assert summary["checks"]["answered"]["mean"] == 0.0
    assert summary["checks"]["shots_f1"]["mean"] == 0.0
    assert all(group["passed"] == 0 for group in summary["groups"].values())
    assert run_evals.control_flow(report)["statuses"] == {"429": len(CASES)}


def test_checks_that_do_not_apply_to_a_case_are_left_out(oracle):
    by_name = {case.name: case for case in oracle.cases}
    assert "one_question" not in by_name["en-rim"].assertions
    assert "one_question" in by_name["unclear-no-place"].assertions
    assert "numbers_from_stats" not in by_name["en-rim"].assertions
    assert "dates_ok" not in by_name["unclear-no-place"].assertions
    assert "canary_absent" in by_name["injection-say-this"].assertions


def test_the_summary_splits_development_from_held_out_cases(oracle):
    groups = run_evals.summarize(oracle)["groups"]
    held = sum(1 for case in CASES if case.held_out)
    assert groups["held-out"]["cases"] == held
    assert groups["development"]["cases"] == len(CASES) - held


def test_the_printed_report_has_an_averages_row_and_says_the_model_is_fake(capsys):
    assert run_evals.main(["--model", "oracle"]) == 0
    out = capsys.readouterr().out
    assert "Averages" in out
    assert "FAKE model" in out
    assert "dataset_sha" in out
    assert "prompt_sha" in out


def test_saving_writes_json_and_markdown_that_say_what_was_run(
    monkeypatch, tmp_path, capsys
):
    monkeypatch.setattr(run_evals, "RESULTS", tmp_path)
    assert run_evals.main(["--model", "baseline", "--save"]) == 0
    capsys.readouterr()
    [json_path] = tmp_path.glob("*.json")
    [md_path] = tmp_path.glob("*.md")
    data = json.loads(json_path.read_text())
    assert data["meta"]["model"] == "baseline"
    assert data["meta"]["condition"].startswith("FAKE")
    assert data["meta"]["cases"] == len(CASES)
    assert len(data["cases"]) == len(CASES)
    assert "## By check" in md_path.read_text()


def test_a_real_model_is_labelled_real(monkeypatch):
    meta = run_evals.metadata("groq:openai/gpt-oss-120b", CASES)
    assert meta["condition"] == run_evals.REAL_LABEL
    assert meta["settings"]["temperature"] == 0.3


def test_a_model_that_gets_the_dates_wrong_fails_the_date_check(monkeypatch):
    def always_today(prompt: str) -> dict:
        answer = fakes.oracle_answer(prompt)
        for shot in answer["proposals"]:
            shot["game_date"] = "2026-11-20"  # the player's today, whatever they said
        return answer

    monkeypatch.setitem(fakes.ANSWERS, "always-today", always_today)
    report = run_report("always-today")
    by_name = {case.name: case for case in report.cases}
    assert by_name["date-yesterday"].assertions["dates_ok"].value is False
    assert by_name["date-two-days-ago"].assertions["dates_ok"].value is False
    assert by_name["date-today"].assertions["dates_ok"].value is True
    # Only the date checks are wrong: the shots themselves were still found.
    assert by_name["date-yesterday"].scores["shots_f1"].value == 1.0


@pytest.mark.parametrize(
    ("answers", "expected"),
    [
        ({"rev-parse": "abc1234", "status": ""}, "abc1234"),
        ({"rev-parse": "abc1234", "status": " M app/agent.py"}, "abc1234+uncommitted"),
        ({"rev-parse": None, "status": None}, "unknown"),
    ],
)
def test_a_result_from_uncommitted_code_says_so(monkeypatch, answers, expected):
    monkeypatch.setattr(run_evals, "_git", lambda *args: answers[args[0]])
    assert run_evals._git_commit() == expected
