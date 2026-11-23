"""The GM's decision, from the command line and from the live page. No model, no network, no push."""

import http.client
import json
import subprocess
import threading
from pathlib import Path

import pytest

from factory_lib import events
from factory_lib.decide import DecisionError, decide, deliver
from factory_lib.serve import TOKEN_SLOT, make_server

from .conftest import DASHBOARD, git


def waiting_run(tmp_path: Path, status: str = "waiting") -> Path:
    run_dir = tmp_path / "runs" / "r1"
    (run_dir / "receipts").mkdir(parents=True)
    events.write_run(
        run_dir,
        {
            "id": "r1",
            "status": status,
            "started_at": 1.0,
            "base": "a" * 40,
            "base_ref": "ex3",
            "branch": "factory-run/r1",
            "final_candidate": "b" * 40,
            "candidates": ["b" * 40],
            "work_order": {"id": "WO-001", "title": "A title"},
        },
    )
    (run_dir / "index.html").write_text(f"<html><script>{TOKEN_SLOT}</script></html>")
    return run_dir


def fake_opener(url="https://example.test/pull/9"):
    calls = []

    def opener(run, repo):
        calls.append(run["branch"])
        return url

    opener.calls = calls
    return opener


# ---------------------------------------------------------------- the decision itself


def test_approving_records_the_decision_and_pushes_nothing(tmp_path):
    run_dir = waiting_run(tmp_path)
    opener = fake_opener()
    result = decide(run_dir, tmp_path, DASHBOARD, "approve", opener=opener)
    assert result["status"] == "approved" and result["pr_url"] is None and opener.calls == []
    assert events.read_run(run_dir)["status"] == "approved" and "decided_at" in events.read_run(run_dir)
    last = events.read_events(run_dir)[-1]
    assert (last["actor"], last["kind"], last["text"]) == ("gm", "decision", "The GM approved candidate bbbbbbb.")
    assert "approved candidate" in (run_dir / "report.html").read_text()


def test_approving_with_a_pr_delivers_once_and_remembers_the_address(tmp_path):
    run_dir = waiting_run(tmp_path)
    opener = fake_opener()
    result = decide(run_dir, tmp_path, DASHBOARD, "approve", open_pr=True, opener=opener)
    assert result["pr_url"] == "https://example.test/pull/9" and opener.calls == ["factory-run/r1"]
    assert events.read_run(run_dir)["pr_url"] == "https://example.test/pull/9"
    assert deliver(run_dir, tmp_path, DASHBOARD, opener) == "https://example.test/pull/9"
    assert opener.calls == ["factory-run/r1"]  # a run with a PR is never delivered twice


def test_a_failed_delivery_keeps_the_approval_and_says_so_and_can_be_retried(tmp_path):
    run_dir = waiting_run(tmp_path)

    def offline(run, repo):
        raise subprocess.CalledProcessError(1, "git push", stderr="could not resolve host")

    with pytest.raises(DecisionError, match="delivery failed"):
        decide(run_dir, tmp_path, DASHBOARD, "approve", open_pr=True, opener=offline)
    assert events.read_run(run_dir)["status"] == "approved" and "pr_url" not in events.read_run(run_dir)
    assert "Delivery failed" in events.read_events(run_dir)[-1]["text"]
    assert deliver(run_dir, tmp_path, DASHBOARD, fake_opener()) == "https://example.test/pull/9"


def test_rejecting_keeps_the_reason_and_delivers_nothing(tmp_path):
    run_dir = waiting_run(tmp_path)
    opener = fake_opener()
    result = decide(run_dir, tmp_path, DASHBOARD, "reject", reason="too broad", open_pr=True, opener=opener)
    assert result["status"] == "rejected" and result["pr_url"] is None and opener.calls == []
    assert events.read_events(run_dir)[-1]["text"] == "The GM rejected candidate bbbbbbb: too broad."


@pytest.mark.parametrize("status", ["running", "failed", "stopped", "approved", "rejected", "error"])
def test_only_a_run_waiting_for_the_gm_can_be_decided(tmp_path, status):
    run_dir = waiting_run(tmp_path, status)
    with pytest.raises(DecisionError, match="only a run waiting for the GM"):
        decide(run_dir, tmp_path, DASHBOARD, "approve")
    assert events.read_run(run_dir)["status"] == status and events.read_events(run_dir) == []


def test_only_an_approved_run_can_be_delivered(tmp_path):
    with pytest.raises(DecisionError, match="only an approved run"):
        deliver(waiting_run(tmp_path), tmp_path, DASHBOARD, fake_opener())


def test_an_unknown_decision_is_refused(tmp_path):
    with pytest.raises(DecisionError, match="unknown decision"):
        decide(waiting_run(tmp_path), tmp_path, DASHBOARD, "maybe")


# ---------------------------------------------------------------- the server behind the page's buttons


