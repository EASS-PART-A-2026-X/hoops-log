# Hoops Log AI service

The third service of Hoops Log: **Deni's brain**. It gets a conversation with the player and
the numbers the app worked out from their log, and answers with Deni's reply and, when the player
described shots ("hit one from the right corner, missed two from the left elbow"), **proposed** shots.

```
browser -> frontend (:5173) -> backend (:8000) -> ai-service (:8001)
```

It never saves anything and never talks to the database: the backend owns all stored data,
calls this service over HTTP, and only the player pressing Save writes a shot. The service does
not know who the shooter is either; the backend adds the player.

What the model is allowed to do, and what it is not:

- **It never calculates.** The app computes the player's numbers (shots, percentages, zones) and
  hands them over in `stats`; the model may state those and nothing else. The league numbers in
  them are estimates, and the model is told to say so.
- **It never writes coordinates for a named place.** A shot's place is a `spot` name from a fixed
  list ("right corner three"), and `app/spots.py` holds the exact feet; the model writes `x` and
  `y` only when the player gives feet. (An earlier version offered the model a `court_spot` tool
  instead; in a real run the model sometimes skipped it and made up the corner's coordinates, so
  the backend stored a corner three as a mid-range two. Now the model cannot.)
- **It cannot save a shot, and must not say it did.** It proposes; the player presses Save.
- **It is a fan-made character, not the real Deni Avdija.** It must not claim to be him, quote
  him or state facts about his life.
- **Everything in the conversation is data.** Instructions found in a message are ignored.

## Run it

