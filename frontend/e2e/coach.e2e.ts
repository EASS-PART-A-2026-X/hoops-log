import type { Page } from '@playwright/test'
import { addShotViaForm, drawerToggle, expect, makeShots, notice, openApp, test } from './support'

const face = (page: Page) => page.getByRole('button', { name: 'Open Deni, the coach' })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Deni Avdija' })
const caption = (page: Page) => page.locator('.coach-live')
const ask = (page: Page, question: string) => dialog(page).getByRole('list', { name: 'Quick questions for Deni' }).getByRole('button', { name: question }).click()

/** A browser voice that writes down what it is asked to say (and "finishes" it), so speech can be checked silently. */
async function stubSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spoken: string[] = []
    ;(window as unknown as { __spoken: string[] }).__spoken = spoken
    class Utterance {
      text: string
      voice: unknown = null
      lang = ''
      rate = 1
      pitch = 1
      onstart: (() => void) | null = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak(u: Utterance) {
          spoken.push(u.text)
          u.onstart?.()
          setTimeout(() => u.onend?.(), 30)
        },
        cancel() {},
        getVoices: () => [],
        addEventListener() {},
        removeEventListener() {},
      },
    })
  })
}
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)

test.describe('Deni in the corner', () => {
  test('greets an empty log by telling you to add a shot, and the caption can be dismissed from the keyboard', async ({ page }) => {
    await openApp(page)
    await expect(caption(page)).toContainText('Your log is empty')
    const bubble = page.locator('.coach-bubble')
    await expect(bubble).toBeVisible()
    await bubble.getByRole('button', { name: 'Dismiss' }).focus()
    await page.keyboard.press('Enter')
    await expect(bubble).toHaveCount(0)
  })

  test('greets a log with the real number of shots and the rank', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 14, { seed: 51 }))
    await openApp(page)
    await expect(caption(page)).toContainText(/Welcome back, Yuly\. 14 shots logged/)
  })

  test('reacts to a saved shot, and to the 25th shot with a milestone', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 24, { seed: 52 }))
    await openApp(page)
    await expect(caption(page)).toContainText('24 shots logged')
    await addShotViaForm(page, { player: 'Yuly', x: 25, y: 6, made: true })
    await expect(notice(page)).toContainText('Saved shot')
    await expect(caption(page)).toContainText(/Shot number 25/, { timeout: 15_000 })
  })

  test('says something about the page the first time you open it', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 10, { seed: 53 }))
    await openApp(page)
    const before = await caption(page).innerText()
    await page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'vs NBA' }).click()
    await expect.poll(() => caption(page).innerText()).not.toBe(before)
  })
})

