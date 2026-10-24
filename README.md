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
Requires [uv](https://docs.astral.sh/uv/) (0.12 or newer); uv installs Python 3.14 from `backend/.python-version`.

```bash
cd backend
uv run fastapi dev
```

In a second terminal:

```bash
curl http://localhost:8000/health   # prints {"status":"ok"}
```

Interactive API docs: http://localhost:8000/docs

The shots API keeps data in memory for now, so a restart empties it (a database arrives in Lecture 3):

| Request | What it does | Success |
|---|---|---|
| `GET /shots?offset=0&limit=50` | List a page (limit at most 100) | 200 |
| `POST /shots` | Create a shot | 201 |
| `GET /shots/{id}` | Read one | 200, or 404 |
| `PATCH /shots/{id}` | Change only the fields sent (`null` means unchanged) | 200, or 404 |
| `DELETE /shots/{id}` | Delete one | 204, or 404 |

```bash
curl -i --json '{"player":"Yuly","x":1.5,"y":4,"made":false}' localhost:8000/shots
# 201: zone "left_corner_3" and shot_type "3PT" are computed from x, y
```

## Test
From `backend/`:

```bash
uv run pytest                 # 130 passed
uv run ruff check .
uv run ruff format --check .
```

`tests/test_shots.py` starts with a testing-strategy comment listing every input partition; each test fixes one of them. `tests/test_court.py` checks the zone and 2PT/3PT rules.

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
Tools: Claude Code (Opus 5.5 and Sonnet 5.5) · Help received: it reviewed the repo against the Lecture 1 checklist and wrote the "How to run" section; for Lecture 2 it wrote the Shot models, the court geometry, the CRUD routes and the tests, and ran a check that breaks each rule on purpose to see that a named test fails · Checks I ran: started the server with `uv run fastapi dev` from `backend/`, sent the requests above with `curl` and compared each status code with the contract; ran `uv run pytest` (130 passed) and `uv run ruff check .`; confirmed `curl http://localhost:8000/health` prints `{"status":"ok"}`

## Open-source shortlist
| Repository | Stars (date checked) | License | CONTRIBUTING | Why it fits me |
|---|---|---|---|---|
| [udecode/plate](https://github.com/udecode/plate) | 16.7k (24 Oct 2026) | MIT | [CONTRIBUTING.md](https://github.com/udecode/plate/blob/main/CONTRIBUTING.md) | React/TS editor; I already have two merged PRs on main (docs, docx-io) |
| [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | 11.9k (24 Oct 2026) | BSD-3-Clause | [CONTRIBUTING.md](https://github.com/maplibre/maplibre-gl-js/blob/main/CONTRIBUTING.md) | TypeScript map renderer; I already have a merged bug fix on main |

## Open-source contributions
Student: Yuly Cohen ([@yulman2207](https://github.com/yulman2207))

| # | Repository | License | Stars (date checked) | PR | Contribution summary | Merge evidence (landed on main) |
|---|---|---|---|---|---|---|
| 1 | [udecode/plate](https://github.com/udecode/plate) | [MIT](https://github.com/udecode/plate/blob/main/LICENSE) | 16.7k (22 Oct 2026) | [#5219](https://github.com/udecode/plate/pull/5219) | Fixed the Next.js guide: it read `localStorage` during server render and crashed with `localStorage is not defined`; the example now restores the saved value in a `useEffect` after mount (#5153). | merged into `main` by zbeyens on 20 Oct 2026 (merge commit): [commit ffb2807](https://github.com/udecode/plate/commit/ffb28077a40e82ee07fff468da99b03c65693410), [PR page](https://github.com/udecode/plate/pull/5219) |
| 2 | [udecode/plate](https://github.com/udecode/plate) | [MIT](https://github.com/udecode/plate/blob/main/LICENSE) | 16.7k (22 Oct 2026) | [#5232](https://github.com/udecode/plate/pull/5232) | Fixed DOCX export dropping tables nested inside table cells: the exporter now builds a nested table with `buildTable`, at any depth, and I added a test (#5192). | squash-merged into `main` by zbeyens on 22 Oct 2026: [commit b3c826e](https://github.com/udecode/plate/commit/b3c826ee68af1e28472e29fef0d71a742f0c9b42), [PR page](https://github.com/udecode/plate/pull/5232) |
| 3 | [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | [BSD-3-Clause](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) | 11.9k (22 Oct 2026) | [#8847](https://github.com/maplibre/maplibre-gl-js/pull/8847) | Fixed a `TypeError` in `CrossFadedConstantBinder` when dash positions were never set: `dashFrom`/`dashTo` are now initialised to `null` like the pattern fields (#8846). | squash-merged into `main` by HarelM on 22 Oct 2026: [commit 0391300](https://github.com/maplibre/maplibre-gl-js/commit/03913009ee17311cead1afe55919589d4ed72988), [PR page](https://github.com/maplibre/maplibre-gl-js/pull/8847) |
