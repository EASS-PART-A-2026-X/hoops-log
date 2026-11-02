# Adversarial log

The loop: one agent implements, a second agent (`.claude/agents/breaker.md`) starts with
no memory of how it was built and tries to break it using only the specification. Real
bugs become permanent tests; this log keeps what was found, including what was NOT a bug.

How to run a round: ask Claude Code to "use the breaker agent on the changes since main".
Tests it writes go to `backend/tests/adversarial/`.

## Round 1: 2 Nov 2026, scope: `GET /chart.svg` and `/shots` CRUD

Result: 19 failing tests, 5 real bugs, 1 decision. I re-ran the main ones by hand before
accepting them (NaN, huge id, huge offset, surrogate, control character): all reproduced.

| Attack | Spec sentence | Result | Fix |
|---|---|---|---|
| `x` = `NaN`, `Infinity`, `1e999` (raw JSON) | x is a float 0-50; bad input is 422 | BUG: 500. The 422 body echoed the input, and NaN cannot be sent as JSON | `main.py`: 422 handler that makes the error body JSON-safe |
| id `99999999999999999999` on GET/PATCH/DELETE | unknown id is 404, bad input 422 | BUG: 500 (SQLite integer overflow) | `routers/shots.py`: ids limited to the 64-bit range, else 422 |
| `offset=99999999999999999999` | offset is an integer >= 0 | BUG: 500 | same, `offset` limited to the 64-bit range |
| `player` = lone surrogate | player is text, 1-50 chars | BUG: 500 (SQLite cannot encode it) | `models.py`: rejected with 422 |
| `player` with a control character, then `/chart.svg` | chart is `image/svg+xml` | BUG: stored with 201, chart no longer valid XML for every viewer (my new code) | `models.py` rejects it; `chart.py` also replaces illegal characters, in case an old row has one |
| missed shot at `x=0, y=0` | x 0-50, y 0-47 are valid | minor BUG: cross drawn outside the image | `chart.py`: 12 px margin in the viewBox |
| `x` = `"1.5"`, `true`; `made` = `"yes"` | x is a float, made is a bool | SPEC UNCLEAR | Not changed. `test_lax_coercion_is_accepted_for_now` records the decision |

Checked and fine: escaping of `<script>`, quotes, `&`, `]]>`, emoji and Hebrew in names;
all range boundaries; extra and missing fields; wrong types; non-object bodies; ids 0, -1,
1.5 and `abc`; deleting twice; ids not reused; PATCH with null; pagination limits; the
chart after PATCH and DELETE.

Not tested: concurrent POSTs (the agent's harness shares one in-memory connection, which
made the result meaningless, so it removed the test).

One correction to the agent's test: it asserted marks stay within 0-500 by 0-470 px. That
was an assumption about the fix, not the spec, so the test now checks the drawing's own
viewBox.
