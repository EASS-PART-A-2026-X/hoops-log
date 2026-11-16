# Hoops Log frontend

The browser app for Hoops Log: a 3D shot map, your shots compared with NBA players, a coach (Deni), XP and trophies. React 19, Vite, TypeScript and Three.js. It runs in the browser and calls the backend directly, so the backend must allow this origin (CORS, `backend/app/main.py`, which allows `http://localhost:5173` and `http://127.0.0.1:5173`).

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

3. **Open http://localhost:5173** (use `localhost` or `127.0.0.1`, other addresses are blocked by the backend's CORS list). The first time in a tab you see a PRESS START screen; press it to enter. Add `?title` to the address to see it again.

On a fresh backend database the app starts with three demo shots. The backend stores shots in SQLite, so they are still there after a restart.

### Where the backend is

The frontend calls `http://localhost:8000` by default. To use another backend, set `VITE_BACKEND_URL` when you start the dev server (it is read at build time, and the address must work from your browser, not only from the machine the server runs on):

```bash
VITE_BACKEND_URL=http://localhost:8001 npm run dev
```

If you change the backend's port, also check that its CORS list still contains the page's address.

## What is in it

- **My log**: the 3D court (heat map, 3D beams or flight paths), the shot list and the add-shot form in a drawer opened by the **Shots** button, "Watch shot" / "Watch session" replays, and a player dropdown in the top bar ("Shots of").
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
npm test              # Vitest + Testing Library, runs once (about 400 tests, no browser or backend needed)
npm run build         # type-checks with tsc, then bundles into dist/
npm run preview       # serves the built bundle (http://localhost:4173)
```

From the repo root, `scripts/ci.sh` runs the backend checks and then the frontend's `npm ci`, lint, tests and build (`--fast` only lints the frontend).

## If something goes wrong

- **"Can't reach the backend at http://localhost:8000. Is it running?":** the backend is not running, or it is on another port. Start it (step 1) or set `VITE_BACKEND_URL`.
- **A blank page and `504 Outdated Optimize Dep` in the browser console:** the dev server has a stale dependency cache (this happens after `npm install` adds a package). Stop `npm run dev` (Ctrl+C) and start it again.
- **The 3D court or Deni's 3D figure does not show:** the browser has no WebGL. The map falls back to the backend's flat chart, and Deni to a drawn face (see "Without WebGL" below).
- **Deni does not speak:** browsers block speech until you have clicked something on the page, and the sound button (top bar) and his Voice switch must be on.

## Court orientation (shot map)

The 3D court is seen the way a shooter sees it: from half court, looking at the basket. The **right** corner and wing are on your right and the **left** ones on your left.

The backend's zone names are unchanged: `left_*` zones have x < 25 and `right_*` zones have x > 25. The map mirrors x (`toWorld` in `src/court/geometry.ts`) so that larger x is on the right of the screen from this viewpoint. The flat fallback chart is flipped the same way, so the basket is at the top.

## Without WebGL

If the browser cannot start WebGL, the map shows the backend's flat `/chart.svg` instead (flipped so the basket is at the top, like the 3D court). That chart can only be filtered by player, so the area and result filters are disabled, and its colours (green made, red missed) come from the backend.
