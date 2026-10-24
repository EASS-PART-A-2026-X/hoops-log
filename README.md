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
Shot: player (text, 1-50), x (float, 0-50 ft), y (float, 0-47 ft), made (bool), game_date (date, not in the future), note (text, max 200)

Computed by backend code, never stored or sent by a client:
- **zone**: named area from x, y (left_corner_3, left_wing_3, top_3, right_wing_3, right_corner_3, left_elbow, right_elbow, mid_range, paint, restricted_area)
- **shot_type**: 2PT or 3PT from the distance between x, y and the hoop

Court rules: NBA half court, 50 ft wide × 47 ft deep, origin at the left baseline corner, hoop at (25, 5.25). The 3PT line is 22 ft from the hoop in the corners (the first 14 ft from the baseline) and 23.75 ft on the arc.

## The AI service
Two jobs, both stateless (the service never touches the database). The model reads text and classifies; code does the geometry and checks the numbers.
1. Recap to shots (built first). Input: free-text game recap. Structured output: a list of shot proposals, each with a zone, made, and an optional note. The backend maps each zone to a fixed spot on the court, so the same phrase always lands on the same x, y. Proposals are shown to the user to confirm or edit; nothing is saved until they do. If the AI service is down, logging shots by clicking still works.
2. Shot analyst. Input: a player's shots (sent by the backend) and a question. The agent calls tools (zone stats, period comparison by game_date, hot/cold zones) and returns a typed result: summary, key findings, recommendations. Every number comes from a tool result, and code rejects answers whose numbers don't match.

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

## AI use
Tools: Claude Code (Opus 5.5) · Help received: it reviewed the repo against the Lecture 1 checklist and wrote the "How to run" section · Checks I ran: started the server with `uv run fastapi dev` from `backend/` and confirmed `curl http://localhost:8000/health` prints `{"status":"ok"}`

## Open-source shortlist
| Repository | Stars (date checked) | License | Why it fits me |
|---|---|---|---|
| udecode/plate | 16.5k (21 Oct 2026) | MIT | React/TS editor; I already have a merged PR there |

## Open-source contributions
Student: Yuly Cohen ([@yulman2207](https://github.com/yulman2207))

| # | Repository | License | Stars (date checked) | PR | Contribution summary | Merge evidence (on main) |
|---|---|---|---|---|---|---|
| 1 | [udecode/plate](https://github.com/udecode/plate) | [MIT](https://github.com/udecode/plate/blob/main/LICENSE) | 16.7k (22 Oct 2026) | [#5219](https://github.com/udecode/plate/pull/5219) | Fixed the Next.js guide: it read `localStorage` during server render and crashed with `localStorage is not defined`; the example now restores the saved value in a `useEffect` after mount (#5153). | [ffb2807](https://github.com/udecode/plate/commit/ffb28077a40e82ee07fff468da99b03c65693410) |
| 2 | [udecode/plate](https://github.com/udecode/plate) | [MIT](https://github.com/udecode/plate/blob/main/LICENSE) | 16.7k (22 Oct 2026) | [#5232](https://github.com/udecode/plate/pull/5232) | Fixed DOCX export dropping tables nested inside table cells: the exporter now builds a nested table with `buildTable`, at any depth, and I added a test (#5192). | [b3c826e](https://github.com/udecode/plate/commit/b3c826ee68af1e28472e29fef0d71a742f0c9b42) |
| 3 | [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | [BSD-3-Clause](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt) | 11.9k (22 Oct 2026) | [#8847](https://github.com/maplibre/maplibre-gl-js/pull/8847) | Fixed a `TypeError` in `CrossFadedConstantBinder` when dash positions were never set: `dashFrom`/`dashTo` are now initialised to `null` like the pattern fields (#8846). | [0391300](https://github.com/maplibre/maplibre-gl-js/commit/03913009ee17311cead1afe55919589d4ed72988) |
