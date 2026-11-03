# Hoops Log frontend

React + Vite + TypeScript. It runs in the browser and calls the backend directly, so the backend must allow this origin (CORS, `backend/app/main.py`).

## Run

Needs Node 24 or newer. Start the backend first (see the root README), then from `frontend/`:

```bash
npm install
npm run dev        # http://localhost:5173
```

## Check

```bash
npm run lint
npm run build      # type-checks, then bundles
```

## Court orientation (shot map)

The 3D court is seen the way a shooter sees it: from half court, looking at the basket. The **right** corner and wing are on your right and the **left** ones on your left.

The backend's zone names are unchanged: `left_*` zones have x < 25 and `right_*` zones have x > 25. The map mirrors x (`toWorld` in `src/court/geometry.ts`) so that larger x is on the right of the screen from this viewpoint. The flat fallback chart is flipped the same way, so the basket is at the top.
