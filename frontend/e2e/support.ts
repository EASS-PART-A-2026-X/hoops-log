import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { BACKEND_URL, BASE_URL, assertSafeBackend, assertSafeFrontend } from './env'

// ---------------------------------------------------------------------------------------------
// Data: talk to the backend directly, the way a script or another client would.
// ---------------------------------------------------------------------------------------------

export interface ShotInput {
  x: number
  y: number
  made: boolean
  game_date?: string
  note?: string
}
export interface ShotRow extends ShotInput {
  id: number
  /** The account's username: the server fills it in. */
  player: string
  game_date: string
  zone: string
  shot_type: '2PT' | '3PT'
}

export class Api {
  constructor(private readonly request: APIRequestContext) {
    assertSafeBackend()
  }

  async list(): Promise<ShotRow[]> {
    const all: ShotRow[] = []
    for (let offset = 0; ; offset += 100) {
      const res = await this.request.get(`${BACKEND_URL}/shots?limit=100&offset=${offset}`)
      expect(res.ok()).toBe(true)
      const page = (await res.json()) as ShotRow[]
      all.push(...page)
      if (page.length < 100) return all
    }
  }

  async add(shot: ShotInput): Promise<ShotRow> {
    const res = await this.request.post(`${BACKEND_URL}/shots`, { data: shot })
    expect(res.status(), await res.text()).toBe(201)
    return (await res.json()) as ShotRow
  }

  async seed(shots: ShotInput[]): Promise<ShotRow[]> {
    const rows: ShotRow[] = []
    for (const shot of shots) rows.push(await this.add(shot))
    return rows
  }

  async remove(id: number): Promise<void> {
    const res = await this.request.delete(`${BACKEND_URL}/shots/${id}`)
    expect(res.status(), `deleting shot #${id}`).toBe(204)
  }

  async clear(): Promise<void> {
    for (const shot of await this.list()) {
      await this.remove(shot.id)
    }
  }
}

/** A small, repeatable random number generator, so a "random" data set (or a monkey run) can be replayed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Spots around the court: restricted area, paint, mid-range, elbows, corners, wings and the top of the key. */
const SPOTS: [number, number][] = [
  [25, 6],
  [22, 10],
  [28, 9],
  [15, 15],
  [36, 14],
  [14, 19],
  [37, 19],
  [3, 5],
  [47, 5],
  [6, 27],
  [44, 26],
  [25, 31],
]