@pytest.fixture
def served(tmp_path):
    run_dir = waiting_run(tmp_path)
    server = make_server(run_dir, 0, tmp_path, DASHBOARD, token="secret-token")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    yield run_dir, port
    server.shutdown()
    server.server_close()


def request(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    send = {"Content-Type": "application/json", **(headers or {})}
    conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=send)
    response = conn.getresponse()
    data = response.read()
    return response.status, data, response


def decision(port, body, token="secret-token", **headers):
    return request(port, "POST", "/decide", body, {"X-Factory-Token": token, **headers})


def test_the_token_is_in_the_page_it_serves_but_never_in_the_file_on_disk(served):
    run_dir, port = served
    status, page, response = request(port, "GET", "/")
    assert status == 200 and b'window.FACTORY_TOKEN = "secret-token";' in page
    assert response.getheader("Cache-Control") == "no-store"
    assert (
        TOKEN_SLOT in (run_dir / "index.html").read_text()
        and "secret-token" not in (run_dir / "index.html").read_text()
    )


def test_the_run_files_are_served_for_the_page_to_follow(served):
    run_dir, port = served
    events.append_event(run_dir, {"actor": "announcer", "kind": "say", "text": "hello"}, 1.0)
    status, body, _ = request(port, "GET", "/events.jsonl")
    assert status == 200 and json.loads(body.decode().splitlines()[0])["text"] == "hello"
    assert request(port, "GET", "/run.json")[0] == 200


def test_a_decision_from_the_page_is_made_by_the_same_code_as_the_command(served):
    run_dir, port = served
    status, body, _ = decision(port, {"decision": "approve"}, Origin=f"http://127.0.0.1:{port}")
    result = json.loads(body)
    assert status == 200 and result["ok"] and result["status"] == "approved" and result["pr_url"] is None
    assert events.read_run(run_dir)["status"] == "approved"
    assert events.read_events(run_dir)[-1]["text"] == "The GM approved candidate bbbbbbb."


def test_a_rejection_from_the_page_carries_the_reason(served):
    run_dir, port = served
    status, body, _ = decision(port, {"decision": "reject", "reason": "not what I meant"})
    assert status == 200 and json.loads(body)["status"] == "rejected"
    assert "not what I meant" in events.read_events(run_dir)[-1]["text"]


def test_a_second_decision_is_refused(served):
    _, port = served
    assert decision(port, {"decision": "approve"})[0] == 200
    status, body, _ = decision(port, {"decision": "reject"})
    assert status == 409 and "only a run waiting" in json.loads(body)["error"]


@pytest.mark.parametrize(
    ("token", "headers"),
    [
        ("wrong", {}),
        ("", {}),
        ("secret-token", {"Origin": "https://evil.example"}),  # another website's page
        ("secret-token", {"Host": "evil.example:80"}),  # DNS rebinding
        ("secret-token", {"Origin": "http://localhost:1"}),  # right host, wrong port
    ],
)
def test_nothing_but_the_served_page_can_decide(served, token, headers):
    run_dir, port = served
    status, body, _ = decision(port, {"decision": "approve"}, token=token, **headers)
    assert status == 403 and not json.loads(body)["ok"]
    assert events.read_run(run_dir)["status"] == "waiting"  # untouched


@pytest.mark.parametrize("body", [{}, {"decision": "maybe"}, {"decision": 5}, []])
def test_a_malformed_decision_is_a_400_and_changes_nothing(served, body):
    run_dir, port = served
    assert decision(port, body)[0] == 400
    assert events.read_run(run_dir)["status"] == "waiting"


def test_other_paths_and_oversized_bodies_are_refused(served):
    run_dir, port = served
    assert request(port, "POST", "/elsewhere", {}, {"X-Factory-Token": "secret-token"})[0] == 404
    assert decision(port, {"decision": "approve", "reason": "x" * 5000})[0] == 413
    assert events.read_run(run_dir)["status"] == "waiting"


def test_a_decision_with_a_pr_from_the_page_uses_the_delivery_code(tmp_path, monkeypatch):
    from factory_lib import decide as decide_module

    opened = []
    monkeypatch.setattr(
        decide_module, "open_pr_for", lambda run, repo: opened.append(run["branch"]) or "https://example.test/pull/5"
    )
    run_dir = waiting_run(tmp_path)
    server = make_server(run_dir, 0, tmp_path, DASHBOARD, token="t")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        status, body, _ = decision(server.server_address[1], {"decision": "approve", "open_pr": True}, token="t")
        assert (
            status == 200
            and json.loads(body)["pr_url"] == "https://example.test/pull/5"
            and opened == ["factory-run/r1"]
        )
    finally:
        server.shutdown()
        server.server_close()


def test_git_is_not_needed_to_decide(tmp_path):
    # decide() only touches the run folder unless a PR is asked for: it works outside any repository
    run_dir = waiting_run(tmp_path)
    assert decide(run_dir, tmp_path / "no-repo", DASHBOARD, "approve")["status"] == "approved"
    assert git is not None
