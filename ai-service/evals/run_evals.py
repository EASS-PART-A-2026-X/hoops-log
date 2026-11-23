"""Run the evaluation and print the results.

    uv run python -m evals.run_evals                  the baseline (a fake model)
    uv run python -m evals.run_evals --model oracle   must be 100%: tests the checks
    uv run python -m evals.run_evals --model bad      must be low: tests the checks
    uv run python -m evals.run_evals --model groq:openai/gpt-oss-120b --pause 8 --save
        a real model (needs GROQ_API_KEY)

`--save` writes evals/results/<date>-<model>.json and .md. Every report says whether the
model was FAKE or REAL: a fake model's score measures the checks, not a model.
"""

import argparse
import hashlib
import json
import logging
import statistics
import subprocess
import sys
from dataclasses import asdict
from datetime import date
from importlib.metadata import version
from pathlib import Path

from pydantic_evals.reporting import EvaluationReport

from app.agent import INSTRUCTIONS, model_settings_for
from evals.cases import CASES, SLICES, EvalCase
from evals.harness import is_fake, run_report

RESULTS = Path(__file__).parent / "results"
FAKE_LABEL = "FAKE model (a function): scores the checks and the plumbing, NOT a model"
REAL_LABEL = "REAL model"


def case_failures(case) -> list[str]:
    """The checks this case did not fully pass."""
    failed = [name for name, result in case.assertions.items() if not result.value]
    failed += [name for name, result in case.scores.items() if result.value < 1.0]
    return failed


def summarize(report: EvaluationReport) -> dict:
    """Pass rates per check, per slice, and for development versus held-out cases."""
    per_check: dict[str, list[float]] = {}
    slices: dict[str, list] = {}
    groups: dict[str, list] = {"development": [], "held-out": []}
    failures: dict[str, list[str]] = {}
    for case in report.cases:
        for name, result in case.assertions.items():
            per_check.setdefault(name, []).append(1.0 if result.value else 0.0)
        for name, result in case.scores.items():
            per_check.setdefault(name, []).append(float(result.value))
        failed = case_failures(case)
        if failed:
            failures[case.name] = failed
        slices.setdefault(case.metadata["slice"], []).append(case)
        key = "held-out" if case.metadata["held_out"] else "development"
        groups[key].append(case)

    def passed(cases) -> int:
        return sum(1 for case in cases if not case_failures(case))

    def mean_shots(cases) -> float:
        return statistics.fmean(c.scores["shots_f1"].value for c in cases)

    return {
        "checks": {
            name: {"cases": len(values), "mean": round(statistics.fmean(values), 3)}
            for name, values in sorted(per_check.items())
        },
        "slices": {
            name: {
                "cases": len(cases),
                "passed": passed(cases),
                "shots_f1": round(mean_shots(cases), 3),
            }
            for name, cases in ((s, slices[s]) for s in SLICES if s in slices)
        },
        "groups": {
            name: {"cases": len(cases), "passed": passed(cases)}
            for name, cases in groups.items()
            if cases
        },
        "failures": failures,
    }


def control_flow(report: EvaluationReport, fake: bool = False) -> dict:
    """Statuses and latency. A fake model answers in milliseconds that differ on every
    run, so its latency is recorded as None: it says nothing and only adds noise."""
    seconds = [case.output.seconds for case in report.cases]
    statuses: dict[str, int] = {}
    for case in report.cases:
        key = str(case.output.status)
        statuses[key] = statuses.get(key, 0) + 1
    unanswered = {
        case.name: f"{case.output.status} {case.output.detail}".strip()
        for case in report.cases
        if case.output.status != 200
    }
    return {
        "statuses": statuses,
        "unanswered": unanswered,
        "latency_median_s": None if fake else round(statistics.median(seconds), 2),
        "latency_max_s": None if fake else round(max(seconds), 2),
    }


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            cwd=Path(__file__).parent,
        )
    except OSError, subprocess.SubprocessError:
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def _git_commit() -> str:
    """The commit the run started from, marked when the code had uncommitted changes
    (a result from a dirty tree cannot be reproduced from the commit alone)."""
    commit = _git("rev-parse", "--short", "HEAD")
    if commit is None:
        return "unknown"
    # The results folder is what a run writes, so its files do not make the code dirty.
    dirty = _git("status", "--porcelain", "--", ".", ":(exclude)results")
    return f"{commit}+uncommitted" if dirty else commit


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def metadata(model: str, cases: tuple[EvalCase, ...]) -> dict:
    fake = is_fake(model)
    dataset = json.dumps([asdict(case) for case in cases], sort_keys=True)
    return {
        "date": date.today().isoformat(),
        "model": model,
        "condition": FAKE_LABEL if fake else REAL_LABEL,
        "settings": "none (a function)" if fake else model_settings_for(model),
        "git_commit": _git_commit(),
        "dataset_sha": _digest(dataset),
        "prompt_sha": _digest(INSTRUCTIONS),
        "cases": len(cases),
        "pydantic_ai": version("pydantic-ai-slim"),
        "pydantic_evals": version("pydantic-evals"),
    }


