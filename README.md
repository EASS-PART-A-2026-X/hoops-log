# Hoops Log

[![ci](https://github.com/EASS-PART-A-2026-X/hoops-log/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/EASS-PART-A-2026-X/hoops-log/actions/workflows/ci.yml)
[![e2e](https://github.com/EASS-PART-A-2026-X/hoops-log/actions/workflows/e2e.yml/badge.svg?branch=main)](https://github.com/EASS-PART-A-2026-X/hoops-log/actions/workflows/e2e.yml)

A shot chart for basketball players and coaches: log your shots, see where you score, and compare yourself with NBA players. A FastAPI backend stores the shots; a React app draws them on a 3D court.

![Hoops Log: the heat map of a player's shots on a 3D court, with the shooting percentage of each zone](docs/images/hoops-log.png)

[Run it](#run-it) · [Endpoints](#endpoints) · [Tests](#test) · [How I know the tests are good](#how-i-know-the-tests-are-good) · [AI use](#ai-use) · [Open-source contributions](#open-source-contributions)

**Status: EX2** (backend + browser frontend). The AI service is planned for EX3. The screenshot shows generated demo shots, not real games.

## Run it
Two programs run at once, each in its own terminal. You need [uv](https://docs.astral.sh/uv/) (0.12 or newer; it installs Python 3.14 for you) and Node 24 or newer.

```bash
cd backend && uv run fastapi dev          # API on http://localhost:8000
cd frontend && npm install && npm run dev # app on http://localhost:5173
```

Open http://localhost:5173 and press START. Shots live in SQLite (`backend/data/app.db`, git-ignored), so they survive a restart; a fresh database starts with three demo shots. The frontend's own README covers its settings, the tests and the browser tests ([frontend/README.md](frontend/README.md)).

Interactive API docs: http://localhost:8000/docs

### Backend only, with Docker
Stop `fastapi dev` first (Ctrl+C): if it still holds port 8000, `curl` reaches it instead of the container. Run these from `backend/`.

```bash
docker build -t hoops-log-backend .
docker run -d --name backend -p 127.0.0.1:8000:8000 -v backend-data:/app/data hoops-log-backend
curl -sS --retry 10 --retry-all-errors --retry-delay 1 localhost:8000/health   # {"status":"ok"}
```

The named volume holds the database, so shots survive `docker rm -f backend` and a new `docker run` with the same `-v`. Without it a new container starts empty (only the demo shots). `docker volume rm backend-data` deletes the data. The only setting is `DATABASE_URL` (default `sqlite:///./data/app.db`, see `backend/.env.example`); set it in the environment, or with `docker run -e`.

## What it is
**Purpose:** shots recorded in notes apps and chat messages cannot be mapped or compared, so players never see where they are actually efficient.
**Operational principle:** after a player logs shots (with the add-shot form, or from EX3 by pasting a recap and confirming the proposed shots), the shots are saved and the chart shows made and missed shots by court position and zone; after a restart the same chart is still there.

User stories:
1. As a player, I can log a shot (who, where, made or missed) so that my chart builds up over time.
2. As a player, I can see my shots and zone percentages on the court and compare them with NBA players.
3. As a coach, I can filter the chart by player, zone and result so that I can see who is efficient from where.
4. EX3: as a player, I can paste a messy recap ("missed a corner three, then hit a pull-up from the left elbow"), review the proposed shots and save them.
5. EX3: as a player, I can ask "where should I shoot more?" and get advice backed by my own numbers.

### Data
Shot: player (text, 1-50), x (float, 0-50 ft), y (float, 0-47 ft), made (bool), game_date (date, at most one day ahead of the server's date to allow for time zones), note (text, max 200).

The backend computes two more fields; a client can never send them:
- **zone**: left_corner_3, left_wing_3, top_3, right_wing_3, right_corner_3, left_elbow, right_elbow, mid_range, paint or restricted_area
- **shot_type**: 2PT or 3PT, from the distance between x, y and the hoop

Court rules: NBA half court, 50 ft wide × 47 ft deep, origin at the left baseline corner, hoop at (25, 5.25). The 3PT line is 22 ft from the hoop in the corners (up to where the straight line meets the arc, about 14 ft from the baseline) and 23.75 ft on the arc.

### How the parts fit
```mermaid
flowchart LR
  B[Browser] --> F["Frontend :5173"] --> A["Backend :8000"] --> D[(SQLite)]
  A -.->|planned, EX3| AI["AI service :8001"]
```
Only the backend touches the database. The AI service will be a separate, stateless service (FastAPI + Pydantic AI) that only reads free text: it turns a recap into shot proposals, which the user confirms before anything is saved. Counting, zones and geometry stay plain backend code. If it is down, logging shots still works.

### Endpoints
| Request | What it does | Success |
|---|---|---|
| `GET /shots?offset=0&limit=50` | List a page (limit at most 100, offset at most 2147483647) | 200, or 422 if `limit` or `offset` is invalid or out of range |
| `POST /shots` | Create a shot | 201 |
| `GET /shots/{id}` | Read one (ids start at 1) | 200, 404, or 422 if the id is below 1 or above 2147483647 |
| `PATCH /shots/{id}` | Change only the fields sent (`null` means unchanged) | 200, 404, or 422 (bad body, or an id below 1 or above 2147483647) |
| `DELETE /shots/{id}` | Delete one | 204, 404, or 422 if the id is below 1 or above 2147483647 |
| `GET /chart.svg?player=Name` | Shot chart as an SVG image (green circle = made, red cross = missed); `player` is optional. Letter case and spaces around the name are ignored, so `yuly` and `Yuly` are the same player | 200, or 422 if `player` is empty or longer than 50 characters |
| `GET /health` | Liveness check, returns `{"status":"ok"}` | 200 |

```bash
curl -i --json '{"player":"Yuly","x":1.5,"y":4,"made":false}' localhost:8000/shots
# 201: zone "left_corner_3" and shot_type "3PT" are computed from x, y
```

## Test
Backend, from `backend/`:

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

Frontend, from `frontend/`: `npm run lint`, `npm test` and `npm run build`, plus `npm run e2e` for the real-browser tests (see the frontend README).

`tests/test_shots.py` starts with a testing-strategy comment listing every input partition; each test fixes one of them. `tests/test_court.py` checks the zone and 2PT/3PT rules. `tests/test_seed.py` checks the demo data is added once, and `tests/test_restart.py` checks a shot is still there after the server restarts on the same database file. The other tests use a fresh in-memory database each.

## How I know the tests are good
Passing tests only show that the cases I thought of work. Three checks go further, and all of them run from a fresh clone with `uv` (and Docker for the last step).

**Mutation score.** `scripts/mutation_score.py` changes one thing at a time in `app/` (`<` to `<=`, `and` to `or`, `50` to `51`) and runs the tests; a change no test notices is a survivor. My first run scored 68.6%, mostly because the chart tests checked structure and not coordinates. After adding tests it scores 100%. The few changes that cannot alter behaviour are marked `# equivalent-mutant: <why>` in the code instead of being hidden.

```bash
cd backend && uv run python ../scripts/mutation_score.py   # about 40 s
```

**A second agent that tries to break it.** `.claude/agents/breaker.md` starts with no memory of how the code was built and may only use this README and `/openapi.json`. Its first round found five bugs that my 141 tests missed, four in EX1 code that was already merged: `NaN` or `1e999` as `x`, a 20-digit id or offset, a lone surrogate in `player`, and a control character that made `/chart.svg` invalid XML. All of them were 500s or broken output and are 422s now. Its 19 failing tests are permanent tests in `backend/tests/adversarial/`. The full log, including what it tried that was fine, is in [docs/adversarial-log.md](docs/adversarial-log.md).

**One command before merging.** `scripts/ci.sh` runs ruff, pytest and the mutation score (at least 95%) and the frontend checks. With `--docker` it also checks that a shot survives `docker rm -f` plus a new `docker run` on the same volume, and runs a kill test: shots are posted in a loop, the container is `SIGKILL`ed at a random moment, and every shot the API acknowledged with 201 must still be there after the restart. `.githooks/pre-push` runs the quick version (turn it on with `git config core.hooksPath .githooks`), and GitHub runs the full one on every pull request.

The checks found problems in their own tooling too: the first kill test reported 22 lost writes, which was my checker reading only the first 100 of 118 shots, not a lost write.

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
I used Claude Code (Opus 5.5 and Sonnet 5.5) for most of the typing: the models, court geometry, routes and tests, the SQLModel and Docker work, the chart, the mutation runner, the kill test, the breaker agent, the frontend, and drafts of this README. The babel fix (#18424) I traced with it and then reviewed line by line.

What I checked myself: every status code in the table above with `curl`; that tests fail when I break the code on purpose (`commit()` to `flush()`, no seed guard); the Docker volume test by hand; each bug the breaker reported, reproduced before I accepted it. The frontend was merged by pull request after a separate review agent commented on it, and I used it in a real browser before saying it worked.

## Open-source shortlist
| Repository | Stars (date checked) | License | CONTRIBUTING | Why it fits me |
|---|---|---|---|---|
| [udecode/plate](https://github.com/udecode/plate) | 16.7k (24 Oct 2026) | MIT | [CONTRIBUTING.md](https://github.com/udecode/plate/blob/main/CONTRIBUTING.md) | React/TS editor; I already have five merged PRs on main (docs, docx-io, two markdown fixes, yjs peer range) |
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
| 5 | [udecode/plate](https://github.com/udecode/plate) | [MIT](https://github.com/udecode/plate/blob/main/LICENSE) | 16.7k (4 Nov 2026) | [#5328](https://github.com/udecode/plate/pull/5328) | Fixed `deserializeMd` leaving a trailing `\r` on every line of a fenced code block with CRLF line endings, so `serializeMd` wrote CRLF inside an LF fence: the `code_block` rule now splits on `\r\n`, `\r` or `\n`, so CRLF and CR input give the same result as LF, and I added a spec for it (#5322). | squash-merged into `main` by zbeyens on 4 Nov 2026: [commit b9de659](https://github.com/udecode/plate/commit/b9de659cf742e10154e17b44e72ef5e50dbc8613), [PR page](https://github.com/udecode/plate/pull/5328) |
| 6 | [udecode/plate](https://github.com/udecode/plate) | [MIT](https://github.com/udecode/plate/blob/main/LICENSE) | 16.7k (4 Nov 2026) | [#5329](https://github.com/udecode/plate/pull/5329) | Fixed `deserializeMd` dropping a soft line break right after a link, mark or inline code (`a [link](x)\nb` became `linkb`): the leading newline is now removed only after a `<br>` html node, which is the case the old strip was written for, and I added a spec (#5321). | squash-merged into `main` by zbeyens on 4 Nov 2026: [commit 9bfec80](https://github.com/udecode/plate/commit/9bfec80ea22b7fc6a28c5971b3adc27df15ca51a), [PR page](https://github.com/udecode/plate/pull/5329) |
| 7 | [udecode/plate](https://github.com/udecode/plate) | [MIT](https://github.com/udecode/plate/blob/main/LICENSE) | 16.7k (17 Nov 2026) | [#5338](https://github.com/udecode/plate/pull/5338) | Fixed `@platejs/yjs` reporting an unmet peer dependency next to the current `@hocuspocus/provider` 4.x: the peer range is now `^3.4.0 \|\| ^4.0.0`, so both majors install without a warning (#5337). I checked the existing tests and typecheck on both versions and ran the real provider wrapper against a local server to confirm that two clients sync. | squash-merged into `main` by zbeyens on 11 Nov 2026: [commit 82b89b9](https://github.com/udecode/plate/commit/82b89b9c6132ddf46d6301590402f29966fead15), [PR page](https://github.com/udecode/plate/pull/5338) |
