# Hoops Log AI service

The third service of Hoops Log. It reads a player's pasted notes ("hit one from the right
corner, missed two from the left elbow, 2 free throws") and **proposes** shots to log.

```
browser -> frontend (:5173) -> backend (:8000) -> ai-service (:8001)
```

It never saves anything and never talks to the database: the backend owns all stored data,
calls this service over HTTP, and only the user pressing Save writes a shot. The service does
not know who the shooter is either; the backend adds the player.

The model is used only where the input is free text. Counting, zones and ratings stay plain code
elsewhere; here, even a named place such as "right corner three" is turned into feet by code, never
by the model: the model's answer names the place (`spot`, one of a fixed list) and `app/spots.py`
holds the exact feet. The model writes `x` and `y` only when the notes themselves give feet. (An
earlier version offered the model a `court_spot` tool instead; in a real run the model sometimes
skipped it and made up the corner's coordinates, so the backend stored a corner three as a mid-range
two. Now the model cannot.)

## Run it

From this folder (needs [uv](https://docs.astral.sh/uv/)):

```bash
AI_MODEL=test uv run fastapi dev --port 8001
curl localhost:8001/health      # {"status":"ok","model":"test"}
```

`AI_MODEL=test` is Pydantic AI's built-in fake model: no key, no network, canned (empty)
answers, and the response says `"model": "test"` so a fake answer cannot pass as a real one.
Interactive docs: http://localhost:8001/docs

### With a real model

Set `AI_MODEL` to a Pydantic AI model name and export that provider's key (see `.env.example`;
the app reads the environment, not the file). Never commit a key.

```bash
export GROQ_API_KEY=...            # your own key, from the provider's console
AI_MODEL=groq:openai/gpt-oss-120b uv run fastapi dev --port 8001
```

With `AI_MODEL` unset, `/health` still answers (with `"model": null`) and `/extract` answers `503`.

### Who may call it

The backend is the only caller. Set `AI_SERVICE_TOKEN` on any host that strangers can reach, and
the backend sends the same value in an `X-Service-Token` header; without it `/extract` answers
`401` and nobody else can spend the model's quota. Unset (local development) there is no check.
`/health` is always open. There is no per-minute limit here: the backend, which faces the
users, will limit requests (not built yet).

## API

| Method | Path | What |
|---|---|---|
| GET | `/health` | `{"status": "ok", "model": <name or null>}`. The model name is shown, never a key. |
| POST | `/extract` | Notes in, proposed shots out. |

`POST /extract` body: `{"text": "...", "today": "2026-11-19"}`. `text` is 1-2000 characters;
`today` is optional (the player's date, so "yesterday" is theirs) and defaults to the server's.
Unknown fields are rejected.

Answer (`200`):

```json
{
  "proposals": [
    {"x": 47.5, "y": 3.0, "made": true, "game_date": "2026-11-18",
     "note": "caught and shot", "quote": "hit one from the right corner"}
  ],
  "questions": [],
  "skipped": ["2 free throws"],
  "model": "groq:openai/gpt-oss-120b"
}
```

- `proposals`: at most 20 shots; `x` 0-50 and `y` 0-47 feet (the backend's court), so a proposal
  fits the backend's shot rules. `quote` is the words it came from.
- `questions`: it asks instead of guessing (where, whether it went in, which day). An answer
  is never silent: with no shots, no questions and nothing skipped the model is sent back to
  ask one (in the notes' language); if it still says nothing, a plain English question is added.
- `skipped`: things that are not logged (free throws, assists...).

| Status | When |
|---|---|
| 401 | `AI_SERVICE_TOKEN` is set and the `X-Service-Token` header is missing or wrong. |
| 422 | The request does not fit the contract (empty or too long text, text with control characters, bad date, unknown field). |
| 429 | The provider says rate limit or quota. Try again in a minute. |
| 502 | The provider failed, or the model kept returning output that does not fit the contract (it gets 2 repair attempts), or one request used more than 6 model calls or 20,000 tokens. |
| 500 | Something nobody planned for. A plain sentence; the details go to the server log only. |
| 503 | No `AI_MODEL`, or the model is set up wrong (missing key, unknown provider). |
| 504 | One model call took longer than 30 seconds, or the whole request (repairs included) took longer than 60. |

Error messages are plain sentences; provider details go to the server log only.

## Test it

```bash
uv run pytest          # 60 tests, about a second
uv run ruff check . && uv run ruff format --check .
```

Tests make **no** model calls: they use Pydantic AI's `TestModel` and `FunctionModel`, and
`tests/conftest.py` sets `ALLOW_MODEL_REQUESTS = False` and clears `AI_MODEL`, the keys and the
token, so a test that reaches for a real model fails instead of calling out. They cover:

- the contract, and the prompt (the notes sit between markers with a random part, so they cannot
  close the block themselves);
- named spots turning into the table's exact feet (every spot), explicit feet kept as given, a place
  that is not a spot or feet being sent back for repair, and the repair of other bad output,
  including future dates and unprintable text (the backend's own rules);
- the never-silent rule, every error status, the token and the usage limit;
- `tests/test_spots.py` loads the backend's `court.py` and checks that every named spot gets the
  zone and shot type its name says (the backend is strict: a corner three must be more than 22 ft
  from the centre line).

They check the service's own behaviour, not how good a real model's answers are (that is the
evaluation work).

`scripts/ci.sh` runs this service's lint, format and tests together with the backend's.

## Deadlines

They are nested so the inner one always fires first and says so: 30 s for one model call, 60 s for
the whole `/extract` (then it answers `504` and stops, so it does not keep spending the model's quota
for a caller who gave up), 70 s that the backend waits for this service, 90 s that the browser waits
for the backend.

## Who calls it

The backend calls `POST /extract` from its own `POST /notes/extract` (see the main README), adds the
zone and shot type, limits requests to 10 a minute, and checks the answer against its own rules. The
frontend's "Paste notes" view is the first screen that uses it. The browser never calls this service.

## Not here yet

A Dockerfile and Docker Compose entry, the chat with Deni, the evaluation dataset with real-model
results, and deployment.
