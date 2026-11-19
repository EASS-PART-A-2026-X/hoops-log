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
elsewhere; here, even a named place such as "right corner three" is turned into feet by a tool
(`court_spot` in `app/spots.py`), never by the model.

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
    {"x": 47.0, "y": 3.0, "made": true, "game_date": "2026-11-18",
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
| 422 | The request does not fit the contract (empty or too long text, bad date, unknown field). |
| 429 | The provider says rate limit or quota. Try again in a minute. |
| 502 | The provider failed, or the model kept returning output that does not fit the contract (it gets 2 repair attempts), or one request used more than 6 model calls or 20,000 tokens. |
| 503 | No `AI_MODEL`, or the provider's key is missing. |
| 504 | The model took longer than 30 seconds. |

Error messages are plain sentences; provider details go to the server log only.

## Test it

```bash
uv run pytest          # 32 tests, about a second
uv run ruff check . && uv run ruff format --check .
```

Tests make **no** model calls: they use Pydantic AI's `TestModel` and `FunctionModel`, and
`tests/conftest.py` sets `ALLOW_MODEL_REQUESTS = False` and clears `AI_MODEL` and the keys, so a
test that reaches for a real model fails instead of calling out. They cover the contract, the
prompt, the tool, the repair of bad output, the never-silent rule, every error status, and the
runaway limit. They check
the service's own behaviour, not how good a real model's answers are (that is the evaluation work).

`scripts/ci.sh` runs this service's lint, format and tests together with the backend's.

## Not here yet

A Dockerfile and Docker Compose entry, the backend calling this service, the frontend chat, and
the evaluation dataset with real-model results.
