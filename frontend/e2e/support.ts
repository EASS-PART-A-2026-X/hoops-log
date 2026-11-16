import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { BACKEND_URL, assertSafeBackend } from './env'

// ---------------------------------------------------------------------------------------------
// Data: talk to the backend directly, the way a script or another client would.
// ---------------------------------------------------------------------------------------------

export interface ShotInput {
  player: string
  x: number
  y: number
  made: boolean
  game_date?: string
  note?: string
}
export interface ShotRow extends ShotInput {
  id: number
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

  async clear(): Promise<void> {
    for (const shot of await this.list()) {
      const res = await this.request.delete(`${BACKEND_URL}/shots/${shot.id}`)
      expect(res.status()).toBe(204)
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

/** `count` repeatable shots for one player over the last weeks, spread over every area of the court. */
export function makeShots(player: string, count: number, opts: { seed?: number; makeRate?: number } = {}): ShotInput[] {
  const next = rng(opts.seed ?? 1)
  const rate = opts.makeRate ?? 0.5
  return Array.from({ length: count }, (_, i) => {
    const [x, y] = SPOTS[Math.floor(next() * SPOTS.length)]!
    const jitter = () => Math.round((next() - 0.5) * 20) / 10 // up to a foot either way, one decimal
    return {
      player,
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

const isLocal = (url: string): boolean => {
  try {
    const u = new URL(url)
    return !/^https?:$/.test(u.protocol) || u.hostname === '127.0.0.1' || u.hostname === 'localhost'
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

interface Fixtures {
  api: Api
  guard: Guard
  /** The title screen is skipped unless a test turns this off. */
  seenTitle: boolean
  /** Deni stays quiet (no voice, no unprompted remarks) and the sound is off, unless a test turns this off. */
  quiet: boolean
}

export const test = base.extend<Fixtures>({
  seenTitle: [true, { option: true }],
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

  page: async ({ page, guard, seenTitle, quiet }, provide) => {
    assertSafeBackend()
    await page.addInitScript(
      ({ seenTitle, quiet }) => {
        try {
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
      { seenTitle, quiet },
    )

    page.on('pageerror', (error) => guard.seen.push(`pageerror: ${error.message}`))
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const url = msg.location().url
      if (url && !isLocal(url)) return // a blocked outside image or font is not the app's fault
      guard.seen.push(`console.error: ${msg.text()}`)
    })
    page.on('requestfailed', (request) => {
      // ERR_ABORTED is the browser dropping a request on purpose (a reload, a page change), not a failure.
      if (isLocal(request.url()) && request.failure()?.errorText !== 'net::ERR_ABORTED') guard.seen.push(`request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`)
    })
    page.on('response', (response) => {
      if (isLocal(response.url()) && response.status() >= 500) guard.seen.push(`server error: ${response.status()} ${response.url()}`)
    })

    // Hermetic: nothing leaves the machine (NBA photos fall back to drawn initials, no model downloads).
    await page.route((url) => !isLocal(url.toString()), (route) => route.abort())
    await page.route(`${BACKEND_URL}/**`, async (route) => {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': '*',
      }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      const response = await route.fetch()
      return route.fulfill({ response, headers: { ...response.headers(), ...cors } })
    })
    await provide(page)
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
  shot: { player?: string; date?: string; x: number | string; y: number | string; made?: boolean; note?: string },
): Promise<void> {
  if (shot.player !== undefined) await scope.getByLabel('Player').fill(shot.player)
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

/** The notice under the top bar ("Saved shot #3 for Yuly."). */
export const notice = (page: Page): Locator => page.locator('.notice-slot')

/** One row of the shot list, found by something it says (a note, "#12"). */
export const shotRow = (page: Page, text: string | RegExp): Locator => drawer(page).getByRole('listitem').filter({ hasText: text })
