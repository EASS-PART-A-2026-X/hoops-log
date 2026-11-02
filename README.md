# Hoops Log

A shot-chart tracker for basketball players and coaches: log shots on a court, see where you score, and turn a messy game recap into structured shots.

**Purpose:** shots recorded in notes apps and chat messages cannot be mapped or compared, so players never see where they are actually efficient.
**Operational principle:** after a player logs shots (by clicking the court, or by pasting a recap and confirming the proposed shots), the shots are saved and the chart shows made/missed by court position and zone; after a restart the same chart is still there.

## User stories
1. As a player, I can click a spot on the court to log a shot so that my chart builds up over time.
2. As a player, I can paste a messy recap ("missed a corner three, then hit a pull-up from the left elbow"), review the proposed shots and save them, so that I don't have to enter each shot by hand.
3. As a coach, I can filter the chart by player, zone, shot type and date range so that I can see who is efficient from where.
4. As a player, I can ask "where should I shoot more?" so that I get recommendations backed by my own numbers.

## Data sketch
Shot: player (text, 1-50), x (float, 0-50 ft), y (float, 0-47 ft), made (bool), game_date (date, at most one day ahead of the server's date to allow for time zones), note (text, max 200)

Computed by backend code, never stored or sent by a client:
- **zone**: named area from x, y (left_corner_3, left_wing_3, top_3, right_wing_3, right_corner_3, left_elbow, right_elbow, mid_range, paint, restricted_area)
- **shot_type**: 2PT or 3PT from the distance between x, y and the hoop

Court rules: NBA half court, 50 ft wide × 47 ft deep, origin at the left baseline corner, hoop at (25, 5.25). The 3PT line is 22 ft from the hoop in the corners (up to where the straight line meets the arc, about 14 ft from the baseline) and 23.75 ft on the arc.

## The AI service
One stateless service (FastAPI + Pydantic AI); it never touches the database. The rule: the model is used only where the input is free text. Counting and geometry are plain code, which is exact and cheap.

1. **Recap to shots (built first).** Input: a free-text game recap, in Hebrew or English. Structured output: a list of shot proposals, each with a zone, made, and an optional note. The zone names are always the English ones from the zone list above, whatever language the recap is in; nothing else in the app is in Hebrew. The backend maps each zone to a fixed spot on the court, so the same phrase always lands on the same x, y. Proposals are shown to the user to confirm or edit; nothing is saved until they do. If the AI service is down, logging shots by clicking still works.
   - Why a model: the input is messy text in two languages, and one paste can hold a whole game of shots. A form or a click is slow for that.
2. **Shot analyst (narrow).** The numbers are plain backend code, not AI: a stats endpoint returns attempts, makes and percentage per zone, hot and cold zones, and a comparison between two date ranges (by game_date). It works when the AI service is down. The AI service receives those stats and a question ("where should I shoot more?") and returns a typed result: summary, key findings, recommendations.
   - Why a model: only for understanding the question and writing the advice.
   - Code rejects an answer if a number in it does not appear in the stats it was given, if a recommendation does not state how many shots it rests on, or if it recommends anything from a zone with too few attempts (for example under 10).

## Data flow
browser -> frontend (:8501) -> backend (:8000) -> ai-service (:8001)

Only the backend touches the database (SQLite) and calls the AI service.

## How to run
Shots are stored in SQLite, so they survive a restart. Every command runs from `backend/`.

### Locally
Requires [uv](https://docs.astral.sh/uv/) (0.12 or newer); uv installs Python 3.14 from `backend/.python-version`.

```bash
cd backend
uv run fastapi dev
```

On first start the app creates `data/app.db` (git-ignored) and adds three demo shots if the table is empty. In a second terminal:

```bash
curl http://localhost:8000/health   # prints {"status":"ok"}
curl http://localhost:8000/shots    # the three demo shots
```

Interactive API docs: http://localhost:8000/docs

### With Docker
Requires Docker. Stop `fastapi dev` first (Ctrl+C): if it still holds port 8000, `curl` reaches it instead of the container.

```bash
docker build -t hoops-log-backend .
docker run -d --name backend -p 127.0.0.1:8000:8000 -v backend-data:/app/data hoops-log-backend
curl -sS --retry 10 --retry-all-errors --retry-delay 1 localhost:8000/health   # {"status":"ok"}
```

The named volume `backend-data` holds the database, so shots survive `docker rm -f backend` followed by the same `docker run` again. Without `-v backend-data:/app/data`, a new container starts with an empty database (only the demo shots). `docker volume rm backend-data` deletes the data.

### Settings
| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/app.db` | Where the SQLite database file lives. See `backend/.env.example`. |

The app reads it from the environment: `DATABASE_URL=sqlite:///./other.db uv run fastapi dev`, or `docker run -e DATABASE_URL=...`.

### Endpoints
| Request | What it does | Success |
|---|---|---|
| `GET /shots?offset=0&limit=50` | List a page (limit at most 100, offset at most 2147483647) | 200, or 422 if `limit` or `offset` is invalid or out of range |
| `POST /shots` | Create a shot | 201 |
| `GET /shots/{id}` | Read one (ids start at 1) | 200, 404, or 422 if the id is below 1 or above 2147483647 |
| `PATCH /shots/{id}` | Change only the fields sent (`null` means unchanged) | 200, 404, or 422 (bad body, or an id below 1 or above 2147483647) |
| `DELETE /shots/{id}` | Delete one | 204, 404, or 422 if the id is below 1 or above 2147483647 |
| `GET /chart.svg?player=Name` | Shot chart as an SVG image (green circle = made, red cross = missed); `player` is optional. It ignores letter case and spaces around the name, so `yuly` and `Yuly` are the same player; it uses Unicode case folding, so `Straße` and `STRASSE` also match | 200 |

```bash
curl -i --json '{"player":"Yuly","x":1.5,"y":4,"made":false}' localhost:8000/shots
# 201: zone "left_corner_3" and shot_type "3PT" are computed from x, y
```

## Test
From `backend/`:

```bash
uv run pytest                 # 307 passed
uv run ruff check .
uv run ruff format --check .
```

`tests/test_shots.py` starts with a testing-strategy comment listing every input partition; each test fixes one of them. `tests/test_court.py` checks the zone and 2PT/3PT rules. `tests/test_seed.py` checks the demo data is added once, and `tests/test_restart.py` checks a shot is still there after the server restarts on the same database file. The other tests use a fresh in-memory database each.

## How I know the tests are good
Passing tests only show that the cases I thought of work. Three tools, all in this repo, check the rest. Everything below runs from a fresh clone with only `uv` (and Docker for the last step).

**1. Mutation score: do the tests notice broken code?** `scripts/mutation_score.py` changes one thing at a time in `app/` (`<` to `<=`, `and` to `or`, `50` to `51`, ...) and runs the tests. A change no test notices is a "survivor". My first run scored **68.6%**: the 27 survivors were mostly in the new chart code (the tests checked structure, not coordinates) and in pagination limits. After adding tests for them it scores **100%** (101 of 101). A few mutants cannot change behaviour at all (for example `dx < 0` vs `dx <= 0` where `dx == 0` never reaches that branch); each is marked `# equivalent-mutant: <why>` in the code instead of being hidden.

```bash
cd backend
uv run python ../scripts/mutation_score.py              # whole app, about 40 s
uv run python ../scripts/mutation_score.py app/court.py # one file
```

**2. A breaker agent: can someone who did not write the code break it?** `.claude/agents/breaker.md` defines a second AI agent that starts with no memory of how the code was built and may only use this README and `/openapi.json` as the specification. It writes tests that must fail against the current code. Round 1 (full log in `docs/adversarial-log.md`) found **five real bugs that my 141 tests missed**, four of them in the EX1 code that was already merged:

| Request | Before | Now |
|---|---|---|
| `POST /shots` with `x` = `NaN`, `Infinity`, `1e999` | 500 | 422 |
| `GET/PATCH/DELETE /shots/99999999999999999999` | 500 | 422 |
| `GET /shots?offset=99999999999999999999` | 500 | 422 |
| `player` containing a lone surrogate | 500 | 422 |
| `player` containing a control character, then `GET /chart.svg` | 201, then a chart that is not valid XML for everyone | 422 |

Plus one cosmetic bug: a missed shot at `x=0, y=0` was drawn partly outside the image. The breaker's 19 failing tests became permanent tests in `backend/tests/adversarial/`, and I added edge-value tests to the normal suite so the mutation score covers the fixes. It also reported what it tried that was fine (escaping, boundaries, unknown fields), and what is a decision rather than a bug: the API still accepts `x: "1.5"` and `made: "yes"` (Pydantic's default coercion); `test_lax_coercion_is_accepted_for_now` records that on purpose.

**3. One command that says whether a change is safe to merge.** `scripts/ci.sh` runs ruff, the formatter check, pytest and the mutation score (must be at least 95%). With `--docker` it also builds the image and checks that a shot survives `docker rm -f` plus a new `docker run` on the same volume, that it is gone without the volume, and a **kill test**: shots are posted in a loop, the container is `SIGKILL`ed at a random moment, and every shot the API acknowledged with 201 must still be there after the restart. `.githooks/pre-push` runs the quick version before every push (turn it on with `git config core.hooksPath .githooks`), and `.github/workflows/ci.yml` runs the full one on pull requests.

```bash
scripts/ci.sh            # about a minute
scripts/ci.sh --docker   # plus the Docker and kill tests, needs Docker
```

The checks found problems in their own tooling too: the first kill test reported 22 lost writes, which was my checker reading only the first 100 of 118 shots (the API returns at most 100 per page), not a lost write; and CI rejected my own lint error on the way in.

## API requests and results
Six requests, with the status code and the stage of FastAPI's pipeline that answers (1 route match, 2 JSON parse, 3 input validation, 4 my handler, 5 response).

| # | Request | Result | Stage | Why |
|---|---|---|---|---|
| 1 | `POST /shots` `{"player":"Yuly","x":15,"y":19,"made":true}` | 201 | 5 | Valid; the body has an `id`, `zone` "left_elbow", `shot_type` "2PT" |
| 2 | `GET /shots/999` | 404 `{"detail":"Shot not found"}` | 4 | The route matched and my handler ran; the id does not exist |
| 3 | `POST /shots` `{"player":"","x":51}` | 422, 4 errors | 3 | `player` too short, `x` over 50, `y` and `made` missing; all reported at once, handler never ran |
| 4 | `PATCH /shots/999` `{"x":51}` | 422, 1 error | 3 | `x` over 50; validation runs before the handler, so the missing id is never checked |
| 5 | `GET /shot/1` (typo) | 404 `{"detail":"Not Found"}` | 1 | No route matched; none of my code ran |
| 6 | `DELETE /shots/1` twice | 204, then 404 | 5, then 4 | The first call deletes; the second finds nothing |

## AI use
Tools: Claude Code (Opus 5.5 and Sonnet 5.5) · Help received: it reviewed the repo against the Lecture 1 checklist and wrote the "How to run" section; for Lecture 2 it wrote the Shot models, the court geometry, the CRUD routes and the tests, and ran a check that breaks each rule on purpose to see that a named test fails; for Lecture 3 it converted the models to SQLModel, wrote the database session, seed and restart test, the Dockerfile and this README section, and broke the code on purpose (`commit()` to `flush()`, no seed guard) to see that the tests fail; for my babel PR (#18424) it helped trace the cause and write the code and fixture, and I reviewed the change and its output myself; for the router restructure it moved the routes into `app/routers/`, documented them in `/docs`, turned on more Ruff rules and rewrapped the 6 comment lines they flagged, and I removed the empty `backend/README.md`; for the verification work it wrote `/chart.svg`, the mutation runner, the Docker kill test, the CI script and the breaker agent definition, ran one breaker round in a separate agent that had not seen the code, and fixed what it found; I reproduced the reported bugs myself before accepting them · Checks I ran: started the server with `uv run fastapi dev` from `backend/`, sent the requests above with `curl` and compared each status code with the contract; ran `uv run pytest` (133 passed at the end of Lecture 3, 307 passed now) and `uv run ruff check .` (clean); ran `docker build -t hoops-log-backend .`, started the container with `-v backend-data:/app/data`, created a shot with `curl`, ran `docker rm -f backend`, started it again with the same volume and saw the shot still listed (and gone without `-v`); confirmed `curl http://localhost:8000/health` prints `{"status":"ok"}`

## Open-source shortlist
| Repository | Stars (date checked) | License | CONTRIBUTING | Why it fits me |
|---|---|---|---|---|
| [udecode/plate](https://github.com/udecode/plate) | 16.7k (24 Oct 2026) | MIT | [CONTRIBUTING.md](https://github.com/udecode/plate/blob/main/CONTRIBUTING.md) | React/TS editor; I already have two merged PRs on main (docs, docx-io) |
| [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | 11.9k (24 Oct 2026) | BSD-3-Clause | [CONTRIBUTING.md](https://github.com/maplibre/maplibre-gl-js/blob/main/CONTRIBUTING.md) | TypeScript map renderer; I already have a merged bug fix on main |
| [babel/babel](https://github.com/babel/babel) | 44.1k (26 Oct 2026) | MIT | [CONTRIBUTING.md](https://github.com/babel/babel/blob/main/CONTRIBUTING.md) | JavaScript/TypeScript compiler; I already have a merged generator bug fix on main |

## Open-source contributions
Student: Yuly Cohen ([@yulman2207](https://github.com/yulman2207))

| # | Repository | License | Stars (date checked) | PR | Contribution summary | Merge evidence (landed on main) |
|---|---|---|---|---|---|---|
| 1 | [udecode/plate](https://github.com/udecode/plate) | [MIT](https://github.com/udecode/plate/blob/main/LICENSE) | 16.7k (22 Oct 2026) | [#5219](https://github.com/udecode/plate/pull/5219) | Fixed the Next.js guide: it read `localStorage` during server render and crashed with `localStorage is not defined`; the example now restores the saved value in a `useEffect` after mount (#5153). | merged into `main` by zbeyens on 20 Oct 2026 (merge commit): [commit ffb2807](https://github.com/udecode/plate/commit/ffb28077a40e82ee07fff468da99b03c65693410), [PR page](https://github.com/udecode/plate/pull/5219) |
| 2 | [udecode/plate](https://github.com/udecode/plate) | [MIT](https://github.com/udecode/plate/blob/main/LICENSE) | 16.7k (22 Oct 2026) | [#5232](https://github.com/udecode/plate/pull/5232) | Fixed DOCX export dropping tables nested inside table cells: the exporter now builds a nested table with `buildTable`, at any depth, and I added a test (#5192). | squash-merged into `main` by zbeyens on 22 Oct 2026: [commit b3c826e](https://github.com/udecode/plate/commit/b3c826ee68af1e28472e29fef0d71a742f0c9b42), [PR page](https://github.com/udecode/plate/pull/5232) |
| 3 | [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | [BSD-3-Clause](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) | 11.9k (22 Oct 2026) | [#8847](https://github.com/maplibre/maplibre-gl-js/pull/8847) | Fixed a `TypeError` in `CrossFadedConstantBinder` when dash positions were never set: `dashFrom`/`dashTo` are now initialised to `null` like the pattern fields (#8846). | squash-merged into `main` by HarelM on 22 Oct 2026: [commit 0391300](https://github.com/maplibre/maplibre-gl-js/commit/03913009ee17311cead1afe55919589d4ed72988), [PR page](https://github.com/maplibre/maplibre-gl-js/pull/8847) |
| 4 | [babel/babel](https://github.com/babel/babel) | [MIT](https://github.com/babel/babel/blob/main/LICENSE) | 44.1k (26 Oct 2026) | [#18424](https://github.com/babel/babel/pull/18424) | Fixed the generator dropping parentheses around a TypeScript instantiation expression operand: `(f \|\| g)<string>` was printed as `f \|\| g<string>`, which changes what the code means. `hasPostfixPart` now treats the operand of a `TSInstantiationExpression` as a postfix position, and I added a fixture covering operands that need and don't need parentheses (#18358). | squash-merged into `main` by nicolo-ribaudo on 26 Oct 2026: [commit 1c0bea6](https://github.com/babel/babel/commit/1c0bea6825097075fa8fda58f9c2136c2db4a4aa), [PR page](https://github.com/babel/babel/pull/18424) |
