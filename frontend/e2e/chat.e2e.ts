import { addShotViaForm, dayString, drawer, expect, kpi, makeShots, notice, openApp, openDrawer, test } from './support'
import type { Locator, Page } from '@playwright/test'

// The chat with Deni: shots are added by telling him, and only Save writes them. The AI service here is a stand-in
// (e2e/fake-ai.mjs) whose answer depends on a word in the last message, so the whole chain is real: browser,
// frontend, backend, and the backend's HTTP call to "the AI service".

const SHOTS = 'hit one from the right corner and missed one from the left elbow'

const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Deni Avdija' })
const log = (page: Page): Locator => dialog(page).getByRole('log', { name: 'Conversation with Deni' })

async function openChat(page: Page): Promise<void> {
  await openApp(page)
  await page.getByRole('button', { name: /Open Deni/ }).click()
  await expect(dialog(page)).toBeVisible()
}

async function say(page: Page, text: string): Promise<void> {
  await dialog(page).getByRole('textbox', { name: 'Message to Deni' }).fill(text)
  await dialog(page).getByRole('button', { name: 'Send' }).click()
}

test.describe('the chat, with his AI helper there', () => {
  test.use({ aiHelper: true })

  test('he proposes the shots you describe, and nothing is saved until Save is pressed', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openChat(page)
    await say(page, SHOTS)
    await expect(log(page).getByText(/Got it: a made three from the right corner/)).toBeVisible()
    await expect(log(page).getByText('Right corner 3 · 3PT · made')).toBeVisible()
    await expect(log(page).getByText('Left elbow · 2PT · missed')).toBeVisible()
    await expect(log(page).getByText('caught and shot')).toBeVisible()
    // The words are not repeated on the card: they are already in the player's own bubble above it.
    await expect(log(page).locator('.shot-chip q')).toHaveCount(0)
    // Understanding is not saving.
    expect(await api.list()).toHaveLength(6)

    await log(page).getByRole('button', { name: 'Save shot 1' }).click()
    await expect(log(page).getByText('Saved ✓')).toBeVisible()
    await expect(notice(page)).toContainText('Saved shot #')
    const all = await api.list()
    expect(all).toHaveLength(7)
    // The backend worked out the zone and the shot type itself, from the coordinates.
    expect(all.at(-1)).toMatchObject({ player: 'Yuly', x: 47.5, y: 3, made: true, note: 'caught and shot', zone: 'right_corner_3', shot_type: '3PT' })
    await expect(kpi(page, 'SHOTS')).toHaveText('7')
    // The other proposal is still waiting, unsaved.
    await expect(log(page).getByRole('button', { name: 'Save shot 2' })).toBeVisible()
  })

  test('Save all keeps every open shot in the order he showed them, with one notice for the batch', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openChat(page)
    await say(page, SHOTS)
    await log(page).getByRole('button', { name: 'Save all (2)' }).click()
    await expect(log(page).getByText('Saved ✓')).toHaveCount(2)
    await expect(notice(page)).toContainText('Saved 2 shots for Yuly.')
    const saved = (await api.list()).slice(6)
    expect(saved.map((s) => [s.x, s.y, s.made, s.zone])).toEqual([
      [47.5, 3, true, 'right_corner_3'],
      [17, 19, false, 'left_elbow'],
    ])
  })

  test('a discarded proposal is never saved', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openChat(page)
    await say(page, SHOTS)
    await log(page).getByRole('button', { name: 'Discard shot 1' }).click()
    await log(page).getByRole('button', { name: 'Save shot 2' }).click()
    await expect(log(page).getByText('Saved ✓')).toBeVisible()
    expect((await api.list()).slice(6).map((s) => s.x)).toEqual([17])
  })

  test('"yesterday" means the players yesterday', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openChat(page)
    await say(page, 'made a layup yesterday')
    await expect(log(page).getByText(`Restricted area · 2PT · made · ${dayString(1)}`)).toBeVisible()
    await log(page).getByRole('button', { name: 'Save shot 1' }).click()
    await expect(log(page).getByText('Saved ✓')).toBeVisible()
    expect((await api.list()).at(-1)?.game_date).toBe(dayString(1))
  })

  test('he is given the numbers the app worked out from your log, and answers with them', async ({ page, api }) => {
    const seeded = await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    const made = seeded.filter((s) => s.made).length
    await openChat(page)
    await say(page, 'How am I doing?')
    await expect(log(page).getByText(`You have made ${made} of 6 for Yuly.`)).toBeVisible()
    expect(await api.list()).toHaveLength(6) // a question saves nothing
  })

  test('the conversation so far is sent with each new message', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openChat(page)
    await say(page, 'hello there')
    await expect(log(page).getByText('Got it: a layup at the rim.')).toBeVisible()
    await say(page, 'what is the context')
    // Three messages were sent: the first question, his answer, and this one.
    await expect(log(page).getByText('I can see 3 messages.')).toBeVisible()
  })

  test('when he needs to know more he asks, and proposes nothing', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openChat(page)
    await say(page, 'played well today, vague session')
    await expect(log(page).getByText('Where was each shot taken, and did it go in?')).toBeVisible()
    await expect(log(page).getByRole('list', { name: 'Shots Deni understood' })).toHaveCount(0)
    expect(await api.list()).toHaveLength(6)
  })

  test('the conversation is still there after his view is closed and opened again', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openChat(page)
    await say(page, 'How am I doing?')
    await expect(log(page).getByText(/You have made/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await page.getByRole('button', { name: /Open Deni/ }).click()
    await expect(log(page).getByText('How am I doing?', { exact: true })).toBeVisible()
    await expect(log(page).getByText(/You have made/)).toBeVisible()
  })

  test('the conversation is saved: it is still there after a reload, and is part of what he is sent', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openChat(page)
    await say(page, 'How am I doing?')
    await expect(log(page).getByText(/You have made/)).toBeVisible()
    await expect.poll(async () => (await api.history('Yuly')).length).toBe(2)
    await page.reload()
    await page.getByRole('button', { name: /Open Deni/ }).click()
    await expect(log(page).getByText('How am I doing?', { exact: true })).toBeVisible()
    await expect(log(page).getByText(/You have made/)).toBeVisible()
    // The stand-in counts the messages it is sent: the two saved ones and the new one.
    await say(page, 'what is the context')
    await expect(log(page).getByText('I can see 3 messages.')).toBeVisible()
  })

  test('Start over forgets the conversation, here and in the backend, and a reload stays empty', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openChat(page)
    await say(page, 'How am I doing?')
    await expect(log(page).getByText(/You have made/)).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Start over' }).click()
    await expect(log(page).getByText('How am I doing?', { exact: true })).toHaveCount(0)
    await expect.poll(async () => (await api.history('Yuly')).length).toBe(0)
    await page.reload()
    await page.getByRole('button', { name: /Open Deni/ }).click()
    await expect(log(page).getByText('How am I doing?', { exact: true })).toHaveCount(0)
    await expect(dialog(page).getByRole('button', { name: 'Start over' })).toHaveCount(0)
  })

  test('shots can be added from the shot list by opening the chat, and there is no manual form', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openApp(page)
    await openDrawer(page, 'list')
    await expect(drawer(page).getByRole('group', { name: 'Drawer view' }).getByRole('button', { name: 'Add a shot' })).toHaveCount(0)
    await drawer(page).getByRole('button', { name: 'Tell Deni about a shot' }).click()
    await expect(dialog(page)).toBeVisible()
  })

  test('a brand new log: he asks for a name, saves the shot under it, and the chat carries on', async ({ page, api }) => {
    await openChat(page)
    await say(page, 'made a layup')
    await expect(log(page).getByText('Restricted area · 2PT · made')).toBeVisible()
    // Nobody to save for yet.
    await expect(log(page).getByRole('button', { name: 'Save shot 1' })).toBeDisabled()
    await dialog(page).getByLabel('Save my shots under the name').pressSequentially('Noam Cohen')
    await log(page).getByRole('button', { name: 'Save shot 1' }).click()
    await expect(log(page).getByText('Saved ✓')).toBeVisible()
    expect((await api.list()).map((s) => s.player)).toEqual(['Noam Cohen'])
    // What was said is still in the chat now that Noam is the chosen player.
    await expect(log(page).locator('.chat-msg.user .chat-bubble', { hasText: 'made a layup' })).toBeVisible()
  })

  test.describe('when the AI side fails, the rest of the app does not notice', () => {
    test('the AI service is not available: a plain sentence, and he can be asked again', async ({ page, api, guard }) => {
      guard.allow(/^http 503 POST \S+\/chat$/)
      await api.seed(makeShots('Yuly', 6, { seed: 91 }))
      await openChat(page)
      await say(page, 'simulate down please')
      await expect(log(page).getByRole('alert')).toContainText("Deni's AI helper is not available right now. You can still add shots by hand.")
      await say(page, 'How am I doing?')
      await expect(log(page).getByText(/You have made/)).toBeVisible()
    })

    test('a busy model says so', async ({ page, api, guard }) => {
      guard.allow(/^http 429 POST \S+\/chat$/)
      await api.seed(makeShots('Yuly', 6, { seed: 91 }))
      await openChat(page)
      await say(page, 'simulate busy')
      await expect(log(page).getByRole('alert')).toContainText("Deni's AI helper is busy. Try again in a minute.")
    })

    test('an answer that breaks the rules is refused, not shown or saved', async ({ page, api, guard }) => {
      guard.allow(/^http 502 POST \S+\/chat$/)
      await api.seed(makeShots('Yuly', 6, { seed: 91 }))
      await openChat(page)
      await say(page, 'simulate garbage')
      await expect(log(page).getByRole('alert')).toContainText("Deni's AI helper could not give a usable answer.")
      await expect(log(page).getByRole('list', { name: 'Shots Deni understood' })).toHaveCount(0)
      expect(await api.list()).toHaveLength(6)
    })
  })
})

test.describe('when his AI helper is offline', () => {
  // The page is told the helper is not available (the default), as it is when the AI service or its key is missing.
  test('shots are added by hand, and Deni says he cannot chat', async ({ page, api }) => {
    await api.seed(makeShots('Yuly', 6, { seed: 91 }))
    await openApp(page)
    await openDrawer(page, 'list')
    await expect(drawer(page).getByRole('button', { name: 'Tell Deni about a shot' })).toHaveCount(0)
    await addShotViaForm(page, { player: 'Yuly', x: 25, y: 6, made: true })
    expect(await api.list()).toHaveLength(7)

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Open Deni/ }).click()
    await expect(log(page).getByText(/AI helper is offline right now/)).toBeVisible()
    await expect(log(page).getByText(/add a shot by hand/)).toBeVisible()
    // Still one text box, and no separate buttons for questions.
    await expect(dialog(page).getByRole('textbox')).toHaveCount(1)
  })
})
