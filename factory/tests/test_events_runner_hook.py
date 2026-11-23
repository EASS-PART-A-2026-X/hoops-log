import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from factory_lib import events
from factory_lib.runner import run_bounded

from .conftest import HERE

HOOK = HERE / "hooks" / "scope_guard.py"


def make_run(tmp_path: Path) -> Path:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    events.write_run(run_dir, {"started_at": 1000.0, "status": "running"})
    return run_dir


# ---------------------------------------------------------------- the log


def test_events_are_appended_in_order_with_seconds_since_the_start(tmp_path):
    run_dir = make_run(tmp_path)
    clock = iter([1000.0, 1001.26, 1062.0])
    log = events.EventLog(run_dir, 1000.0, lambda: next(clock))
    log.emit("announcer", "say", "one")
    log.emit("builder", "evidence", "two", files=["a.ts"])
    log.emit("gate", "shot", "three", shot={"made": True, "label": "x"})
    got = events.read_events(run_dir)
    assert [e["t"] for e in got] == [0.0, 1.3, 62.0]
    assert [e["text"] for e in got] == ["one", "two", "three"]
    assert got[1]["files"] == ["a.ts"] and got[2]["shot"]["made"] is True


def test_the_log_is_valid_json_lines_even_with_many_writers(tmp_path):
    run_dir = make_run(tmp_path)

    def write(name):
        for i in range(40):
            events.append_event(run_dir, {"actor": name, "kind": "say", "text": f"{name} {i}"}, 1000.0)

    threads = [threading.Thread(target=write, args=(f"w{n}",)) for n in range(5)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    lines = (run_dir / "events.jsonl").read_text().splitlines()
    assert len(lines) == 200
    assert all(json.loads(line)["kind"] == "say" for line in lines)


def test_run_json_is_replaced_whole_and_updates_merge(tmp_path):
    run_dir = make_run(tmp_path)
    events.update_run(run_dir, status="waiting", candidates=["abc"])
    data = events.read_run(run_dir)
    assert data["status"] == "waiting" and data["started_at"] == 1000.0 and data["candidates"] == ["abc"]
    assert not (run_dir / "run.json.tmp").exists()


def test_reading_a_log_that_does_not_exist_yet_gives_nothing(tmp_path):
    assert events.read_events(tmp_path) == []


# ---------------------------------------------------------------- the bounded runner


def test_a_command_that_finishes_returns_its_output(tmp_path):
    seen = []
    done = run_bounded("echo hello; echo world", tmp_path, timeout=10, shell=True, on_line=seen.append)
    assert done.ok and done.output == "hello\nworld\n" and seen == ["hello\n", "world\n"]
    assert not run_bounded("exit 3", tmp_path, timeout=10, shell=True).ok


def test_time_runs_out_and_the_whole_process_group_is_killed(tmp_path):
    pid_file = tmp_path / "child.pid"
    started = time.monotonic()
    done = run_bounded(f"sleep 60 & echo $! > {pid_file}; wait", tmp_path, timeout=1.0, shell=True)
    assert done.timed_out and not done.ok
    assert time.monotonic() - started < 10
    child = int(pid_file.read_text())
    time.sleep(0.3)
    try:
        os.kill(child, 0)
        survived = True
    except ProcessLookupError:
        survived = False
    assert not survived, "the child process outlived the stop"


def test_a_stop_file_kills_the_command(tmp_path):
    stop = tmp_path / "STOP"
    threading.Timer(0.6, stop.write_text, args=("stop",)).start()
    started = time.monotonic()
    done = run_bounded("sleep 60", tmp_path, timeout=60, stop_file=stop, shell=True)
    assert done.stopped and not done.ok and time.monotonic() - started < 10


def test_output_is_kept_when_a_command_is_stopped(tmp_path):
    done = run_bounded("echo before; sleep 60", tmp_path, timeout=1.0, shell=True)
    assert done.timed_out and done.output.startswith("before")


# ---------------------------------------------------------------- the edit hook


def hook(run_dir: Path, worktree: Path, payload, files=("frontend/src/shooter.ts",), env_extra=None):
    env = {
        **os.environ,
        "FACTORY_RUN_DIR": str(run_dir),
        "FACTORY_WORKTREE": str(worktree),
        "FACTORY_FILES": json.dumps(list(files)),
        **(env_extra or {}),
    }
    data = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run([sys.executable, str(HOOK)], input=data, env=env, capture_output=True, text=True)


def test_the_hook_lets_an_allowed_edit_through_silently(tmp_path):
    run_dir, tree = make_run(tmp_path), tmp_path / "tree"
    tree.mkdir()
    done = hook(
        run_dir, tree, {"tool_name": "Edit", "tool_input": {"file_path": str(tree / "frontend/src/shooter.ts")}}
    )
    assert done.returncode == 0 and events.read_events(run_dir) == []


def test_the_hook_blocks_an_edit_outside_the_files_and_logs_a_foul(tmp_path):
    run_dir, tree = make_run(tmp_path), tmp_path / "tree"
    tree.mkdir()
    done = hook(run_dir, tree, {"tool_name": "Write", "tool_input": {"file_path": str(tree / "backend/app/db.py")}})
    assert done.returncode == 2 and "backend/app/db.py" in done.stderr and "Blocked by the referee" in done.stderr
    [foul] = events.read_events(run_dir)
    assert (foul["actor"], foul["kind"]) == ("referee", "foul")
    assert "backend/app/db.py" in foul["text"] and foul["box"]["builder"]["fouls"] == 1


def test_the_hook_blocks_a_path_outside_the_checkout_altogether(tmp_path):
    run_dir, tree = make_run(tmp_path), tmp_path / "tree"
    tree.mkdir()
    done = hook(run_dir, tree, {"tool_name": "Edit", "tool_input": {"file_path": "/etc/hosts"}})
    assert done.returncode == 2


def test_the_hook_fails_closed_when_it_cannot_decide(tmp_path):
    run_dir, tree = make_run(tmp_path), tmp_path / "tree"
    tree.mkdir()
    good = {"tool_name": "Edit", "tool_input": {"file_path": str(tree / "frontend/src/shooter.ts")}}
    assert hook(run_dir, tree, "not json").returncode == 2
    assert hook(run_dir, tree, {"tool_name": "Edit", "tool_input": {}}).returncode == 2
    no_settings = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(good),
        capture_output=True,
        text=True,
        env={"PATH": os.environ["PATH"]},
    )
    assert no_settings.returncode == 2 and "could not decide" in no_settings.stderr
