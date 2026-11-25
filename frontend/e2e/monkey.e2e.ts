import type { Locator, Page } from '@playwright/test'
import { expect, kpi, makeShots, openApp, openDrawer, rng, test } from './support'

/**
 * A monkey: it does random things to the page, fast, with a seeded random generator. After every action the browser
 * must not have reported an error, most steps must have been real actions (an inert monkey fails), and at the end the
 * screen must agree with the backend.
 *
 * The seed makes a run start the same way, but it is not a guaranteed replay: what can be clicked depends on timing (a
 * court still loading, an action that timed out), and a different count of random numbers drawn changes everything after
 * it. So a failure prints the actions it really did (the log), and the log is what to reproduce from.
 *
 *   E2E_MONKEY_SEEDS=7,8,9 E2E_MONKEY_STEPS=200 npx playwright test --project=full monkey
 */
const SEEDS = (process.env.E2E_MONKEY_SEEDS ?? '1,2,3,4').split(',').map(Number)
const STEPS = Number(process.env.E2E_MONKEY_STEPS ?? 70)
/** The fast project (every pull request) runs one seed, and a shorter one. */
const FAST_STEPS = 25

// The Log out button is left alone: it would end the very session the monkey is checking afterwards (auth.e2e.ts covers it).
const CLICKABLE = 'button:not(.account-btn), [role=option], [role=combobox], [role=radio], input[type=radio], input[type=checkbox], summary, a[href^="/"], .player-you, li.player-you'
const TYPEABLE = 'input:not([type=radio]):not([type=checkbox]):not([type=hidden]), textarea'
const KEYS = ['Escape', 'Tab', 'Shift+Tab', 'Enter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'b', 'a', 'x', 'Home', 'End', 'PageDown']
const SIZES: [number, number][] = [
  [390, 844],
  [768, 1024],
  [1024, 700],
  [1280, 600],
  [1366, 800],
  [1920, 1080],
]
const TEXTS = [
  '',
  ' ',
  'abc',
  '25',
  '-1',
  '0',
  '50',
  '47.5',
  '51',
  '1e9',
  'NaN',
  '2026-11-16',
  '2999-01-01',
  'יולי',
  '🏀',
  '<img src=x onerror=alert(1)>',
  "'; DROP TABLE shot;--",
  'x'.repeat(200),
  'y'.repeat(60),
  '‮ rtl',
]

/** Indices (among `selector` matches) of things a person could really click or type into right now. */
async function usable(page: Page, selector: string): Promise<number[]> {
  return page.evaluate((sel) => {
    const out: number[] = []
    document.querySelectorAll(sel).forEach((el, i) => {
      const node = el as HTMLElement & { disabled?: boolean }
      if (node.disabled || node.getAttribute('aria-disabled') === 'true' || node.closest('[inert]') || node.closest('[hidden]')) return
      const r = node.getBoundingClientRect()
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)))
      if (hit && (hit === node || node.contains(hit) || hit.contains(node))) out.push(i)
    })
    return out
  }, selector)
}

/** A failure of the backend itself during the monkey's own calls: never excused as the monkey's bad luck. */
class Hard extends Error {}

const pickFrom = <T>(next: () => number, list: T[]): T | undefined => list[Math.floor(next() * list.length)]