test.describe('Deni’s big view', () => {
  test('opens with a 3D figure, a name and eight questions, and closes with Escape giving focus back', async ({ page }) => {
    await openApp(page)
    await face(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByRole('heading', { name: 'Deni Avdija' })).toBeVisible()
    await expect(dialog(page).locator('.deni-stage canvas')).toBeVisible({ timeout: 20_000 })
    await expect(dialog(page).getByRole('list', { name: 'Quick questions for Deni' }).getByRole('button')).toHaveCount(8)
    await expect(dialog(page)).toContainText(/not the real Deni/)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(face(page)).toBeFocused()
  })

  test('the figure is drawn (not an empty canvas) and the dialog keeps keyboard focus inside', async ({ page }) => {
    await openApp(page)
    await face(page).click()
    const canvas = dialog(page).locator('.deni-stage canvas')
    await expect(canvas).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(1200)
    expect((await dialog(page).locator('.deni-stage').screenshot()).length).toBeGreaterThan(15_000)
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('.coach-dialog-body'))).toBe(true)
    }
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('.coach-dialog-body'))).toBe(true)
    }
  })

  test('closes with its close button and by clicking outside', async ({ page }) => {
    await openApp(page)
    await face(page).click()
    await dialog(page).getByRole('button', { name: /Close the coach/ }).click()
    await expect(dialog(page)).toHaveCount(0)
    await face(page).click()
    await page.mouse.click(5, 5)
    await expect(dialog(page)).toHaveCount(0)
  })

  test('answers with the real numbers from your log', async ({ page, api }) => {
    const rows = await api.seed(makeShots('Yuly', 30, { seed: 54, makeRate: 0.6 }))
    const made = rows.filter((r) => r.made).length
    const fg = Math.round((made / rows.length) * 100)
    await openApp(page)
    await face(page).click()
    await ask(page, 'How am I shooting?')
    await expect(caption(page)).toContainText(`You have made ${made} of ${rows.length}, which is ${fg}%`)
    await ask(page, 'Which NBA player am I like?')
    await expect(caption(page)).toContainText(/like|closest|match/i)
    await ask(page, 'How do XP and levels work?')
    await expect(caption(page)).toContainText(/XP/)
  })

  test('with an empty log he does not invent numbers', async ({ page }) => {
    await openApp(page)
    await face(page).click()
    for (const q of ['How am I shooting?', 'What should I practise?', 'Where am I best?']) {
      await ask(page, q)
      await expect(caption(page)).toContainText('no shots in this log yet')
    }
  })

  test('with too few shots in an area he says the sample is too small', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 4, { seed: 55 }))
    await openApp(page)
    await face(page).click()
    await ask(page, 'Where am I best?')
    await expect(caption(page)).toContainText(/cannot say|shots yet/i)
  })

  test('the same question twice in a row gets a "same question" answer', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 20, { seed: 56 }))
    await openApp(page)
    await face(page).click()
    await ask(page, 'How am I shooting?')
    await ask(page, 'How am I shooting?')
    await expect(caption(page)).toContainText('Same question?')
  })

  test('poking the figure six times quickly makes him lose patience', async ({ page }) => {
    await openApp(page)
    await face(page).click()
    const stage = dialog(page).locator('.deni-stage')
    await expect(stage.locator('canvas')).toBeVisible({ timeout: 20_000 })
    const before = await caption(page).innerText()
    const box = (await stage.boundingBox())!
    for (let i = 0; i < 6; i++) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(120)
    }
    await expect.poll(() => caption(page).innerText(), { timeout: 10_000 }).not.toBe(before)
  })

  test('dragging the figure turns him round and is not counted as a poke', async ({ page }) => {
    await openApp(page)
    await face(page).click()
    const stage = dialog(page).locator('.deni-stage')
    await expect(stage.locator('canvas')).toBeVisible({ timeout: 20_000 })
    const before = await caption(page).innerText()
    const box = (await stage.boundingBox())!
    const y = box.y + box.height / 2
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(box.x + 40, y)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 40, y, { steps: 8 })
      await page.mouse.up()
      await page.mouse.move(box.x + 40, y + 60, { steps: 4 }) // vertical drag
      await page.mouse.down()
      await page.mouse.move(box.x + 40, y - 60, { steps: 8 })
      await page.mouse.up()
    }
    await page.waitForTimeout(600)
    // No poke reaction: the caption is still his greeting, or it has timed out and hidden itself (a slow machine takes
    // long enough over the drags for that). A poke would put a new line there.
    expect([before, '']).toContain(await caption(page).innerText())
  })

  test('the cheat code works anywhere on the page', async ({ page }) => {
    await openApp(page)
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(key)
    await expect(caption(page)).toContainText('Cheat code accepted')
  })

  test('the cheat code does not fire while typing in a form field', async ({ page }) => {
    await openApp(page)
    await drawerToggle(page).click()
    await page.getByRole('button', { name: /Add a shot/ }).click()
    const note = page.locator('#shots-drawer').getByLabel('Note (optional)')
    await note.fill('x')
    await note.focus()
    const before = await caption(page).innerText()
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(key)
    // The keys went into the field (the b and the a were typed after the x; the arrows only moved the cursor)...
    await expect(note).toHaveValue(/b/)
    await expect(note).toHaveValue(/a/)
    // ...and the code did not fire. (The same keys outside a field do fire it: see the test above.)
    await page.waitForTimeout(600)
    await expect(caption(page)).not.toContainText('Cheat code accepted')
    // Still his greeting, or it has timed out and hidden itself (that happens after about ten seconds).
    expect([before, '']).toContain(await caption(page).innerText())
  })

  test('works with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openApp(page)
    await face(page).click()
    await expect(dialog(page)).toBeVisible()
    await ask(page, 'How do I add a shot?')
    await expect(caption(page)).toContainText(/Shots/)
  })

  test('without WebGL the drawn face is shown in the dialog and the questions still work', async ({ page, guard }) => {
    guard.allow(/WebGL/)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest) as RenderingContext | null
      } as typeof original
    })
    await openApp(page)
    await face(page).click()
    await expect(dialog(page).getByText(/cannot show the 3D view/)).toBeVisible({ timeout: 20_000 })
    await ask(page, 'How do I add a shot?')
    await expect(caption(page)).toContainText(/Shots/)
  })
})