/** Local calendar date, `daysAgo` days back, as YYYY-MM-DD (what the backend and the form use). */
export function dayString(daysAgo = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `count` repeatable shots over the last weeks, spread over every area of the court. */
export function makeShots(count: number, opts: { seed?: number; makeRate?: number } = {}): ShotInput[] {
  const next = rng(opts.seed ?? 1)
  const rate = opts.makeRate ?? 0.5
  return Array.from({ length: count }, (_, i) => {
    const [x, y] = SPOTS[Math.floor(next() * SPOTS.length)]!
    const jitter = () => Math.round((next() - 0.5) * 20) / 10 // up to a foot either way, one decimal
    return {
      x: Math.min(50, Math.max(0, Math.round((x + jitter()) * 10) / 10)),
      y: Math.min(47, Math.max(0, Math.round((y + jitter()) * 10) / 10)),
      made: next() < rate,
      game_date: dayString(i % 21),
    }
  })
}

// ---------------------------------------------------------------------------------------------
// The browser: a page that fails the test on any error, never reaches the internet, and talks to the
// throwaway backend (which does not know this page's origin, so the page route adds the CORS headers).
// ---------------------------------------------------------------------------------------------

/** This machine (or a data:/blob:/about: URL, which never leaves the page). */
const isLocal = (url: string): boolean => {
  try {
    const u = new URL(url)
    return !/^https?:$/.test(u.protocol) || u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  } catch {
    return true
  }
}

/** An address that is this machine or the local network, in any spelling (not "localhost" or 127.0.0.1, which are handled apart). */
const isPrivateHost = (url: string): boolean => {
  try {
    const host = new URL(url).hostname
    return /^(127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1?\]$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i.test(host) || host.endsWith('.local') || host.endsWith('.internal')
  } catch {
    return false
  }
}

/** The only two servers the browser may talk to: the throwaway frontend and the throwaway backend. */
const ALLOWED_ORIGINS = new Set([new URL(BASE_URL).origin, new URL(BACKEND_URL).origin])
const isAllowedOrigin = (url: string): boolean => {
  try {
    const u = new URL(url)
    return !/^https?:$/.test(u.protocol) || ALLOWED_ORIGINS.has(u.origin)
  } catch {
    return true
  }
}

/** Everything the browser complained about during a test. A test that provokes an error on purpose allows it. */
export class Guard {
  readonly seen: string[] = []
  private readonly allowed: RegExp[] = []
  allow(pattern: RegExp): void {
    this.allowed.push(pattern)
  }
  unexpected(): string[] {
    return this.seen.filter((line) => !this.allowed.some((p) => p.test(line)))
  }
}

/** The one account every test is logged in as (made once per run). Tests about accounts make their own. */
export const E2E_PASSWORD = 'e2e runner password 1'

export interface Account {
  token: string
  id: number
  username: string
}

/** Make an account over HTTP, or log in to it when it already exists (a backend that was not started fresh). */
export async function makeAccount(request: APIRequestContext, username: string, password = E2E_PASSWORD): Promise<Account & { email: string; password: string }> {
  const email = `${username.toLowerCase()}@example.com`
  const made = await request.post(`${BACKEND_URL}/auth/register`, { data: { email, username, password, password_confirm: password } })
  const res = made.status() === 409 ? await request.post(`${BACKEND_URL}/auth/login`, { data: { login: username, password } }) : made
  expect(res.ok(), `making the account ${username}: ${await res.text()}`).toBe(true)
  const body = (await res.json()) as { token: string; user: { id: number; username: string } }
  return { token: body.token, id: body.user.id, username: body.user.username, email, password }
}

/** A name nobody used before (usernames are 3 to 30 letters, digits, _ . -). */
export const uniqueName = (prefix = 'u'): string => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

interface Fixtures {
  api: Api
  /** Every request to the backend that is not the browser's (the api helper and `request`) carries this account's token. */
  account: Account
  /** A request context with no token at all: what a stranger can do. */
  anonRequest: APIRequestContext
  /** The browser starts logged in as `account`, unless a test turns this off (to see the login screen). */
  loggedIn: boolean
  guard: Guard
  /** The title screen is skipped unless a test turns this off. */
  seenTitle: boolean
  /** Deni stays quiet (no voice, no unprompted remarks) and the sound is off, unless a test turns this off. */
  quiet: boolean
}

interface WorkerFixtures {
  runAccount: Account
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  loggedIn: [true, { option: true }],
  seenTitle: [true, { option: true }],

  // One account for the whole run. The first account on a fresh database also takes over the three demo shots, which
  // every test then clears like any others.
  runAccount: [
    // oxlint-disable-next-line no-empty-pattern
    async ({ playwright }, provide) => {
      assertSafeBackend()
      const context = await playwright.request.newContext()
      const made = await makeAccount(context, 'e2e-runner')
      await context.dispose()
      await provide({ token: made.token, id: made.id, username: made.username })
    },
    { scope: 'worker' },
  ],
  account: async ({ runAccount }, provide) => {
    await provide(runAccount)
  },
  // The built-in `request` is replaced: same thing, but logged in as the account.
  request: async ({ playwright, account }, provide) => {
    const context = await playwright.request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${account.token}` } })
    await provide(context)
    await context.dispose()
  },
  anonRequest: async ({ playwright }, provide) => {
    const context = await playwright.request.newContext()
    await provide(context)
    await context.dispose()
  },
  quiet: [true, { option: true }],

  // Playwright wants the first argument written as a destructuring pattern, even when it is empty.
  // oxlint-disable-next-line no-empty-pattern
  guard: async ({}, provide) => {
    const guard = new Guard()
    await provide(guard)
    expect(guard.unexpected(), 'the browser reported problems').toEqual([])
  },

  // Every test starts with an empty table, whether it asks for the api or not.
  api: [
    async ({ request }, provide) => {
      const api = new Api(request)
      await api.clear()
      await provide(api)
    },
    { auto: true },
  ],

  page: async ({ page, guard, seenTitle, quiet, loggedIn, account }, provide) => {
    assertSafeBackend()
    assertSafeFrontend()
    await page.addInitScript(
      ({ seenTitle, quiet, token }) => {
        try {
          if (token && !window.sessionStorage.getItem('e2e-token-set')) {
            // Only the first load of a tab: a test that logs out (or whose login ends) must not be logged in again by a reload.
            window.localStorage.setItem('hoops-token', token)
            window.sessionStorage.setItem('e2e-token-set', '1')
          }
          if (seenTitle) window.sessionStorage.setItem('hoops-title-seen', '1')
          if (quiet) {
            window.localStorage.setItem('coach-chatter', '0')
            window.localStorage.setItem('coach-voice', '0')
            window.localStorage.setItem('hoops-muted', '1')
          }
        } catch {
          /* storage blocked: the app copes with that too */
        }
      },
      { seenTitle, quiet, token: loggedIn ? account.token : '' },
    )

    let lastNavigation = 0
    let closing = false
    const navigating = () => {
      lastNavigation = Date.now()
    }
    // The browser reports the requests a navigation cancels *before* it reports the navigation itself, so the time is taken
    // when the test asks for the navigation (and again when one is reported, for navigations the page makes itself).
    for (const name of ['goto', 'reload', 'goBack', 'goForward'] as const) {
      const original = page[name].bind(page) as (...args: unknown[]) => Promise<unknown>
      ;(page as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        navigating()
        return original(...args)
      }
    }
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigating()
    })
    page.on('pageerror', (error) => guard.seen.push(`pageerror: ${error.message}`))
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      // "Failed to load resource" has no address in it: the response and requestfailed listeners below report those with
      // the address, so they are not counted twice. Any other console error counts, wherever it comes from.
      if (/^Failed to load resource/.test(msg.text())) return
      guard.seen.push(`console.error: ${msg.text()}`)
    })
    page.on('requestfailed', (request) => {
      if (!isLocal(request.url())) return // a blocked outside image or font is not the app's fault
      const text = request.failure()?.errorText ?? ''
      // ERR_ABORTED is the browser dropping a request because the page navigated (a reload) or is closing.
      if (text === 'net::ERR_ABORTED' && (closing || Date.now() - lastNavigation < 5000)) return
      guard.seen.push(`request failed: ${request.method()} ${request.url()} ${text}`)
    })
    page.on('response', (response) => {
      if (isLocal(response.url()) && response.status() >= 400) guard.seen.push(`http ${response.status()} ${response.request().method()} ${response.url()}`)
    })
    // An alert, confirm or prompt is never expected: if one opens (an executed script, say) the test fails.
    page.on('dialog', (dialog) => {
      guard.seen.push(`dialog: ${dialog.type()} "${dialog.message()}"`)
      void dialog.dismiss().catch(() => {})
    })

    // Hermetic: nothing leaves the machine (NBA photos fall back to drawn initials, no model downloads), and the
    // browser may only talk to the two throwaway servers. A request to anything else on this machine (the real backend
    // on port 8000 above all) is stopped and fails the test.
    // The routes are on the browser context, not on the page, so a popup or a second tab the app opens is covered too.
    const context = page.context()
    await context.route(
      (url) => !isLocal(url.toString()),
      (route) => {
        // A photo or a font from outside is simply blocked. An address on this machine or the local network that is not
        // "localhost" or 127.0.0.1 (127.0.0.2, 0.0.0.0, [::1], 192.168.x.x) is someone else's server: that fails the test.
        if (isPrivateHost(route.request().url())) guard.seen.push(`blocked: the page asked for ${route.request().url()}, which is not one of the throwaway servers`)
        return route.abort()
      },
    )
    await context.route(
      (url) => isLocal(url.toString()) && !isAllowedOrigin(url.toString()),
      (route) => {
        guard.seen.push(`blocked: the page asked for ${route.request().url()}, which is not one of the throwaway servers`)
        return route.abort()
      },
    )
    // The throwaway backend does not list this page's address in its CORS allow-list (it is not on 5173), so the answers
    // get the headers here. The backend's real CORS rules are checked over plain HTTP in api.e2e.ts, not in the browser.
    await context.route(`${BACKEND_URL}/**`, async (route) => {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
      }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const response = await route.fetch()
      return route.fulfill({ response, headers: { ...response.headers(), ...cors } })
    })
    await provide(page)
    closing = true
  },
})

export { expect }

// ---------------------------------------------------------------------------------------------
// Things a person does, written once.
// ---------------------------------------------------------------------------------------------

export type Tab = 'My log' | 'vs NBA' | 'Players'

/** Open the app and wait until it has loaded its shots. */
export async function openApp(page: Page, tab: Tab = 'My log'): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible()
  if (tab !== 'My log') await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: tab }).click()
  await expect(page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page')
}

export const drawerToggle = (page: Page): Locator => page.locator('button.drawer-toggle')
export const drawer = (page: Page): Locator => page.locator('#shots-drawer')

export async function openDrawer(page: Page, view: 'list' | 'add' = 'list'): Promise<void> {
  if ((await drawerToggle(page).getAttribute('aria-expanded')) !== 'true') await drawerToggle(page).click()
  await expect(drawer(page)).toBeVisible()
  await drawer(page).getByRole('group', { name: 'Drawer view' }).getByRole('button', { name: view === 'add' ? /Add a shot/ : /^Shots/ }).click()
}

export async function closeDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close the shot list' }).click()
  await expect(drawerToggle(page)).toHaveAttribute('aria-expanded', 'false')
}

