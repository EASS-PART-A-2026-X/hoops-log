"""The controller: runs one work order from the order to a candidate waiting for the GM.

It is plain Python. It owns the clock, the folders, the commits and the checks; the agents
only write code, review it, and narrate. The order of play comes from announcer.py.

    order -> builder -> scope check -> commit candidate -> gate (exact SHA, clean checkout)
          -> red? repair (at most `max_repairs`) or stop
          -> green? reviewer -> gap? repair or stop -> approved -> waiting for the GM

Nothing is pushed, merged or tagged here. The run ends at `waiting`; only the GM's
`factory approve` goes further.
"""

import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import gate as gatelib
from . import gitwork, report, scope
from .agents import AgentContext, AgentReport, Builder, Commentator, Reviewer, parse_verdict
from .announcer import Call, announce
from .events import EventLog, read_events, update_run, write_run
from .workorder import WorkOrder


@dataclass
class Options:
    repo: Path
    run_dir: Path
    run_id: str
    base: str = "ex3"
    workdir: Path | None = None
    gate_timeout: float = 900
    builder_timeout: float = 1800
    reviewer_timeout: float = 300
    mode: str = "live"  # live | scripted
    dashboard: Path | None = None
    clock: Callable[[], float] = time.time


class Controller:
    def __init__(
        self, wo: WorkOrder, opts: Options, builder: Builder, reviewer: Reviewer, commentator: Commentator | None
    ):
        self.wo, self.opts = wo, opts
        self.builder, self.reviewer, self.commentator = builder, reviewer, commentator
        self.run_dir = opts.run_dir
        self.receipts = self.run_dir / "receipts"
        self.stop_file = self.run_dir / "STOP"
        self.workdir = opts.workdir or opts.repo / "factory" / "work"
        self.worktree = self.workdir / opts.run_id
        # Not "factory/...": that would clash with an ordinary branch called "factory" (git refs are paths).
        self.branch = f"factory-run/{opts.run_id}"
        self.candidates: list[str] = []
        self.log: EventLog

    # ------------------------------------------------------------ small helpers

    def _rel(self, path: Path | str) -> str:
        """A path as saved in run.json: relative to the repo, so the evidence has no machine-specific folders."""
        if str(path).startswith(str(self.opts.repo)):
            return os.path.relpath(path, self.opts.repo)
        return str(path)

    def _version(self) -> str:
        sha = gitwork.git("rev-parse", "--short", "HEAD", cwd=self.opts.repo, check=False) or "unknown"
        dirty = gitwork.git("status", "--porcelain", "--", "factory", cwd=self.opts.repo, check=False)
        return f"{sha}+uncommitted" if dirty else sha

    def _remaining(self) -> float:
        return self.started + self.wo.budget_seconds - self.opts.clock()

    def _save(self, name: str, text: str) -> str:
        (self.receipts / name).write_text(text, encoding="utf-8")
        return name

    def _say(self, call: Call, step: str) -> None:
        extra: dict = {"huddle": True, "stage": call.stage, "box": {"announcer": {"turns": 1}}}
        if call.pass_from and call.to:
            extra["pass"] = {"from": call.pass_from, "to": call.to}
        self.log.emit("announcer", "say", call.text, **extra)
        self._comment("failed" if call.stops else step)

    def _comment(self, key: str) -> None:
        if self.commentator is None:
            return
        text = self.commentator.say(key, read_events(self.run_dir))
        if text:
            self.log.emit("commentator", "commentary", text, box={"commentator": {"turns": 1}})

    def _context(self, timeout: float, attempt: int) -> AgentContext:
        return AgentContext(
            self.log, self.run_dir, self.wo.files, max(1.0, min(timeout, self._remaining())), self.stop_file, attempt
        )

    # ------------------------------------------------------------ start and finish

    def _start(self) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.receipts.mkdir(exist_ok=True)
        self.started = self.opts.clock()
        self.base_sha = gitwork.rev_parse(self.opts.base, self.opts.repo)
        write_run(
            self.run_dir,
            {
                "id": self.opts.run_id,
                "work_order": {"id": self.wo.id, "title": self.wo.title, "path": self._rel(self.wo.path)},
                "factory_version": self._version(),
                "status": "running",
                "pid": os.getpid(),
                "mode": self.opts.mode,
                "started_at": self.started,
                "budget_seconds": self.wo.budget_seconds,
                "max_repairs": self.wo.max_repairs,
                "checks": [c.label for c in self.wo.checks],
                "models": {
                    "builder": self.builder.label,
                    "reviewer": self.reviewer.label,
                    "commentator": self.commentator.label if self.commentator else "off",
                },
                "base": self.base_sha,
                "base_ref": self.opts.base,
                "branch": self.branch,
                "worktree": self._rel(self.worktree),
                "candidates": [],
                "where": {
                    "run_folder": self._rel(self.run_dir),
                    "work_order": self._rel(self.wo.path),
                    "event_log": self._rel(self.run_dir / "events.jsonl"),
                    "receipts": self._rel(self.receipts),
                    "live_page": self._rel(self.run_dir / "index.html"),
                    "report": self._rel(self.run_dir / "report.html"),
                    "builder_worktree": self._rel(self.worktree),
                },
            },
        )
        self.log = EventLog(self.run_dir, self.started, self.opts.clock)
        self._save("work-order.md", Path(self.wo.path).read_text(encoding="utf-8"))
        if self.opts.dashboard and self.opts.dashboard.exists():
            report.write_live_page(self.run_dir, self.opts.dashboard)
        gitwork.add_worktree(self.opts.repo, self.worktree, self.base_sha, self.branch)
        gitwork.link_dependencies(self.worktree, self.opts.repo)

    def _finish(self, status: str, reason: str = "") -> str:
        final = self.candidates[-1] if self.candidates else None
        if final:
            patch = gitwork.diff(self.opts.repo, self.base_sha, final)
            (self.run_dir / "candidate.patch").write_text(patch + "\n", encoding="utf-8")
        update_run(
            self.run_dir,
            status=status,
            reason=reason,
            finished_at=self.opts.clock(),
            candidates=self.candidates,
            final_candidate=final,
        )
        if self.opts.dashboard and self.opts.dashboard.exists():
            report.export(self.run_dir, self.opts.dashboard)
        return status

    def _end(self, step: str, status: str, reason: str) -> str:
        self._say(announce(step), step if step == "stopped" else "failed")
        return self._finish(status, reason)

    # ------------------------------------------------------------ the run

    def run(self) -> str:
        try:
            self._start()
            return self._play()
        except Exception as error:  # a bug in the factory must never look like a result
            self._record_failure(error)
            raise

    def _record_failure(self, error: Exception) -> None:
        if hasattr(self, "log"):
            self.log.emit("referee", "foul", f"The factory itself failed: {error}")
        if (self.run_dir / "run.json").exists():
            if hasattr(self, "log"):
                self._finish("error", str(error))
            else:
                update_run(self.run_dir, status="error", reason=str(error), finished_at=self.opts.clock())

    def _play(self) -> str:
        opening = announce("order", order_id=self.wo.id, title=self.wo.title)
        self._say(opening, "order")
        repairs_used, feedback, call_text = 0, "", opening.text
        previous = self.base_sha
        while True:
            attempt = repairs_used + 1
            if self.stop_file.exists():
                return self._end("stopped", "stopped", "stop order")
            if self._remaining() <= 0:
                return self._end("out_of_time", "stopped", "out of time")

            built = self._build(attempt, call_text, repairs_used, feedback)
            if isinstance(built, str):
                return built
            sha = self._commit(attempt, previous)
            if sha is None:
                feedback = "You changed nothing. Make the change the work order asks for."
                call = announce("no_change", repairs_used=repairs_used, max_repairs=self.wo.max_repairs)
                self.log.emit("builder", "evidence", "The builder changed nothing, so there is no candidate.")
                self._say(call, "gate_red")
                if call.stops:
                    return self._finish("failed", "the builder changed nothing")
                repairs_used, call_text = repairs_used + 1, call.text
                continue
            previous = sha
            short = sha[:7]

            gate_root = self.workdir / f"{self.opts.run_id}-gate-{attempt}"
            gitwork.add_worktree(self.opts.repo, gate_root, sha)
            gitwork.link_dependencies(gate_root, self.opts.repo)
            try:
                outcome = self._gate(attempt, sha, gate_root)
                if isinstance(outcome, str):
                    return outcome
                results, summary, green = outcome
                if not green:
                    call = announce(
                        "gate_red", candidate=short, repairs_used=repairs_used, max_repairs=self.wo.max_repairs
                    )
                    self._say(call, "gate_red")
                    if call.stops:
                        return self._finish("failed", f"the gate stayed red on {short} after the repairs")
                    feedback = f"The gate ran on your candidate {short} and failed:\n{summary}"
                    repairs_used, call_text = repairs_used + 1, call.text
                    continue
                self._say(announce("gate_green", candidate=short), "gate_green")
                verdict = self._review(attempt, sha, gate_root, summary)
                if isinstance(verdict, str):
                    return verdict
            finally:
                gitwork.remove_worktree(self.opts.repo, gate_root)

            if verdict["verdict"] == "gap":
                call = announce("gap", candidate=short, repairs_used=repairs_used, max_repairs=self.wo.max_repairs)
                self._say(call, "gap")
                if call.stops:
                    return self._finish("failed", f"the reviewer still found a gap on {short} after the repairs")
                majors = [f["text"] for f in verdict["findings"] if f.get("severity") == "major"]
                feedback = "The reviewer found a gap in your candidate:\n- " + "\n- ".join(
                    majors or [verdict["summary"]]
                )
                repairs_used, call_text = repairs_used + 1, call.text
                continue
            self._say(announce("approved", candidate=short), "approved")
            return self._finish("waiting", f"candidate {short} is ready for the GM")

    # ------------------------------------------------------------ the stages

    def _build(self, attempt: int, call_text: str, repairs_used: int, feedback: str) -> AgentReport | str:
        prompt = builder_prompt(self.wo, call_text, feedback)
        if attempt == 1:
            self.log.emit("builder", "evidence", "The builder starts reading the code.", stage="build")
        report_ = self.builder.run(prompt, self.worktree, self._context(self.opts.builder_timeout, attempt))
        tools = f"builder-{attempt}-tools.txt"
        self._save(tools, "\n".join(report_.tool_log) + "\n")
        summary = self._save(f"builder-{attempt}-summary.txt", report_.text + "\n")
        if report_.text.strip():
            self.log.emit("builder", "say", report_.text.strip()[:600], huddle=True, receipt=[summary, tools])
        self.log.emit(
            "builder",
            "evidence",
            f"Builder finished attempt {attempt}: {report_.turns} turns, {report_.tokens} tokens, ${report_.cost_usd:.2f}.",
            box={"builder": {"turns": report_.turns, "tokens": report_.tokens}},
        )
        if report_.stopped:
            return self._end("stopped", "stopped", "stop order")
        if report_.timed_out:
            self.log.emit("referee", "foul", "Time is up: the builder was stopped and its process group killed.")
            return self._end("out_of_time", "stopped", "the builder ran out of time")
        if report_.failed:
            self.log.emit("referee", "foul", f"The builder could not run: {report_.failed}")
            return self._finish("failed", f"the builder could not run: {report_.failed}")
        reverted = scope.enforce(self.worktree, self.wo.files)
        tracked, new = scope.changed_paths(self.worktree)
        lines = [
            f"allowed paths: {', '.join(self.wo.files)}",
            f"changed: {', '.join(sorted(tracked + new)) or 'nothing'}",
        ]
        for path in reverted:
            lines.append(f"REVERTED (outside the work order): {path}")
            self.log.emit(
                "referee",
                "foul",
                f"Change reverted: {path} is not one of the files this work order allows.",
                receipt=[f"scope-check-{attempt}.txt"],
                box={"referee": {"turns": 1}, "builder": {"fouls": 1}},
            )
        self._save(f"scope-check-{attempt}.txt", "\n".join(lines) + "\n")
        if reverted:
            self._comment("foul")
        return report_

    def _commit(self, attempt: int, previous: str) -> str | None:
        sha = gitwork.commit_all(self.worktree, f"factory: {self.wo.id} candidate {attempt}")
        if sha is None:
            return None
        self.candidates.append(sha)
        update_run(self.run_dir, candidates=self.candidates)
        files = gitwork.changed_files(self.opts.repo, previous, sha)
        patch = self._save(f"diff-{attempt}.patch", gitwork.diff(self.opts.repo, previous, sha) + "\n")
        commit = self._save(
            f"commit-{attempt}.txt",
            f"candidate {sha}\nparent {previous}\nfiles changed: {len(files)}\n" + "\n".join(files) + "\n",
        )
        self.log.emit(
            "builder",
            "evidence",
            f"Committed candidate {sha[:7]}.",
            cand=sha[:7],
            newAttempt=True,
            stage="gate",
            receipt=[commit, patch],
        )
        self._say(announce("candidate", candidate=sha[:7]), "candidate")
        return sha

    def _gate(self, attempt: int, sha: str, root: Path):
        def shot(result: gatelib.CheckResult) -> None:
            text = (
                f"{result.label} passed." if result.ok else f"{result.label}: {result.note or 'see the gate receipt'}"
            )
            self.log.emit("gate", "shot", text, shot={"made": result.ok, "label": result.label})

        results = gatelib.run_checks(
            self.opts.repo,
            self.base_sha,
            sha,
            self.wo.checks,
            root,
            self.workdir,
            self.opts.gate_timeout,
            shot,
            self.stop_file,
            lambda: self._remaining(),
        )
        if self.stop_file.exists():
            return self._end("stopped", "stopped", "stop order")
        if len(results) < len(self.wo.checks):
            return self._end("out_of_time", "stopped", "out of time during the gate")
        summary = gatelib.summarize(results)
        receipt = self._save(f"gate-{attempt}.txt", f"candidate {sha}\n{summary}")
        green = all(r.ok for r in results)
        passed = sum(1 for r in results if r.ok)
        text = f"Gate is {'green' if green else 'red'} on {sha[:7]}: {passed} of {len(results)} checks passed."
        self.log.emit(
            "gate",
            "evidence",
            text,
            receipt=[receipt],
            box={"gate": {"turns": 1}},
            gate={
                "status": "green" if green else "red",
                "text": f"{passed} of {len(results)} checks passed on {sha[:7]}",
            },
        )
        return results, summary, green

    def _review(self, attempt: int, sha: str, root: Path, gate_summary: str):
        diff = gitwork.diff(self.opts.repo, self.base_sha, sha)
        prompt = reviewer_prompt(self.wo, gate_summary, diff)
        ctx = self._context(self.opts.reviewer_timeout, attempt)
        answer = self.reviewer.run(prompt, root, ctx)
        verdict = parse_verdict(answer.text)
        if verdict is None and not answer.failed and not (answer.timed_out or answer.stopped):
            answer = self.reviewer.run(
                prompt + "\n\nYour last reply had no JSON verdict. Reply with only the JSON object.", root, ctx
            )
            verdict = parse_verdict(answer.text)
        if answer.stopped:
            return self._end("stopped", "stopped", "stop order")
        if answer.timed_out:
            return self._end("out_of_time", "stopped", "the reviewer ran out of time")
        if verdict is None:
            self.log.emit(
                "reviewer",
                "evidence",
                "The reviewer gave no usable verdict, so the run stops.",
                box={"reviewer": {"turns": answer.turns, "tokens": answer.tokens}},
            )
            return self._finish("failed", "the reviewer gave no verdict")
        findings = "\n".join(f"- [{f.get('severity', 'minor')}] {f.get('text', '')}" for f in verdict["findings"])
        receipt = self._save(
            f"review-{attempt}.md", f"Verdict: {verdict['verdict']}\n\n{verdict['summary']}\n\n{findings}\n"
        )
        status = "approved" if verdict["verdict"] == "approve" else "gap"
        self.log.emit(
            "reviewer",
            "say",
            (verdict["summary"] or "No summary.").strip()[:600],
            huddle=True,
            receipt=[receipt],
            review={
                "status": status,
                "text": ("Approved on " if status == "approved" else "Found a gap on ") + sha[:7],
            },
            box={"reviewer": {"turns": answer.turns, "tokens": answer.tokens}},
        )
        return verdict