def _latency(flow: dict) -> str:
    if flow["latency_median_s"] is None:
        return "latency not recorded (a fake model's speed means nothing)"
    return f"median {flow['latency_median_s']} s, max {flow['latency_max_s']} s"


def render_markdown(meta: dict, summary: dict, flow: dict) -> str:
    lines = [f"# Evaluation: {meta['model']} on {meta['date']}", ""]
    lines += [f"- **Condition:** {meta['condition']}"]
    for key in ("settings", "git_commit", "dataset_sha", "prompt_sha", "cases"):
        lines.append(f"- **{key}:** {meta[key]}")
    lines += [
        (
            f"- **versions:** pydantic-ai {meta['pydantic_ai']}, "
            f"pydantic-evals {meta['pydantic_evals']}"
        ),
        f"- **control flow:** statuses {flow['statuses']}, {_latency(flow)}",
        "",
        "## Cases fully passed",
        "",
        "| Group | Passed | Cases |",
        "|---|---|---|",
    ]
    for name, group in summary["groups"].items():
        lines.append(f"| {name} | {group['passed']} | {group['cases']} |")
    lines += [
        "",
        "## By slice",
        "",
        "| Slice | Passed | Cases | Shots F1 |",
        "|---|---|---|---|",
    ]
    for name, row in summary["slices"].items():
        lines.append(
            f"| {name} | {row['passed']} | {row['cases']} | {row['shots_f1']} |"
        )
    lines += [
        "",
        "## By check",
        "",
        "| Check | Cases it applies to | Pass rate |",
        "|---|---|---|",
    ]
    for name, row in summary["checks"].items():
        lines.append(f"| {name} | {row['cases']} | {row['mean']} |")
    if flow["unanswered"]:
        lines += [
            "",
            "## Cases the service did not answer",
            "",
            (
                "These count as failures on every check. A 429 or 503 is the "
                "provider's quota or setup, not the model's quality: fix that and run "
                "again before quoting any score."
            ),
            "",
        ]
        lines += [f"- `{name}`: {why}" for name, why in flow["unanswered"].items()]
    lines += ["", "## Cases with a failed check", ""]
    if summary["failures"]:
        for name, failed in summary["failures"].items():
            lines.append(f"- `{name}`: {', '.join(failed)}")
    else:
        lines.append("None.")
    return "\n".join(lines) + "\n"


def print_summary(meta: dict, summary: dict, flow: dict) -> None:
    print(render_markdown(meta, summary, flow))


def save(meta: dict, summary: dict, flow: dict, report: EvaluationReport) -> list[Path]:
    RESULTS.mkdir(exist_ok=True)
    slug = meta["model"].replace(":", "-").replace("/", "-")
    stem = RESULTS / f"{meta['date']}-{slug}"
    rows = [
        {
            "case": case.name,
            "slice": case.metadata["slice"],
            "held_out": case.metadata["held_out"],
            "status": case.output.status,
            "seconds": None
            if flow["latency_median_s"] is None
            else round(case.output.seconds, 2),
            "reply": case.output.reply,
            "proposals": case.output.proposals,
            "failed_checks": case_failures(case),
        }
        for case in report.cases
    ]
    payload = {"meta": meta, "control_flow": flow, "summary": summary, "cases": rows}
    paths = [stem.with_suffix(".json"), stem.with_suffix(".md")]
    paths[0].write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    paths[1].write_text(render_markdown(meta, summary, flow))
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate Deni on the dataset.")
    parser.add_argument(
        "--model", default="baseline", help="baseline, oracle, bad, or provider:model"
    )
    parser.add_argument(
        "--pause",
        type=float,
        default=0.0,
        help="seconds between cases (a real model's quota is small)",
    )
    parser.add_argument(
        "--save",
        action="store_true",
        help="write evals/results/<date>-<model>.json and .md",
    )
    args = parser.parse_args(argv)

    logging.getLogger("app").setLevel(
        logging.CRITICAL
    )  # a failing case is reported below
    report = run_report(args.model, CASES, pause=args.pause)
    meta = metadata(args.model, CASES)
    summary = summarize(report)
    flow = control_flow(report, fake=is_fake(args.model))

    if flow["unanswered"]:
        print(
            f"WARNING: {len(flow['unanswered'])} case(s) got no answer from the "
            f"service (statuses {flow['statuses']}). They count as failures: see the "
            "list below and do not quote this score."
        )
    report.print(include_averages=True)
    print()
    print_summary(meta, summary, flow)
    if args.save:
        for path in save(meta, summary, flow, report):
            print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
