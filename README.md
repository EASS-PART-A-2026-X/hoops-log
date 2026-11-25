# Hoops Log

Repository: https://github.com/EASS-PART-A-2026-X/hoops-log

A shot-chart tracker for basketball players and coaches: log shots on a court, see where you score, and turn a messy game recap into structured shots.

**Purpose:** shots recorded in notes apps and chat messages cannot be mapped or compared, so players never see where they are actually efficient.
**Operational principle:** after a player logs shots (with the add-shot form, or from EX3 by pasting a recap and confirming the proposed shots), the shots are saved and the chart shows made/missed by court position and zone; after a restart the same chart is still there.

## User stories
1. As a player, I can log a shot (where, made or missed) so that my chart builds up over time.
2. As a player, I can paste a messy recap ("missed a corner three, then hit a pull-up from the left elbow"), review the proposed shots and save them, so that I don't have to enter each shot by hand.
3. As a player, I can see my shots by zone and compare myself with NBA players so that I can see where I am efficient.
4. As a player, I log in with my own account so that nobody else can see, change or delete my shots. The shots I log are always under my username.
4b. As a new player with no shots, I can open a demo with made-up shots to see what a full court looks like, and I am told the demo is not mine and my own shots never go into it.
5. As a player, I can ask "where should I shoot more?" so that I get recommendations backed by my own numbers.

