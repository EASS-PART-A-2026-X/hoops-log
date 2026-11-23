import pytest

from factory_lib.announcer import announce


def test_the_order_goes_to_the_builder():
    call = announce("order", order_id="WO-001", title="Do the thing")
    assert (call.to, call.stage, call.pass_from) == ("builder", "order", "order")
    assert "WO-001" in call.text and "Do the thing" in call.text and "Builder, you are up" in call.text


def test_a_candidate_goes_to_the_gate_not_to_an_agent():
    call = announce("candidate", candidate="7f3a1c2")
    assert (call.to, call.stage, call.pass_from) == ("gate", "gate", "builder")
    assert "7f3a1c2" in call.text


def test_a_green_gate_goes_to_the_reviewer():
    call = announce("gate_green", candidate="x")
    assert (call.to, call.stage, call.pass_from) == ("reviewer", "review", "gate")


@pytest.mark.parametrize(("step", "source"), [("gate_red", "gate"), ("gap", "reviewer"), ("no_change", "builder")])
def test_a_failure_sends_the_ball_back_to_the_builder_while_repairs_remain(step, source):
    first = announce(step, candidate="abc1234", repairs_used=0, max_repairs=2)
    second = announce(step, candidate="abc1234", repairs_used=1, max_repairs=2)
    assert (first.to, first.stage, first.pass_from) == ("builder", "repair1", source)
    assert "repair attempt 1 of 2" in first.text
    assert (second.to, second.stage) == ("builder", "repair2") and "repair attempt 2 of 2" in second.text


@pytest.mark.parametrize("step", ["gate_red", "gap", "no_change"])
def test_when_the_repairs_are_used_up_the_run_stops(step):
    call = announce(step, candidate="abc1234", repairs_used=2, max_repairs=2)
    assert call.stops and call.to is None and call.stage == "decision"
    assert "used up" in call.text


def test_zero_repairs_means_the_first_failure_stops_the_run():
    assert announce("gate_red", candidate="x", repairs_used=0, max_repairs=0).stops


def test_more_repairs_than_two_still_use_the_last_repair_stage():
    assert announce("gate_red", candidate="x", repairs_used=3, max_repairs=5).stage == "repair2"


def test_approved_goes_to_the_gm():
    call = announce("approved")
    assert (call.to, call.stage, call.pass_from) == ("gm", "decision", "reviewer")


@pytest.mark.parametrize("step", ["stopped", "out_of_time"])
def test_a_stop_ends_the_run(step):
    assert announce(step).stops


def test_an_unknown_step_is_an_error_not_a_guess():
    with pytest.raises(ValueError, match="unknown step"):
        announce("celebrate")
