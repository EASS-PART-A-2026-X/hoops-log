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
