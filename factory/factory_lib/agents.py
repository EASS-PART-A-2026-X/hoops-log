"""The AI roles, and scripted stand-ins for tests and dry runs.

    builder      edits code. Runs `claude -p` in its own worktree with NO shell: it can read,
                 search, edit and write files, and nothing else. A hook refuses edits outside
                 the work order's files. It never commits, pushes or merges.
    reviewer     a SEPARATE claude process with read-only tools. It sees the work order, the
                 diff and the gate result, and answers with a verdict. It cannot edit.
    commentator  one-sentence narration for the dashboard. It routes nothing and decides
                 nothing; its lines are labelled commentary, not evidence.

Why no Bash for the builder: in a test, `--allowedTools Read Edit Write` did NOT stop the
model from writing a forbidden file through Bash, and the edit hook never fired. An allow
list in a flag is guidance. Only removing the tool (`--tools`) is a fence.
"""

import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from . import gitwork
from .events import EventLog
from .runner import run_bounded

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "scope_guard.py"


@dataclass
class AgentContext:
    log: EventLog
    run_dir: Path
    files: tuple[str, ...]
    timeout: float
    stop_file: Path
    attempt: int = 1


@dataclass
class AgentReport:
    text: str = ""
    turns: int = 0
    tokens: int = 0
    cost_usd: float = 0.0
    seconds: float = 0.0
    timed_out: bool = False
    stopped: bool = False
    failed: str = ""  # why the agent could not run at all
    tool_log: list[str] = field(default_factory=list)


class Builder(Protocol):
    label: str

    def run(self, prompt: str, cwd: Path, ctx: AgentContext) -> AgentReport: ...


class Reviewer(Protocol):
    label: str

    def run(self, prompt: str, cwd: Path, ctx: AgentContext) -> AgentReport: ...


class Commentator(Protocol):
    label: str

    def say(self, key: str, recent: list[dict]) -> str | None: ...


# ---------------------------------------------------------------- verdicts


def parse_verdict(text: str) -> dict | None:
    """The reviewer's JSON verdict out of its reply, or None if there is none."""
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", text):
        try:
            value, _ = decoder.raw_decode(text[match.start() :])
        except ValueError:
            continue
        if isinstance(value, dict) and value.get("verdict") in ("approve", "gap"):
            value.setdefault("findings", [])
            value.setdefault("summary", "")
            return value
    return None


def _usage(result: dict) -> tuple[int, int, float]:
    usage = result.get("usage") or {}
    tokens = sum(int(usage.get(key) or 0) for key in ("input_tokens", "output_tokens", "cache_creation_input_tokens"))
    return int(result.get("num_turns") or 0), tokens, float(result.get("total_cost_usd") or 0.0)


