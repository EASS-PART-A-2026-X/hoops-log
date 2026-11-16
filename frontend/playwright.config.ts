import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { BACKEND_PORT, BACKEND_URL, BASE_URL, FRONTEND_PORT } from './e2e/env'

/**
 * End-to-end tests: a real browser drives the real frontend against the real backend (FastAPI + SQLite).
 *
 * Two throwaway servers are started for the run, on ports of their own so nothing you already have running is
 * touched: the backend on 8011 with a fresh temporary database, and the frontend on 5199. The tests never talk
 * to the usual 8000 (that is where your own shots live) and refuse to if they are pointed there.
 *
 * Set E2E_EXTERNAL=1 when you started both servers yourself (then nothing is started here).
 * Set E2E_CHANNEL=msedge (or chrome) to use an installed browser instead of Playwright's Chromium.
 */
const external = process.env.E2E_EXTERNAL === '1'
const dbFile = path.join(os.tmpdir(), `hoops-e2e-${process.pid}.db`).replaceAll('\\', '/')

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // One shared database, so one test at a time, in file order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  // Two sizes of the same suite. "fast" is what every pull request runs (a few minutes); "full" is everything, with the
  // long monkey runs, and runs after a merge and at night. `npm run e2e:fast` and `npm run e2e` pick one each.
  projects: [
    { name: 'fast', testMatch: ['**/smoke.e2e.ts', '**/api.e2e.ts', '**/log-journey.e2e.ts', '**/monkey.e2e.ts'] },
    { name: 'full', testMatch: '**/*.e2e.ts' },
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
          env: { DATABASE_URL: `sqlite:///${dbFile}` },
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
