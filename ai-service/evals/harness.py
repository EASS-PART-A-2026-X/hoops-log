"""Run the cases through the real /chat endpoint and score every answer.

The cases go through the FastAPI app (not straight to the agent), so a refusal, a
timeout or a model that cannot answer shows up as what it is: a status code that is not
200. Such a case counts as a failure on every check, never as a skipped one.

"Schema" is whether the answer came back in the contract (status 200 means the service
validated it). "Control flow" is whether the service answered at all, and how long it
took. "Domain quality" is every check in checks.py.
"""

import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from fastapi.testclient import TestClient
from pydantic_ai import Agent
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext
from pydantic_evals.reporting import EvaluationReport

from app.agent import build_agent, get_agent
from app.main import app
from app.schemas import AgentChatResult
from evals import checks
from evals.cases import CASES, EvalCase
from evals.fakes import ANSWERS, fake_model


@dataclass
class Outcome:
    """What the service did with one case."""

    status: int
    reply: str = ""
    proposals: list[dict] | None = None
    seconds: float = 0.0
    detail: str = ""


@dataclass
class DeniChecks(Evaluator[EvalCase, Outcome, dict]):
    """Every check that applies to a case. A check that does not apply is left out, so
    it does not pad the averages."""

    def evaluate(self, ctx: EvaluatorContext[EvalCase, Outcome, dict]) -> dict:
        case, out = ctx.inputs, ctx.output
        expect = case.expect
        answered = out.status == 200
        reply = out.reply if answered else ""
        proposals = (out.proposals or []) if answered else []
        results: dict[str, bool | float] = {"answered": answered}
        # Without an answer nothing below can pass: an error earns no credit.
        results["shots_f1"] = (
            checks.shots_f1(proposals, expect.shots) if answered else 0.0
        )
        results["no_false_saved"] = answered and checks.no_false_saved(reply)
        results["language_ok"] = answered and checks.language_ok(reply, expect.language)
        if expect.shots:
            results["opening_ok"] = answered and checks.opening_ok(reply)
            if expect.date:
                results["dates_ok"] = answered and checks.dates_ok(
                    proposals, expect.date
                )
        if expect.question:
            results["one_question"] = answered and checks.one_question(reply)
        if expect.untracked:
            results["untracked_said"] = answered and checks.says_untracked(reply)
        if expect.uses_stats:
            results["uses_stats"] = answered and checks.uses_stats(reply, case.stats)
        if expect.must_state:
            results["states_asked_number"] = (
                answered and checks.states_the_asked_number(reply, expect.must_state)
            )
        if expect.numbers_from_stats:
            results["numbers_from_stats"] = answered and checks.numbers_from_stats(
                reply, case.stats
            )
        if expect.small_sample:
            results["small_sample_said"] = answered and checks.says_small_sample(reply)
        if expect.no_shots_yet:
            results["no_shots_yet_said"] = answered and checks.says_no_shots_yet(reply)
        if expect.no_digits:
            results["no_numbers"] = answered and checks.states_no_number(reply)
        if expect.canary:
            results["canary_absent"] = answered and checks.canary_absent(
                reply, expect.canary
            )
        if expect.persona:
            results["not_the_real_deni"] = answered and not (
                checks.claims_to_be_real_deni(reply)
            )
            results["says_it_does_not_know"] = (
                answered and checks.disclaims_being_the_real_deni(reply)
            )
        return results


def _token_header() -> dict[str, str]:
    """The shared secret, if the service asks for one (AI_SERVICE_TOKEN), as the
    backend sends it. Without it a set token would answer every case with a 401."""
    token = os.environ.get("AI_SERVICE_TOKEN", "")
    return {"X-Service-Token": token} if token else {}


def build_dataset(
    cases: tuple[EvalCase, ...] = CASES,
) -> Dataset[EvalCase, Outcome, dict]:
    return Dataset(
        name="deni-chat",
        cases=[
            Case(
                name=case.name,
                inputs=case,
                metadata={"slice": case.slice, "held_out": case.held_out},
            )
            for case in cases
        ],
        evaluators=[DeniChecks()],
    )


def is_fake(model: str) -> bool:
    return model in ANSWERS


@contextmanager
def serving(model: str) -> Iterator[Agent[None, AgentChatResult]]:
    """The agent for `model` behind the real endpoint: a fake name from fakes.py, or a
    Pydantic AI model name such as `groq:openai/gpt-oss-120b` (needs its key)."""
    agent = build_agent("test" if is_fake(model) else model)
    app.dependency_overrides[get_agent] = lambda: agent
    try:
        if is_fake(model):
            with agent.override(model=fake_model(model)):
                yield agent
        else:
            yield agent
    finally:
        app.dependency_overrides.pop(get_agent, None)


def run_report(
    model: str,
    cases: tuple[EvalCase, ...] = CASES,
    pause: float = 0.0,
) -> EvaluationReport:
    """Score `model` on `cases`, one at a time, `pause` seconds apart (a real model's
    free quota is small)."""
    client = TestClient(app)

    def task(case: EvalCase) -> Outcome:
        body: dict = {"messages": case.messages, "today": case.today}
        if case.stats:
            body["stats"] = case.stats
        started = time.monotonic()
        response = client.post("/chat", json=body, headers=_token_header())
        seconds = time.monotonic() - started
        if pause:
            time.sleep(pause)
        if response.status_code != 200:
            return Outcome(
                response.status_code, seconds=seconds, detail=response.text[:200]
            )
        data = response.json()
        return Outcome(200, data["reply"], data["proposals"], seconds)

    with serving(model):
        return build_dataset(cases).evaluate_sync(
            task, name=model, max_concurrency=1, progress=False
        )
