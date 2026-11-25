# Hoops Log frontend

The browser app for Hoops Log: a 3D shot map, your shots compared with NBA players, a coach (Deni), XP and trophies. React 19, Vite, TypeScript and Three.js. It runs in the browser and calls the backend directly, so the backend must allow this origin (CORS, `backend/app/main.py`: it allows `http://localhost:5173` and `http://127.0.0.1:5173`, or the addresses in `FRONTEND_ORIGINS`).

## Run it

You need two programs running at once: the backend (API on port 8000) and this frontend (page on port 5173).

**Requirements:** Node 24 or newer (with npm), [uv](https://docs.astral.sh/uv/) for the backend, and a browser with WebGL (any recent Chrome, Edge, Firefox or Safari).

1. **Start the backend** in one terminal (details in the root README):

   ```bash
   cd backend
   uv run fastapi dev        # http://localhost:8000
   ```

2. **Start the frontend** in a second terminal:

   ```bash
   cd frontend
   npm install               # first time, and after the dependencies change
   npm run dev               # http://localhost:5173
   ```

3. **Open http://localhost:5173** (use `localhost` or `127.0.0.1`, other addresses are blocked by the backend's CORS list). The first time in a tab you see a PRESS START screen; press it, then log in or sign up (email, username, password, password again). The app only opens once you are logged in, and every account sees only its own shots. Every account starts with no shots (and sees only its own). Add `?title` to the address to see it again.

A new account starts with an empty court and two choices: add a first shot, or press **DEMO** to see made-up shots on a full court. The demo is read only, clearly marked, never saved, and never mixed with your own shots. The backend stores shots in SQLite, so they are still there after a restart.

### Where the backend is

The frontend calls `http://localhost:8000` by default. To use another backend, set `VITE_BACKEND_URL` when you start the dev server (it is read at build time, and the address must work from your browser, not only from the machine the server runs on):

```bash
VITE_BACKEND_URL=http://localhost:9000 npm run dev
```

The backend's CORS list names the address of the page (the frontend, :5173), not the backend's own port, so a different backend port needs no CORS change. Only if you serve the frontend from another address or port must that address be put in the backend's `FRONTEND_ORIGINS` environment variable (comma separated).

## What is in it

- **My log**: the 3D court (heat map, 3D beams or flight paths), the shot list and the add-shot form in a drawer opened by the **Shots** button, "Watch shot" / "Watch session" replays, and a **DEMO** button (made-up shots, read only) with a welcome for an empty log. There is no player to choose: the shots are your account's own, under your username.
- **vs NBA**: you against the league average or a chosen player, with a verdict and a face-off intro.
- **Players**: a ranking of NBA players closest to your style, your shot card (downloadable as a PNG), and the "Compare my shots" baseline.
- **XP, levels and trophies**: shown in the top bar; click the level badge for the trophy drawer.
- **Deni, the coach**: the face in the bottom-right corner. Click it for the big view with a 3D figure and questions. He is a fan-made, scripted coach: his lines are written in advance and use your own shots, there is no AI. His voice uses your browser's text to speech.
- **Optional HD voice**: a button in Deni's dialog. Off by default. When you switch it on, the browser downloads a speech model once (about 90 MB, from Hugging Face; the runtime comes from a public CDN) and makes the voice on your own device; what he says is never sent anywhere. Until it is ready, and if it fails, the browser's voice is used.

The NBA player numbers are typed in by hand and rounded, and the player zone tiles are estimates, not real zone data.

## Check it

Run these from `frontend/`:

```bash
npm run lint          # oxlint
npm test              # Vitest + Testing Library, runs once, needs no browser or backend (the browser tests are `npm run e2e`, below)
npm run build         # type-checks with tsc, then bundles into dist/
npm run preview       # serves the built bundle (http://localhost:4173)
```

From the repo root, `scripts/ci.sh` runs the backend checks (ruff, pytest and a mutation score, which takes about a minute) and then the frontend's `npm ci`, lint, tests and build. Things to know before you run it:

- `npm ci` deletes and reinstalls `frontend/node_modules`, so stop `npm run dev` first.
- `scripts/ci.sh --fast` skips the mutation score and only lints the frontend, and only if `frontend/node_modules` already exists (otherwise it prints a SKIP line).
- `scripts/ci.sh --docker` adds the Docker persistence test and needs Docker.
- Without npm the frontend steps are skipped on your machine (and fail on GitHub, where `CI=true`).

## End-to-end tests (a real browser)

`npm run e2e` opens a real browser, starts the real backend and the real frontend, and uses the app the way a person would: it logs, edits and deletes shots, opens every page, plays the film, downloads the shot card, talks to Deni, uses the keyboard and a phone-sized screen, and breaks things on purpose (backend down, slow, 500s, bad input, HTML in names).

```bash
cd frontend
npx playwright install chromium     # once: the browser the tests use
npm run e2e:fast                    # the fast set (about a minute): smoke, the log journey, the API, one short monkey
npm run e2e                         # everything (several minutes), with all the monkey seeds
npx playwright test --project=full log-journey   # one file
npx playwright test --project=full --ui          # watch it run, step by step
```

There are two sizes of the same suite (Playwright "projects"): **fast** and **full**. On GitHub every pull request runs the *fast* set, a few minutes, so it can gate a merge; the *full* suite (about 20 minutes on GitHub's slow machines) runs after a merge into `frontend` or `main`, every night, and by hand from the Actions tab. Always pass `--project=full` or `--project=fast` (or use the npm scripts): without it Playwright runs both.

**It never touches your own data.** The tests start their own backend on port **8011** with a fresh temporary database (deleted afterwards), and their own frontend on port **5199**. They never reuse a server that is already there. Three things enforce this: the backend and frontend addresses must be on this machine with an explicit port that is not the usual 8000 or 5173 (checked in the config before anything starts, and again for the API helper); the browser may only talk to those two throwaway servers, so a request to anything else on this machine, port 8000 above all, is stopped and fails the test; and outside hosts are blocked too, so nothing leaves the machine (the NBA photos and the HD voice download are blocked, which also tests the fallbacks). The tests log in as one account made at the start of the run, and the throwaway backend is started with the login and sign-up rate limits raised (they would otherwise slow the tests down). With `E2E_EXTERNAL=1` you start the servers yourself and nothing is started for you: keep them on ports of their own with a database you do not mind losing, because the tests empty it before every test.

**What the browser tests cannot show:** the throwaway backend does not list the test page's address (it is not on 5173) in its CORS allow-list, so the tests add the CORS headers to its answers. The backend's real CORS rules are checked over plain HTTP in `api`, not in the browser.

What is in `frontend/e2e/`:

| File | What it checks |
|---|---|
| `smoke` | the app opens, the PRESS START screen, three main screens really render (court, vs NBA, Deni), and the error guard itself (it sees a script error, console error, 500, failed request, 404, alert and a request to the real backend) |
| `auth` | PRESS START, then the login and sign-up screens: every mistake named before anything is sent, password fields hidden until you press their eye, a taken name, a wrong password, logging out, a login that ends while you type (the half-typed shot survives), two accounts kept apart; and the API over plain HTTP without a token, with a bad one, and across accounts |
| `log-journey` | add, edit and delete shots through the form; zone and type come from the backend; the numbers on screen match the backend; XP |
| `validation` | the browser's checks, the backend's 422 messages, Hebrew, emoji, HTML and SQL in names, trimming, dates |
| `map` | the 3D court draws, the filters and styles, replay and the shot film, the flat chart without WebGL |
| `demo` | the empty-account welcome (also without WebGL and on a phone), the demo (150 made-up shots, read only, never stored, never mixed with your own, no XP or toasts), and the demo over plain HTTP |
| `compare` | vs NBA, the face-off, the Players ranking and team filter, the shot card as a real PNG, trophies |
| `coach` | Deni's greetings, answers with your real numbers, the 3D figure, voice, HD voice failing gracefully, the cheat code |
| `layout` | a desktop window and a short one (680 high) with no page scroll, a very short one (600 high) that scrolls, a phone, keyboard-only use |
| `resilience` | backend down, slow, or returning 500; data deleted behind the page's back; 300 shots |
| `api` | the backend over plain HTTP: CORS, 422s, paging, ids never reused, `/chart.svg` |
| `monkey` | (the fast set runs seed 1 for 25 steps) a seeded monkey: random clicks, typing, keys, drags, resizes, reloads and form fuzzing, checked after every step |

**The monkey** uses a seeded random generator, so a run starts the same way for the same seed. It is not a guaranteed replay (what can be clicked depends on timing), so a failure prints the actions it really did, and that log is what to reproduce from. It also fails if most of its steps did nothing.

```bash
E2E_MONKEY_SEEDS=7,8,9 E2E_MONKEY_STEPS=200 npx playwright test --project=full monkey
E2E_MONKEY_VERBOSE=1 E2E_MONKEY_SEEDS=7 npx playwright test --project=full monkey    # print every action
```

**Every test fails on any browser error**: a script error, a `console.error`, a failed request, an HTTP error (4xx or 5xx) from the throwaway servers, an alert or confirm dialog, or a request to anything but the two throwaway servers. A test that causes one on purpose allows exactly that one line with `guard.allow(...)` (for example only `POST /shots` answering 422), so anything else still fails.

**A test named `KNOWN GAP`** would pin what the app does today for something that should change, and fail on purpose the day it is fixed. There are none at the moment.

Settings (environment variables): `E2E_CHANNEL=msedge` (or `chrome`) uses an installed browser instead of Playwright's Chromium; `E2E_EXTERNAL=1` skips starting the servers (start the backend on 8011, with `LOGIN_ATTEMPTS`, `LOGIN_FAILURES` and `REGISTER_ATTEMPTS` set to 1000, and the frontend on 5199, with `VITE_BACKEND_URL` pointing at the backend); `E2E_BACKEND_PORT`, `E2E_FRONTEND_PORT`, `E2E_BASE_URL` and `E2E_BACKEND_URL` change where they live. `npm run e2e:types` type-checks the test files. On GitHub the tests run in their own workflow, `e2e` (see its header for when each size runs).

## If something goes wrong

- **"Can't reach the backend at http://localhost:8000. Is it running?":** the backend is not running, or it is on another port. Start it (step 1) or set `VITE_BACKEND_URL`.
- **A blank page and `504 Outdated Optimize Dep` in the browser console:** the dev server has a stale dependency cache (this happens after `npm install` adds a package). Stop `npm run dev` (Ctrl+C) and start it again.
- **The 3D court or Deni's 3D figure does not show:** the browser has no WebGL. The map falls back to the backend's flat chart, and Deni to a drawn face (see "Without WebGL" below).
- **Deni does not speak:** browsers block speech until you have clicked something on the page, and the sound button (top bar) and his Voice switch must be on. A browser with no text to speech at all stays silent (the caption still shows); the HD voice button can still give him a voice there if the browser supports WebAssembly and AudioContext.

## Court orientation (shot map)

The 3D court is seen the way a shooter sees it: from half court, looking at the basket. The **right** corner and wing are on your right and the **left** ones on your left.

The backend's zone names are unchanged: `left_*` zones have x < 25 and `right_*` zones have x > 25. The map mirrors x (`toWorld` in `src/court/geometry.ts`) so that larger x is on the right of the screen from this viewpoint. The flat fallback chart is flipped the same way, so the basket is at the top.

## Without WebGL

If the browser cannot start WebGL, the map shows the backend's flat `/chart.svg` instead (flipped so the basket is at the top, like the 3D court). The area and result filters are disabled, and its colours (green made, red missed) come from the backend.