for (const seed of SEEDS) {
  test(`monkey, seed ${seed}: random actions, then the app is still standing and still right`, async ({ page, api, guard }, testInfo) => {
    test.setTimeout(240_000)
    // The fast project only runs the first seed (see its grepInvert in the config), and a shorter one.
    const steps = testInfo.project.name === 'fast' ? FAST_STEPS : STEPS
    // Bad input legitimately comes back as 422, and a shot the monkey deleted behind the page's back is a 404 when the page
    // edits or deletes it. Only those, only for writes to /shots: a 404 on a script or the chart, or any 5xx, still fails.
    guard.allow(/^http (422|404) (POST|PATCH|DELETE) \S+\/shots(\/\d+)?$/)
    // (An alert, confirm or prompt also fails the run: the page fixture records every dialog.)

    const next = rng(seed)
    const log: string[] = []
    let skipped = 0
    await api.seed([...makeShots('Yuly', 24, { seed: seed * 7 + 1 }), ...makeShots('Noam', 9, { seed: seed * 7 + 2 })])
    await openApp(page)
    // Quick timeouts for the random actions only: a click that cannot happen should be given up on fast. Loading the page is
    // slow on a slow machine and keeps the normal timeouts.
    page.setDefaultTimeout(2500)

    const step = async (i: number): Promise<void> => {
      const roll = next()
      const note = (text: string): void => {
        log.push(`${String(i).padStart(3)} ${text}`)
      }
      try {
        if (roll < 0.34) {
          const idx = pickFrom(next, await usable(page, CLICKABLE))
          if (idx === undefined) return note('click: nothing to click')
          const target: Locator = page.locator(CLICKABLE).nth(idx)
          const what = ((await target.innerText({ timeout: 500 }).catch(() => '')) || (await target.getAttribute('aria-label').catch(() => '')) || '?').replace(/\s+/g, ' ').slice(0, 40)
          note(`click ${await target.evaluate((e) => e.tagName.toLowerCase()).catch(() => '?')} "${what}"`)
          await target.click({ timeout: 1500 })
        } else if (roll < 0.42) {
          const idx = pickFrom(next, await usable(page, TYPEABLE))
          if (idx === undefined) return note('type: nothing to type into')
          const text = pickFrom(next, TEXTS) ?? ''
          note(`type ${JSON.stringify(text.slice(0, 24))}`)
          await page.locator(TYPEABLE).nth(idx).fill(text, { timeout: 1500 })
        } else if (roll < 0.54) {
          // Open the add-a-shot form and send it something: a mix of fine and awful values.
          const toggle = page.locator('button.drawer-toggle')
          if (!(await toggle.isVisible())) return note('form: no Shots button on this page')
          if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click({ timeout: 1500 })
          await page.locator('#shots-drawer').getByRole('button', { name: /Add a shot/ }).click({ timeout: 1500 })
          const form = page.locator('#shots-drawer form.shot-form').first()
          const good = next() < 0.55
          const num = (max: number) => (good ? String(Math.round(next() * max * 10) / 10) : (pickFrom(next, TEXTS) ?? ''))
          const values = { player: pickFrom(next, ['Yuly', 'Noam', 'Maya', ...TEXTS])!, x: num(50), y: num(47), note: pickFrom(next, TEXTS)! }
          note(`form ${JSON.stringify(values).slice(0, 80)}`)
          await form.getByLabel('Player').fill(values.player, { timeout: 1500 })
          await form.getByLabel(/^X \(/).fill(values.x, { timeout: 1500 }).catch(() => {})
          await form.getByLabel(/^Y \(/).fill(values.y, { timeout: 1500 }).catch(() => {})
          await form.getByLabel('Note (optional)').fill(values.note, { timeout: 1500 })
          if (next() < 0.4) await form.evaluate((f) => f.setAttribute('novalidate', '')) // go past the browser's own checks
          await form.getByRole('radio', { name: next() < 0.5 ? 'Made' : 'Missed' }).check({ timeout: 1500 })
          await form.getByRole('button', { name: 'Add shot' }).click({ timeout: 1500 })
        } else if (roll < 0.72) {
          const key = pickFrom(next, KEYS)!
          note(`press ${key}`)
          await page.keyboard.press(key)
        } else if (roll < 0.8) {
          const box = await page.locator('canvas:visible').first().boundingBox({ timeout: 500 })
          if (!box) return note('drag: no canvas')
          const x = box.x + next() * box.width
          const y = box.y + next() * box.height
          note(`drag on canvas from ${Math.round(x)},${Math.round(y)}`)
          await page.mouse.move(x, y)
          await page.mouse.down()
          await page.mouse.move(box.x + next() * box.width, box.y + next() * box.height, { steps: 5 })
          await page.mouse.up()
        } else if (roll < 0.85) {
          const [w, h] = pickFrom(next, SIZES)!
          note(`resize ${w}x${h}`)
          await page.setViewportSize({ width: w, height: h })
        } else if (roll < 0.89) {
          note('reload')
          // A reload is slow on a slow machine (a cold dev server, a browser drawing in software), so give it time.
          await page.reload({ timeout: 45_000 })
          await page.getByRole('navigation', { name: 'Pages' }).waitFor({ timeout: 45_000 })
        } else if (roll < 0.93) {
          const rows = await api.list()
          const victim = pickFrom(next, rows)
          if (!victim) return note('delete behind the page: nothing to delete')
          note(`someone else deletes shot #${victim.id}`)
          await api.remove(victim.id).catch((error: Error) => {
            throw new Hard(error.message)
          })
        } else {
          note('someone else adds a shot')
          await api.add({ player: next() < 0.5 ? 'Yuly' : 'Maya', x: Math.round(next() * 50), y: Math.round(next() * 47), made: next() < 0.5 }).catch((error: Error) => {
            throw new Hard(error.message)
          })
        }
      } catch (error) {
        // A failed call to the backend itself is a real failure, not the monkey's bad luck.
        if (error instanceof Hard) throw error
        // A click that lost a race with a re-render is the monkey's problem, not the app's. It is counted, though: an action
        // that was only attempted does not count as something the monkey did.
        skipped += 1
        note(`  (skipped: ${(error as Error).message.split('\n')[0]!.slice(0, 90)})`)
      }
    }

    // Steps that did something: not "nothing to click" and the like, and not the ones that were attempted and given up on.
    const real = () => steps - log.filter((line) => /: nothing to|no Shots button|no canvas|nothing to delete/.test(line)).length - skipped
    const report = (i: number) => `seed ${seed}, after step ${i}. Last actions:\n${log.slice(-14).join('\n')}`
    for (let i = 0; i < steps; i++) {
      await step(i)
      const bad = guard.unexpected()
      if (bad.length > 0) throw new Error(`the browser reported a problem: ${bad.join(' | ')}\n${report(i)}`)
      // The page may be a moment into loading (after a reload), so give it a few seconds before calling it blank.
      const alive = await page
        .waitForFunction(() => document.body.innerText.trim().length > 100 && !!document.querySelector('nav[aria-label=Pages]') && !!document.querySelector('h2'), undefined, { timeout: 15_000 })
        .then(() => true, () => false)
      if (!alive) throw new Error(`the page went blank or lost its navigation\n${report(i)}`)
    }

    // A monkey that could not do anything (every click skipped) would pass the checks above for the wrong reason, so most of
    // its steps must have been real actions.
    expect(real(), `only ${real()} of ${steps} steps did something\n${log.join('\n')}`).toBeGreaterThanOrEqual(Math.floor(steps * 0.35))

    // The screen and the backend agree once everything has settled (patient again: this is a full page load).
    page.setDefaultTimeout(30_000)
    await page.setViewportSize({ width: 1366, height: 800 })
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible()
    const rows = await api.list()
    await page.getByRole('combobox', { name: /^Shots of:/ }).click()
    await page.getByRole('option').first().click() // "Every player"
    await expect(kpi(page, 'SHOTS')).toHaveText(String(rows.length))
    await openDrawer(page, 'list')
    await expect(page.locator('#shots-drawer').getByRole('button', { name: /^Shots \(/ })).toContainText(`(${rows.length})`)
    if (process.env.E2E_MONKEY_VERBOSE) console.log(`seed ${seed} actions:\n${log.join('\n')}`)
    test.info().annotations.push({ type: 'monkey', description: log.join('\n') })
  })
}
