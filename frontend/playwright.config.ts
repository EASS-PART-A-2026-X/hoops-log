import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { BACKEND_PORT, BACKEND_URL, BASE_URL, FRONTEND_PORT, assertSafeBackend, assertSafeFrontend, assertSafePorts } from './e2e/env'

// Before anything is started: a backend URL or port that points at the real one stops the run here.
assertSafePorts()
assertSafeBackend()
assertSafeFrontend()

/**
 * End-to-end tests: a real browser drives the real frontend against the real backend (FastAPI + SQLite).
 *
 * Two throwaway servers are started for the run, on ports of their own so nothing you already have running is
 * touched: the backend on 8011 with a fresh temporary database, and the frontend on 5199. They are never reused if
 * something is already there. The tests refuse a backend that is not on this machine, has no explicit port, or is on
 * the usual 8000 (where your own shots live), and the browser is only allowed to talk to the two throwaway servers.
 *
 * Set E2E_EXTERNAL=1 when you started both servers yourself (then nothing is started here, so keep them on ports
 * of their own, with a database you do not mind losing: the tests empty it before every test).
 * Set E2E_CHANNEL=msedge (or chrome) to use an installed browser instead of Playwright's Chromium.
 */
const external = process.env.E2E_EXTERNAL === '1'
// A folder of its own for the temporary database, made once by the main process (the test workers load this file
// too and must not make more) and removed when it exits.
const dbDir = !external && process.env.TEST_WORKER_INDEX === undefined ? mkdtempSync(path.join(os.tmpdir(), 'hoops-e2e-')) : ''
if (dbDir) {
  process.on('exit', () => {
    try {
      rmSync(dbDir, { recursive: true, force: true })
    } catch {
      /* the server may still hold the file on Windows: the temp folder is cleaned up by the system */
    }
  })
}
const dbFile = path.join(dbDir, 'app.db').replaceAll('\\', '/')

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // One shared database, so one test at a time, in file order.
  fullyParallel: false,
  workers: 1,
  // No retries: a flaky test must show up as a failure, not as a green run with a note. (The full run retries once, below,
  // so one bad night does not hide the other 100 results.)
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  // Two sizes of the same suite. "fast" is what every pull request runs (a few minutes); "full" is everything, with the
  // long monkey runs, and runs after a merge and at night. `npm run e2e:fast` and `npm run e2e` pick one each.
  projects: [
    {
      name: 'fast',
      testMatch: ['**/smoke.e2e.ts', '**/api.e2e.ts', '**/auth.e2e.ts', '**/log-journey.e2e.ts', '**/monkey.e2e.ts'],
      // One short monkey seed; the full run does them all.
      grepInvert: /monkey, seed [2-9]/,
    },
    { name: 'full', testMatch: '**/*.e2e.ts', retries: process.env.CI ? 1 : 0 },
  ],
  use: {
    baseURL: BASE_URL,
    channel: process.env.E2E_CHANNEL || undefined,
    viewport: { width: 1366, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Headless browsers have no GPU: software rendering is what lets the 3D court draw.
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: external
    ? undefined
    : [
        {
          command: `uv run fastapi run --host 127.0.0.1 --port ${BACKEND_PORT}`,
          cwd: '../backend',
          url: `${BACKEND_URL}/health`,
          // The tests make a few accounts and log in often, all from one address: the limits that slow down password guessing are
          // raised here (the real numbers are checked by the backend's own tests).
          env: { DATABASE_URL: `sqlite:///${dbFile}`, REGISTER_ATTEMPTS: '1000', LOGIN_ATTEMPTS: '1000', LOGIN_FAILURES: '1000' },
          // Never reuse a server that is already there: it could be one with real data.
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
          url: BASE_URL,
          env: { VITE_BACKEND_URL: BACKEND_URL },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
})