def builder_prompt(wo: WorkOrder, announcement: str, feedback: str) -> str:
    f = wo.fields
    repair = (
        f"\nWHAT WENT WRONG LAST TIME\n{feedback}\nFix exactly this, and keep what already works.\n" if feedback else ""
    )
    return f"""You are the BUILDER in a software factory. Your working copy is the current folder, a git checkout of the project.

THE WORK ORDER: {wo.id} {wo.title}
Outcome: {f["Outcome"]}
Files you may change: {", ".join(wo.files)}
Non-goals: {f["Non-goals"]}
Acceptance: {f["Acceptance"]}
Stop: {f["Stop"]}

HOW THIS FACTORY WORKS (enforced by the factory, not just advice)
- You can read, search, edit and write files. You cannot run commands, so you cannot run the tests: the gate runs them on your exact candidate.
- An edit to any file outside the list above is blocked and counted as a foul.
- Do not use git. The controller commits what you leave in the folder.
- Add or update unit tests (files ending in .test.ts or .test.tsx) that FAIL on the original code and PASS with your change. The gate checks that they fail without it.
- Follow the existing code style. Keep the change as small as the outcome allows.

THE ANNOUNCER SAYS: {announcement}
{repair}
When you are done, reply with a short summary (at most 8 lines): what you changed, which tests you added, and anything you could not check."""


def reviewer_prompt(wo: WorkOrder, gate_summary: str, diff: str) -> str:
    f = wo.fields
    return f"""You are the REVIEWER (the coach) in a software factory. You cannot edit anything. You can read the files in the current folder, which is exactly the candidate under review.

THE WORK ORDER: {wo.id} {wo.title}
Outcome: {f["Outcome"]}
Review focus: {f["Review focus"]}
Acceptance: {f["Acceptance"]}
Non-goals: {f["Non-goals"]}

WHAT THE GATE SAID (run by the controller, not by the builder)
{gate_summary[-3000:]}

THE CANDIDATE'S DIFF AGAINST THE ORIGINAL CODE
{diff[:60000]}

Your job: find a gap the tests do not cover. Use Grep to look for places that still do what the work order says should change. Report "gap" only for a MAJOR problem: something the outcome requires that is missing or broken. Style notes and optional ideas are minor findings and do not make a gap.

Reply with ONLY one JSON object and no other text:
{{"verdict": "approve" or "gap", "summary": "one or two sentences", "findings": [{{"severity": "major" or "minor", "text": "..."}}]}}"""