## Data sketch
Shot: x (float, 0-50 ft), y (float, 0-47 ft), made (bool), game_date (date, at most one day ahead of the server's date to allow for time zones), note (text, max 200). The player is the account's username: the server fills it in, and a client can never send it.

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
browser -> frontend (:5173) -> backend (:8000) -> ai-service (:8001)

Only the backend touches the database (SQLite) and calls the AI service.

## How to run
Shots are stored in SQLite, so they survive a restart. Every command runs from `backend/`.

### Locally
Requires [uv](https://docs.astral.sh/uv/) (0.12 or newer); uv installs Python 3.14 from `backend/.python-version`.

```bash
cd backend
uv run fastapi dev
```

On first start the app creates `data/app.db` (git-ignored). Every account starts with no shots; the app's DEMO button shows made-up ones to look at. In a second terminal:

```bash
curl http://localhost:8000/health   # prints {"status":"ok"}
curl http://localhost:8000/shots    # 401: log in first (see Accounts and security)
```

Interactive API docs: http://localhost:8000/docs

### With Docker
Requires Docker. Stop `fastapi dev` first (Ctrl+C): if it still holds port 8000, `curl` reaches it instead of the container.

```bash
docker build -t hoops-log-backend .
docker run -d --name backend -p 127.0.0.1:8000:8000 -v backend-data:/app/data hoops-log-backend
curl -sS --retry 10 --retry-all-errors --retry-delay 1 localhost:8000/health   # {"status":"ok"}
```

The named volume `backend-data` holds the database, so shots survive `docker rm -f backend` followed by the same `docker run` again. Without `-v backend-data:/app/data`, a new container starts with an empty database. `docker volume rm backend-data` deletes the data.

### Settings
| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/app.db` | Where the SQLite database file lives. See `backend/.env.example`. |
| `FRONTEND_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | The page addresses (comma separated) that may call the API from a browser. Set it to the real address when deployed. |
| `LOGIN_ATTEMPTS` | `30` | Login tries per address in 5 minutes. |
| `LOGIN_FAILURES` | `8` | Failed logins per address and account in 5 minutes. |
| `REGISTER_ATTEMPTS` | `10` | Sign-ups per address per hour. |

The app reads it from the environment: `DATABASE_URL=sqlite:///./other.db uv run fastapi dev`, or `docker run -e DATABASE_URL=...`.

### Endpoints
Every route needs `Authorization: Bearer <token>` (a missing or bad token is a 401), except `/health`, `/auth/register` and `/auth/login`. You only ever see your own shots: someone else's id is a 404, the same as a missing one.

| Request | What it does | Success |
|---|---|---|
| `GET /shots?offset=0&limit=50` | List a page (limit at most 100, offset at most 2147483647) | 200, or 422 if `limit` or `offset` is invalid or out of range |
| `POST /shots` | Create a shot (`x`, `y`, `made`, optional `game_date` and `note`). The player is your username, so sending a `player` is a 422 | 201 |
| `GET /shots/{id}` | Read one (ids start at 1) | 200, 404, or 422 if the id is below 1 or above 2147483647 |
| `PATCH /shots/{id}` | Change only the fields sent (`null` means unchanged) | 200, 404, or 422 (bad body, or an id below 1 or above 2147483647) |
| `DELETE /shots/{id}` | Delete one | 204, 404, or 422 if the id is below 1 or above 2147483647 |
| `GET /chart.svg?player=Name` | Shot chart as an SVG image (green circle = made, red cross = missed); `player` is optional. It ignores letter case and spaces around the name, so `yuly` and `Yuly` are the same player; it uses Unicode case folding, so `Straße` and `STRASSE` also match | 200, or 422 if `player` is empty or longer than 50 characters |
| `POST /auth/register` | Make an account (`email`, `username`, `password`, `password_confirm`) and log in; returns `{token, user}` | 201, 409 if the email or username is taken, 422, 429 |
| `POST /auth/login` | Log in with a username or an email and a password; returns `{token, user}` | 200, 401, 429 |
| `GET /auth/me` | Who the token belongs to | 200 |
| `POST /auth/logout` | End this login at once | 204 |
| `GET /demo/shots` | The built-in demo: 150 made-up shots (negative ids, the same every time, never stored and never mixed with your own) | 200 |
| `GET /health` | Liveness check, returns `{"status":"ok"}` | 200 |

```bash
curl -i --json '{"x":1.5,"y":4,"made":false}' -H "Authorization: Bearer $TOKEN" localhost:8000/shots
# 201: zone "left_corner_3" and shot_type "3PT" are computed from x, y, and player is your username
```

## Accounts and security
Every shot belongs to an account. You sign up with an email, a username and a password (typed twice), the backend gives you a login token, and the browser sends it with every request. Nobody can see, change, delete or draw another account's shots.

| What could go wrong | What stops it |
|---|---|
| A stranger calls the API with `curl` | Every route except `/health`, `/auth/register` and `/auth/login` answers 401 without a valid token. A test fails if a route is added without the lock. |
| Someone steals the database file | Passwords are stored only as salted scrypt hashes (a new random salt each, 16 MB of memory per guess), tokens only as SHA-256 hashes. Nothing in the file logs anyone in. |
| Someone guesses passwords | Rate limits per address (all attempts, and failed attempts per account). An unknown user and a wrong password get the same answer and take the same time. Passwords are 10 to 128 characters and not a common one. |
| One user reads or edits another's shots, or logs a shot as someone else | A shot has an owner and the server puts the account's username on it; a `player` in the request is refused. Someone else's shot is a 404, the same as a missing one, so ids cannot be probed. The client can never send an `owner_id`. |
| A token is stolen or forgotten | Tokens are 32 random bytes, last 7 days, at most 10 per user, and `POST /auth/logout` ends one at once. |
| A token leaks through an address | It is only accepted in the `Authorization` header, never in the URL. Login answers are marked `no-store`. |
| Another website tries to use your login | CORS names the exact frontend addresses. The token is not a cookie, so there is no CSRF. |
| Strange input | Every field has a length and character check. Tests send SQL, scripts, emoji and Hebrew to every field. |

**How it works.** `POST /auth/register` and `POST /auth/login` return `{token, user}`. The frontend keeps the token in `localStorage`, sends it as `Authorization: Bearer <token>`, and asks `/auth/me` on load to check it still works. When a request gets a 401, the login screen opens over the app, so a half-typed shot is not lost. The code is in `backend/app/` (`security.py` for passwords, tokens and limits, `deps.py` for the lock, `routers/auth.py` for the routes) and `frontend/src/auth/`.

**Not covered yet.**
- **HTTPS.** Run locally, the token travels as plain HTTP. A deployed app must sit behind HTTPS, and a section on that comes with the deployment.
- The email is not verified and there is no password reset (both need an email service).
- A token in `localStorage` can be read by a script injected into the page. React escapes everything it draws, and the browser tests try HTML in names.
- The rate limits live in memory, per process, and a restart clears them.
- Shots saved before accounts existed stay in the database file but belong to nobody: no account sees them and nothing deletes them. (An earlier version let the first account to sign up take them over; that was removed, because the first person to register should not get everything.)

## Test
From `backend/`:

```bash
uv run pytest                 # 307 passed
uv run ruff check .
uv run ruff format --check .
```

`tests/test_shots.py` starts with a testing-strategy comment listing every input partition; each test fixes one of them. `tests/test_court.py` checks the zone and 2PT/3PT rules. `tests/test_demo.py` checks the built-in demo (150 made-up shots, never stored), and `tests/test_restart.py` checks a shot is still there after the server restarts on the same database file. The other tests use a fresh in-memory database each.

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

(The `player` rows were found when a client could still send a player. It is now the account's username, which is limited to letters, digits and `_ . -`, so those inputs cannot happen.)

Plus one cosmetic bug: a missed shot at `x=0, y=0` was drawn partly outside the image. The breaker's 19 failing tests became permanent tests in `backend/tests/adversarial/`, and I added edge-value tests to the normal suite so the mutation score covers the fixes. It also reported what it tried that was fine (escaping, boundaries, unknown fields), and what is a decision rather than a bug: the API still accepts `x: "1.5"` and `made: "yes"` (Pydantic's default coercion); `test_lax_coercion_is_accepted_for_now` records that on purpose.

**3. One command that says whether a change is safe to merge.** `scripts/ci.sh` runs ruff, the formatter check, pytest and the mutation score (must be at least 95%). With `--docker` it also builds the image and checks that a shot survives `docker rm -f` plus a new `docker run` on the same volume, that it is gone without the volume, and a **kill test**: shots are posted in a loop, the container is `SIGKILL`ed at a random moment, and every shot the API acknowledged with 201 must still be there after the restart. `.githooks/pre-push` runs the quick version before every push (turn it on with `git config core.hooksPath .githooks`), and `.github/workflows/ci.yml` runs the full one on pull requests.

```bash
scripts/ci.sh            # about a minute
scripts/ci.sh --docker   # plus the Docker and kill tests, needs Docker
```

The checks found problems in their own tooling too: the first kill test reported 22 lost writes, which was my checker reading only the first 100 of 118 shots (the API returns at most 100 per page), not a lost write; and CI rejected my own lint error on the way in.

## API requests and results
Six requests (each one logged in, with a token), with the status code and the stage of FastAPI's pipeline that answers (1 route match, 2 JSON parse, 3 input validation, 4 my handler, 5 response).

| # | Request | Result | Stage | Why |
|---|---|---|---|---|
| 1 | `POST /shots` `{"x":15,"y":19,"made":true}` (logged in) | 201 | 5 | Valid; the body has an `id`, your username as `player`, `zone` "left_elbow", `shot_type` "2PT" |
| 2 | `GET /shots/999` | 404 `{"detail":"Shot not found"}` | 4 | The route matched and my handler ran; the id does not exist |
| 3 | `POST /shots` `{"x":51}` (logged in) | 422, 3 errors | 3 | `x` over 50, `y` and `made` missing; all reported at once, handler never ran |
| 4 | `PATCH /shots/999` `{"x":51}` | 422, 1 error | 3 | `x` over 50; validation runs before the handler, so the missing id is never checked |
| 5 | `GET /shot/1` (typo) | 404 `{"detail":"Not Found"}` | 1 | No route matched; none of my code ran |
| 6 | `DELETE /shots/1` twice | 204, then 404 | 5, then 4 | The first call deletes; the second finds nothing |

## AI use
Tools: Claude Code (Opus 5.5 and Sonnet 5.5) · Help received: it reviewed the repo against the Lecture 1 checklist and wrote the "How to run" section; for Lecture 2 it wrote the Shot models, the court geometry, the CRUD routes and the tests, and ran a check that breaks each rule on purpose to see that a named test fails; for Lecture 3 it converted the models to SQLModel, wrote the database session, seed and restart test, the Dockerfile and this README section, and broke the code on purpose (`commit()` to `flush()`, no seed guard) to see that the tests fail; for my babel PR (#18424) it helped trace the cause and write the code and fixture, and I reviewed the change and its output myself; for the router restructure it moved the routes into `app/routers/`, documented them in `/docs`, turned on more Ruff rules and rewrapped the 6 comment lines they flagged, and I removed the empty `backend/README.md`; for the verification work it wrote `/chart.svg`, the mutation runner, the Docker kill test, the CI script and the breaker agent definition, ran one breaker round in a separate agent that had not seen the code, and fixed what it found; I reproduced the reported bugs myself before accepting them · Checks I ran: started the server with `uv run fastapi dev` from `backend/`, sent the requests above with `curl` and compared each status code with the contract; ran `uv run pytest` (133 passed at the end of Lecture 3, 307 passed now) and `uv run ruff check .` (clean); ran `docker build -t hoops-log-backend .`, started the container with `-v backend-data:/app/data`, created a shot with `curl`, ran `docker rm -f backend`, started it again with the same volume and saw the shot still listed (and gone without `-v`); confirmed `curl http://localhost:8000/health` prints `{"status":"ok"}`

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