test.describe('Deni’s voice', () => {
  test.use({ quiet: false })

  test('speaks the caption through the browser voice once you have clicked, and the switch turns it off for good', async ({ page, api }) => {
    await stubSpeech(page)
    await api.seed(makeShots('Yuly', 20, { seed: 61 }))
    await openApp(page)
    await face(page).click()
    await ask(page, 'How do XP and levels work?')
    await expect.poll(async () => (await spoken(page)).some((t) => /XP/.test(t))).toBe(true)

    const voice = dialog(page).getByRole('button', { name: /^Voice:/ })
    await expect(voice).toHaveAttribute('aria-pressed', 'true')
    await voice.click()
    await expect(voice).toContainText('off')
    const count = (await spoken(page)).length
    await ask(page, 'Tell me something about Deni')
    await page.waitForTimeout(500)
    expect((await spoken(page)).length).toBe(count)
    expect(await page.evaluate(() => window.localStorage.getItem('coach-voice'))).toBe('0')
    // The choice is remembered.
    await page.reload()
    await face(page).click()
    await expect(dialog(page).getByRole('button', { name: /^Voice:/ })).toContainText('off')
  })

  test('the sound button in the top bar silences him too: with the sound on he speaks, with it off he does not', async ({ page }) => {
    await stubSpeech(page)
    await openApp(page)
    await face(page).click()
    // Positive control: with the sound on, a question is spoken.
    await ask(page, 'How do XP and levels work?')
    await expect.poll(async () => (await spoken(page)).filter((t) => /XP/.test(t)).length).toBeGreaterThanOrEqual(1)
    // The sound button sits outside his dialog (a click out there would close it), so close it first.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Sound is on, turn it off' }).click()
    await expect(page.getByRole('button', { name: 'Sound is off, turn it on' })).toBeVisible()
    await face(page).click()
    const count = (await spoken(page)).length
    await ask(page, 'Tell me something about Deni')
    await expect(caption(page)).not.toHaveText('') // he still answers, in writing
    await page.waitForTimeout(600)
    expect((await spoken(page)).length).toBe(count)
  })

  test('markdown marks and emoji are not read out', async ({ page }) => {
    await stubSpeech(page)
    await openApp(page)
    await face(page).click()
    await ask(page, 'Tell me something about Deni')
    await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0)
    for (const text of await spoken(page)) expect(text).not.toMatch(/[*_`#]|\p{Extended_Pictographic}/u)
  })

  test('the HD voice offers a download, and when the model cannot be fetched he says so and keeps talking with the browser voice', async ({ page }) => {
    test.setTimeout(120_000)
    await stubSpeech(page)
    await openApp(page)
    await face(page).click()
    const hd = dialog(page).getByRole('button', { name: /^HD voice:/ })
    await expect(hd).toContainText('off (one-time 90 MB download)')
    await expect(hd).toHaveAttribute('aria-pressed', 'false')
    await hd.click()
    await expect(hd).toContainText('could not load, tap to try again', { timeout: 90_000 })
    await ask(page, 'How do XP and levels work?')
    await expect.poll(async () => (await spoken(page)).some((t) => /XP/.test(t))).toBe(true)
  })

  test('the HD button is hidden while the voice is off', async ({ page }) => {
    await openApp(page)
    await face(page).click()
    await dialog(page).getByRole('button', { name: /^Voice:/ }).click()
    await expect(dialog(page).getByRole('button', { name: /^HD voice:/ })).toHaveCount(0)
  })

  test('"Let him chime in" is a switch that is remembered', async ({ page }) => {
    await openApp(page)
    await face(page).click()
    const chime = dialog(page).getByRole('button', { name: /^Let him chime in:/ })
    await expect(chime).toContainText('on')
    await chime.click()
    await expect(chime).toContainText('off')
    expect(await page.evaluate(() => window.localStorage.getItem('coach-chatter'))).toBe('0')
  })
})