From this folder (needs [uv](https://docs.astral.sh/uv/)):

```bash
AI_MODEL=test uv run fastapi dev --port 8001
curl localhost:8001/health      # {"status":"ok","model":"test"}
```

`AI_MODEL=test` is Pydantic AI's built-in fake model: no key, no network, canned answers, and the
response says `"model": "test"` so a fake answer cannot pass as a real one.
Interactive docs: http://localhost:8001/docs

### With a real model

Set `AI_MODEL` to a Pydantic AI model name and export that provider's key (see `.env.example`;
the app reads the environment, not the file). Never commit a key.

```bash
export GROQ_API_KEY=...            # your own key, from the provider's console
AI_MODEL=groq:openai/gpt-oss-120b uv run fastapi dev --port 8001
```

With `AI_MODEL` unset, `/health` still answers (with `"model": null`) and `/chat` answers `503`.
The backend's `GET /chat/status` reads that `model` field: no model means the app shows the
manual add-shot form.

### Who may call it

The backend is the only caller. Set `AI_SERVICE_TOKEN` on any host that strangers can reach, and
the backend sends the same value in an `X-Service-Token` header; without it `/chat` answers
`401` and nobody else can spend the model's quota. Unset (local development) there is no check.
`/health` is always open. The per-minute limit lives in the backend, which faces the users.

## API

| Method | Path | What |
|---|---|---|
| GET | `/health` | `{"status": "ok", "model": <name or null>}`. The model name is shown, never a key. |
| POST | `/chat` | A conversation and the player's numbers in, Deni's reply and proposed shots out. |

`POST /chat` body:

```json
{
  "messages": [
    {"role": "user", "text": "how am I doing?"},
    {"role": "deni", "text": "You made 18 of 40, about 45%."},
    {"role": "user", "text": "hit one from the right corner"}
  ],
  "stats": {"player": "Yuly", "attempts": 40, "made": 18, "fg_pct": 45.0,
            "three_attempts": 12, "three_made": 4, "three_pct": 33.3,
            "zones": [{"zone": "right_corner_3", "attempts": 6, "made": 3, "pct": 50.0, "nba_pct": 38.0}],
            "nba_fg": 46.0, "nba_three": 36.0},
  "today": "2026-11-20"
}
```

- `messages`: 1 to 12 messages (the app sends the last ones); each text is 1-2000 characters, the
  role is `user` or `deni`, and the **last one must be the player's**. Unknown fields are rejected.
- `stats` is optional (no shots yet): `made` cannot exceed `attempts`, at most 12 zones, percentages
  0-100. These are the numbers the model may state.
- `today` is optional (the player's date, so "yesterday" is theirs) and defaults to the server's.

Answer (`200`):

```json
{
  "reply": "Got it: one made three from the right corner. Tap Save to log it.",
  "proposals": [
    {"x": 47.5, "y": 3.0, "made": true, "game_date": "2026-11-20",
     "note": "caught and shot", "quote": "hit one from the right corner"}
  ],
  "model": "groq:openai/gpt-oss-120b"
}
```

- `reply`: what Deni says, 1-1500 characters, in the language of the player.
- `proposals`: at most 20 shots, usually none; `x` 0-50 and `y` 0-47 feet (the backend's court), so
  a proposal fits the backend's shot rules. `quote` is the player's words it came from. When
  something is unclear he asks in `reply` and proposes nothing for that shot.

| Status | When |
|---|---|
| 401 | `AI_SERVICE_TOKEN` is set and the `X-Service-Token` header is missing or wrong. |
| 422 | The request does not fit the contract (see above). |
| 429 | The provider says rate limit or quota. Try again in a minute. |
| 502 | The provider failed, or the model kept returning output that does not fit the contract (it gets 2 repair attempts), or one request used more than 6 model calls or 20,000 tokens. |
| 500 | Something nobody planned for. A plain sentence; the details go to the server log only. |
| 503 | No `AI_MODEL`, or the model is set up wrong (missing key, unknown provider). |
| 504 | One model call took longer than 30 seconds, or the whole request (repairs included) took longer than 60. |

Error messages are plain sentences; provider details go to the server log only.

## Test it

```bash
uv run pytest          # 96 tests, about a second
uv run ruff check . && uv run ruff format --check .
```

Tests make **no** model calls: they use Pydantic AI's `TestModel` and `FunctionModel`, and
`tests/conftest.py` sets `ALLOW_MODEL_REQUESTS = False` and clears `AI_MODEL`, the keys and the
token, so a test that reaches for a real model fails instead of calling out. They cover:

- the request contract (message counts and lengths, the last message being the player's, stats that
  do not add up) and the prompt: the conversation is one JSON line per message between a marker with
  a random part, so a message cannot close the block or fake another speaker;
- named spots turning into the table's exact feet (every spot), explicit feet kept as given, a place
  that is not a spot or feet being sent back for repair, and the repair of other bad output,
  including future dates, unprintable text and an empty or too long reply (the backend's own rules);
- every error status, the token, the usage limit and the 60-second deadline;
- `tests/test_spots.py` loads the backend's `court.py` and checks that every named spot gets the
  zone and shot type its name says (the backend is strict: a corner three must be more than 22 ft
  from the centre line).

They check the service's own behaviour, not how good a real model's answers are (that is the
evaluation work).

`scripts/ci.sh` runs this service's lint, format and tests together with the backend's.

## What a message costs (measured with the real model)

With `groq:openai/gpt-oss-120b` and low reasoning effort, one message is **one model call of about
1,300-1,400 input and 70-230 output tokens**, and takes about a second. Every request logs its own
cost (`chat used 1 model calls, 1364 input and 198 output tokens`, numbers only). On Groq's free tier
(about 8,000 tokens a minute and 200,000 a day for this model) that is **about five messages a minute
and about 130 a day**; past that the provider answers 429 and the player is told it is busy.

Two settings keep it honest: `max_retries` is 0, so a rate limit fails at once with that message instead
of being retried quietly by the provider's own client for ten seconds or more (the likely cause of the
12-34 s waits seen earlier), and `groq_reasoning_effort` is `low` for Groq models, which cut the wait
from seconds to about one second.

What the real model does with the rules, measured over 18 calls: a Hebrew message got a Hebrew reply 6
times of 6, and none of the 18 replies claimed that a shot was saved or logged. The model varies from
run to run, so these are samples, not a guarantee.

## Deadlines

They are nested so the inner one always fires first and says so: 30 s for one model call, 60 s for
the whole `/chat` (then it answers `504` and stops, so it does not keep spending the model's quota
for a caller who gave up), 70 s that the backend waits for this service, 90 s that the browser waits
for the backend.

## Who calls it

The backend calls `POST /chat` from its own `POST /chat` (see the main README), adds the zone and
shot type, limits requests to 10 a minute, and checks the answer against its own rules. The frontend's
chat with Deni is the screen that uses it. The browser never calls this service.

## Not here yet

Saved conversations (the history lives in the page for now), the proposed shots drawn on the court,
a Dockerfile and Docker Compose entry, the evaluation dataset with real-model results, and
deployment.