/** Fill in the add-a-shot form (the drawer must be showing it) and press the button. */
export async function fillShotForm(
  scope: Locator,
  shot: { date?: string; x: number | string; y: number | string; made?: boolean; note?: string },
): Promise<void> {
  if (shot.date !== undefined) await scope.getByLabel('Game date').fill(shot.date)
  await scope.getByLabel(/^X \(/).fill(String(shot.x))
  await scope.getByLabel(/^Y \(/).fill(String(shot.y))
  if (shot.made !== undefined) await scope.getByRole('radio', { name: shot.made ? 'Made' : 'Missed' }).check()
  if (shot.note !== undefined) await scope.getByLabel('Note (optional)').fill(shot.note)
}

export async function addShotViaForm(page: Page, shot: Parameters<typeof fillShotForm>[1]): Promise<void> {
  await openDrawer(page, 'add')
  const form = drawer(page).locator('form.shot-form').first()
  await fillShotForm(form, shot)
  await form.getByRole('button', { name: 'Add shot' }).click()
}

/** The big number in a stat tile on the My log page, e.g. kpi(page, 'FIELD GOAL'). */
export const kpi = (page: Page, label: 'FIELD GOAL' | 'THREE POINT' | 'SHOTS' | 'HOTTEST ZONE'): Locator =>
  page.locator('.kpi').filter({ hasText: label }).locator('.kpi-value')

/** The notice under the top bar ("Saved shot #3."). */
export const notice = (page: Page): Locator => page.locator('.notice-slot')

/** One row of the shot list, found by something it says (a note, "#12"). */
export const shotRow = (page: Page, text: string | RegExp): Locator => drawer(page).getByRole('listitem').filter({ hasText: text })