def _last_json(text: str) -> dict | None:
    for line in reversed(text.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                continue
    return None


# ---------------------------------------------------------------- the builder


class StreamTranslator:
    """Turns the builder's stream of tool calls into events, live, as they happen."""

    def __init__(self, ctx: AgentContext, cwd: Path):
        self.ctx, self.cwd = ctx, cwd
        self.reads: list[str] = []
        self.pending: dict[str, tuple[str, str]] = {}
        self.tool_log: list[str] = []
        self.result: dict | None = None
        self.edited: list[str] = []

    def _relative(self, path: str) -> str:
        try:
            return str(Path(path).resolve().relative_to(self.cwd.resolve()))
        except ValueError:
            return path

    def flush_reads(self) -> None:
        if not self.reads:
            return
        names = ", ".join(self.reads[:4]) + (f" and {len(self.reads) - 4} more" if len(self.reads) > 4 else "")
        self.ctx.log.emit("builder", "evidence", f"Read {len(self.reads)} files or searches: {names}.")
        self.reads = []

    def feed(self, line: str) -> None:
        line = line.strip()
        if not line.startswith("{"):
            return
        try:
            data = json.loads(line)
        except ValueError:
            return
        kind = data.get("type")
        if kind == "assistant":
            for block in data.get("message", {}).get("content", []):
                if block.get("type") == "tool_use":
                    self._tool_use(block)
        elif kind == "user":
            for block in data.get("message", {}).get("content", []):
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    self._tool_result(block)
        elif kind == "result":
            self.result = data

    def _tool_use(self, block: dict) -> None:
        name, args = block.get("name", ""), block.get("input", {}) or {}
        target = args.get("file_path") or args.get("pattern") or args.get("path") or ""
        shown = self._relative(target) if target.startswith("/") else target
        self.tool_log.append(f"{name} {shown}".strip())
        if name in ("Read", "Glob", "Grep"):
            self.reads.append(shown or name)
        elif name in ("Edit", "Write", "MultiEdit"):
            self.pending[block.get("id", "")] = (name, self._relative(args.get("file_path", "")))

    def _tool_result(self, block: dict) -> None:
        name_path = self.pending.pop(block.get("tool_use_id", ""), None)
        if name_path is None or block.get("is_error"):
            return  # a blocked edit: the hook already logged the foul
        name, path = name_path
        self.flush_reads()
        self.edited.append(path)
        verb = "Wrote" if name == "Write" else "Edited"
        self.ctx.log.emit("builder", "evidence", f"{verb} {path}.", files=[path])


class ClaudeBuilder:
    role = "builder"

    def __init__(self, model: str = "sonnet", max_turns: int = 40, budget_usd: float = 4.0, claude: str = "claude"):
        self.model, self.max_turns, self.budget_usd, self.claude = model, max_turns, budget_usd, claude
        self.label = model

    def argv(self, prompt: str) -> list[str]:
        hook = {"type": "command", "command": f"{sys.executable} {HOOK}"}
        settings = {"hooks": {"PreToolUse": [{"matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [hook]}]}}
        return [
            self.claude,
            "-p",
            prompt,
            "--model",
            self.model,
            "--output-format",
            "stream-json",
            "--verbose",
            "--no-session-persistence",
            "--setting-sources",
            "project",
            "--settings",
            json.dumps(settings),
            "--permission-mode",
            "acceptEdits",
            "--tools",
            "Read,Glob,Grep,Edit,Write",  # no Bash: see the module note
            "--max-turns",
            str(self.max_turns),
            "--max-budget-usd",
            str(self.budget_usd),
        ]

    def run(self, prompt: str, cwd: Path, ctx: AgentContext) -> AgentReport:
        env = dict(os.environ)
        env["PATH"] = gitwork.tool_path()
        env.update(
            FACTORY_RUN_DIR=str(ctx.run_dir),
            FACTORY_WORKTREE=str(cwd),
            FACTORY_FILES=json.dumps(list(ctx.files)),
        )
        stream = StreamTranslator(ctx, cwd)
        outcome = run_bounded(self.argv(prompt), cwd, env, ctx.timeout, ctx.stop_file, on_line=stream.feed)
        stream.flush_reads()
        report = AgentReport(
            seconds=outcome.seconds, timed_out=outcome.timed_out, stopped=outcome.stopped, tool_log=stream.tool_log
        )
        if stream.result:
            report.text = str(stream.result.get("result") or "")
            report.turns, report.tokens, report.cost_usd = _usage(stream.result)
        elif not (outcome.timed_out or outcome.stopped):
            report.failed = "claude ended without a result: " + outcome.output.strip()[-300:]
        return report


# ---------------------------------------------------------------- the reviewer


class ClaudeReviewer:
    role = "reviewer"

    def __init__(self, model: str = "haiku", max_turns: int = 14, budget_usd: float = 1.0, claude: str = "claude"):
        self.model, self.max_turns, self.budget_usd, self.claude = model, max_turns, budget_usd, claude
        self.label = model

    def run(self, prompt: str, cwd: Path, ctx: AgentContext) -> AgentReport:
        argv = [
            self.claude,
            "-p",
            prompt,
            "--model",
            self.model,
            "--output-format",
            "json",
            "--no-session-persistence",
            "--setting-sources",
            "project",
            "--tools",
            "Read,Glob,Grep",  # read only: it cannot change what it reviews
            "--max-turns",
            str(self.max_turns),
            "--max-budget-usd",
            str(self.budget_usd),
        ]
        env = dict(os.environ)
        env["PATH"] = gitwork.tool_path()
        outcome = run_bounded(argv, cwd, env, ctx.timeout, ctx.stop_file)
        report = AgentReport(seconds=outcome.seconds, timed_out=outcome.timed_out, stopped=outcome.stopped)
        result = _last_json(outcome.output)
        if result:
            report.text = str(result.get("result") or "")
            report.turns, report.tokens, report.cost_usd = _usage(result)
        elif not (outcome.timed_out or outcome.stopped):
            report.failed = "claude ended without a result: " + outcome.output.strip()[-300:]
        return report


# ---------------------------------------------------------------- the commentator

TEMPLATE_LINES = {
    "order": "Tip-off. The builder takes the order and heads for the code.",
    "foul": "Whistle. The builder reached outside the lane and the referee sent it back.",
    "candidate": "A candidate is on the board. Over to the stat crew.",
    "gate_green": "The stat crew shows green across the board.",
    "gate_red": "The gate says no. The ball goes back to the builder.",
    "gap": "The coach spotted a gap under the basket.",
    "approved": "Everything now rests on the GM.",
    "failed": "Final whistle without a delivery: the repairs ran out.",
}


class TemplateCommentator:
    """Fixed lines: free, and always the same. Used when no commentator model is chosen."""

    label = "fixed lines"

    def say(self, key: str, recent: list[dict]) -> str | None:
        return TEMPLATE_LINES.get(key)


def clean_commentary(text: str) -> str:
    """One plain line: no quotes, no markdown, and no word count a small model sometimes adds."""
    line = text.strip().splitlines()[0] if text.strip() else ""
    line = re.sub(r"\s*\(\d+\s+words?\)\s*$", "", line, flags=re.IGNORECASE)
    return line.strip().strip("\"'*_` ").strip()


class ClaudeCommentator:
    """A small model that narrates in one sentence. It never sees more than the last events."""

    def __init__(self, model: str = "haiku", claude: str = "claude"):
        self.model, self.claude = model, claude
        self.label = model
        self.fallback = TemplateCommentator()

    def say(self, key: str, recent: list[dict]) -> str | None:
        facts = "\n".join(f"- {e['actor']}: {e['text']}" for e in recent[-6:])
        prompt = (
            "You are a basketball TV commentator narrating a software factory run as if it were a game. "
            "Write ONE sentence, at most 22 words, plain text, present tense. Use only what the events below say; "
            f"invent no numbers, names or results.\nWhat just happened: {key}\nRecent events:\n{facts}"
        )
        argv = [
            self.claude,
            "-p",
            prompt,
            "--model",
            self.model,
            "--output-format",
            "json",
            "--no-session-persistence",
            "--setting-sources",
            "project",
            "--tools",
            "",
            "--max-turns",
            "1",
        ]
        env = dict(os.environ)
        env["PATH"] = gitwork.tool_path()
        outcome = run_bounded(argv, Path.cwd(), env, 60)
        result = _last_json(outcome.output)
        text = clean_commentary(str((result or {}).get("result") or ""))
        if outcome.ok and 8 <= len(text) <= 200:
            return text
        return self.fallback.say(key, recent)


# ---------------------------------------------------------------- stand-ins for tests and dry runs


class ScriptedBuilder:
    """A builder that follows a script: each step edits files in the worktree and returns a summary."""

    label = "scripted"

    def __init__(self, steps):
        self.steps = list(steps)
        self.prompts: list[str] = []

    def run(self, prompt: str, cwd: Path, ctx: AgentContext) -> AgentReport:
        self.prompts.append(prompt)
        step = self.steps[min(len(self.prompts), len(self.steps)) - 1]
        text = step(cwd, ctx) if callable(step) else str(step)
        return AgentReport(text=text, turns=1, tokens=0)


class ScriptedReviewer:
    label = "scripted"

    def __init__(self, verdicts):
        self.verdicts = list(verdicts)
        self.prompts: list[str] = []

    def run(self, prompt: str, cwd: Path, ctx: AgentContext) -> AgentReport:
        self.prompts.append(prompt)
        verdict = self.verdicts[min(len(self.prompts), len(self.verdicts)) - 1]
        return AgentReport(text=verdict if isinstance(verdict, str) else json.dumps(verdict), turns=1)
