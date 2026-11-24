// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProposedShot } from '../api'
import ChatPanel from './ChatPanel'
import type { Card } from './proposals'
import type { ChatApi, ChatMessage } from './useChat'

afterEach(cleanup)

const corner: ProposedShot = {
  x: 47.5,
  y: 3,
  made: true,
  game_date: '2026-11-19',
  note: 'caught and shot',
  quote: 'hit one from the right corner',
  zone: 'right_corner_3',
  shot_type: '3PT',
}
const elbow: ProposedShot = { ...corner, x: 17, y: 19, made: false, note: '', quote: '', zone: 'left_elbow', shot_type: '2PT' }

function stubChat(over: Partial<ChatApi> = {}): ChatApi {
  return {
    messages: [],
    thinking: false,
    savingFor: 'Yuly',
    typedPlayer: '',
    setTypedPlayer: vi.fn(),
    send: vi.fn(async () => {}),
    cancel: vi.fn(),
    reset: vi.fn(),
    save: vi.fn(async () => {}),
    discard: vi.fn(),
    saveAll: vi.fn(async () => {}),
    ...over,
  }
}
const panel = (chat: ChatApi, props: { aiAvailable?: boolean | null; player?: string } = {}) =>
  render(<ChatPanel chat={chat} aiAvailable={props.aiAvailable === undefined ? true : props.aiAvailable} player={props.player ?? 'Yuly'} />)
const box = () => screen.getByRole('textbox', { name: 'Message to Deni' }) as HTMLTextAreaElement
const message = (over: Partial<ChatMessage>): ChatMessage => ({ id: 1, role: 'deni', text: 'Hello', ...over })
const card = (over: Partial<Card> = {}): Card => ({ shot: corner, status: 'pending', ...over })

describe('what it says before anything is said', () => {
  it('opens with Deni\'s own words as his first message, inviting you to ask or to tell him about a session', () => {
    panel(stubChat())
    const first = within(screen.getByRole('log', { name: 'Conversation with Deni' })).getAllByRole('listitem')[0]!
    expect(first.className).toContain('deni')
    expect(first.textContent).toMatch(/tell me about a session/)
  })

  it('says his AI helper is offline, and points to adding a shot by hand', () => {
    panel(stubChat(), { aiAvailable: false })
    expect(screen.getByText(/AI helper is offline right now/)).toBeTruthy()
    expect(screen.getByText(/add a shot by hand/)).toBeTruthy()
    expect(box().placeholder).toBe('His AI helper is offline')
  })

  it('treats "not known yet" as there', () => {
    panel(stubChat(), { aiAvailable: null })
    expect(screen.queryByText(/offline/)).toBeNull()
    expect(box().placeholder).toBe('Message Deni…')
  })

  it('has ONE way to talk to him: a text box (the suggestions only send or fill in the same box)', () => {
    panel(stubChat())
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByRole('list', { name: /questions/i })).toBeNull()
  })

  it('offers things to try, and a tap sends the question through the chat like a typed one', async () => {
    const chat = stubChat()
    panel(chat)
    await userEvent.click(screen.getByRole('button', { name: 'Where am I strongest?' }))
    expect(chat.send).toHaveBeenCalledWith('Where am I strongest?')
  })

  it('"Log a session" only types an example into the box, for you to change (nothing is sent)', async () => {
    const chat = stubChat()
    panel(chat)
    await userEvent.click(screen.getByRole('button', { name: /Log a session/ }))
    expect(box().value).toMatch(/right corner/i)
    expect(chat.send).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(box())
  })

  it('takes the suggestions away once there is a conversation, and while his helper is offline', () => {
    panel(stubChat({ messages: [message({ id: 1, role: 'user', text: 'Hi' })] }))
    expect(screen.queryByRole('button', { name: 'Where am I strongest?' })).toBeNull()
    cleanup()
    panel(stubChat(), { aiAvailable: false })
    expect(screen.queryByRole('button', { name: 'Where am I strongest?' })).toBeNull()
  })

  it('does not let a suggestion send while he is thinking', () => {
    panel(stubChat({ thinking: true }))
    expect((screen.getByRole('button', { name: 'Where am I strongest?' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('tells you your messages go to an AI model', () => {
    panel(stubChat())
    expect(screen.getByText(/sent to an AI model/)).toBeTruthy()
  })
})

describe('writing a message', () => {
  it('sends the trimmed text with Enter and empties the box', async () => {
    const chat = stubChat()
    panel(chat)
    await userEvent.type(box(), '  how am I doing?  {Enter}')
    expect(chat.send).toHaveBeenCalledWith('how am I doing?')
    expect(box().value).toBe('')
  })

  it('sends with the Send button too', async () => {
    const chat = stubChat()
    panel(chat)
    await userEvent.type(box(), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(chat.send).toHaveBeenCalledWith('hello')
  })

  it('Shift+Enter makes a new line and does not send', async () => {
    const chat = stubChat()
    panel(chat)
    await userEvent.type(box(), 'one{Shift>}{Enter}{/Shift}two')
    expect(chat.send).not.toHaveBeenCalled()
    expect(box().value).toBe('one\ntwo')
  })

  it('does not send while a word is still being composed (an input method)', () => {
    const chat = stubChat()
    panel(chat)
    fireEvent.change(box(), { target: { value: 'שלום' } })
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    expect(chat.send).not.toHaveBeenCalled()
  })

  it('cannot send nothing or only spaces', async () => {
    const chat = stubChat()
    panel(chat)
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    await userEvent.type(box(), '   {Enter}')
    expect(chat.send).not.toHaveBeenCalled()
    expect(send.disabled).toBe(true)
    await userEvent.type(box(), 'x')
    expect(send.disabled).toBe(false)
  })

  it('stops at the longest message the backend takes', () => {
    panel(stubChat())
    expect(box().maxLength).toBe(2000)
  })
})

describe('while he is thinking', () => {
  it('says so, with a Cancel button, and will not send another message or question', async () => {
    const chat = stubChat({ thinking: true })
    panel(chat)
    expect(screen.getByText(/Deni is thinking/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(chat.cancel).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows moving dots in a status, not a message bubble that could pass for something he said', () => {
    panel(stubChat({ thinking: true }))
    const status = screen.getByRole('status')
    expect(status.querySelectorAll('.typing-dots i')).toHaveLength(3)
    expect(status.querySelector('.chat-bubble')).toBeNull()
    expect(status.textContent).toContain('Deni is thinking')
  })

  it('says nothing about speed at first, and "taking longer than usual" after ten seconds', () => {
    vi.useFakeTimers()
    try {
      panel(stubChat({ thinking: true }))
      expect(screen.queryByText(/Taking longer than usual/)).toBeNull()
      act(() => void vi.advanceTimersByTime(9_900))
      expect(screen.queryByText(/Taking longer than usual/)).toBeNull()
      act(() => void vi.advanceTimersByTime(200))
      expect(screen.getByText(/Taking longer than usual/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts the wait over for the next question, and shows no dots when nothing is running', () => {
    vi.useFakeTimers()
    try {
      const view = panel(stubChat({ thinking: true }))
      act(() => void vi.advanceTimersByTime(11_000))
      expect(screen.getByText(/Taking longer than usual/)).toBeTruthy()
      view.rerender(<ChatPanel chat={stubChat({ thinking: false })} aiAvailable player="Yuly" />)
      expect(screen.queryByRole('status')).toBeNull()
      view.rerender(<ChatPanel chat={stubChat({ thinking: true })} aiAvailable player="Yuly" />)
      expect(screen.queryByText(/Taking longer than usual/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows no Cancel when nothing is running', () => {
    panel(stubChat())
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})

describe('the conversation', () => {
  it('shows what was said by whom', () => {
    panel(stubChat({ messages: [message({ id: 1, role: 'user', text: 'hi Deni' }), message({ id: 2, role: 'deni', text: 'Hello player' })] }))
    // His greeting comes first, then the conversation.
    const items = within(screen.getByRole('log')).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[1]!.className).toContain('user')
    expect(items[1]!.textContent).toContain('hi Deni')
    expect(items[2]!.className).toContain('deni')
    expect(items[2]!.textContent).toContain('Hello player')
  })

  it('shows what the app says when the AI could not answer as an alert, apart from Deni\'s words', () => {
    panel(stubChat({ messages: [message({ failed: true, text: 'Deni\'s AI helper is busy. Try again in a minute.' })] }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Deni\'s AI helper is busy. Try again in a minute.')
    expect(alert.closest('li')!.className).toContain('failed')
  })

  it('can clear the chat, but only when there is one and he is not busy', async () => {
    const empty = stubChat()
    const view = panel(empty)
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull()
    view.unmount()
    const chat = stubChat({ messages: [message({})] })
    const second = panel(chat)
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(chat.reset).toHaveBeenCalledTimes(1)
    second.unmount()
    panel(stubChat({ messages: [message({})], thinking: true }))
    expect((screen.getByRole('button', { name: 'Start over' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the shots he understood', () => {
  const withCards = (cards: Card[], over: Partial<ChatApi> = {}) => stubChat({ messages: [message({ id: 7, cards })], ...over })

  it('shows each one with its zone, result, date, and note (the words are already in the chat above)', () => {
    panel(withCards([card(), card({ shot: elbow })]))
    expect(screen.getByText('Right corner 3 · 3PT · made · 2026-11-19')).toBeTruthy()
    expect(screen.getByText('caught and shot')).toBeTruthy()
    expect(screen.queryByText('hit one from the right corner')).toBeNull()
    expect(screen.getByText('Left elbow · 2PT · missed · 2026-11-19')).toBeTruthy()
  })

  it('draws where each shot was on a little court, coloured by the result', () => {
    const { container } = panel(withCards([card(), card({ shot: elbow })]))
    const courts = container.querySelectorAll('svg.mini-court')
    expect(courts).toHaveLength(2)
    expect(courts[0]!.classList.contains('made')).toBe(true)
    expect(courts[1]!.classList.contains('missed')).toBe(true)
    // The spot is the shot's own: 17 feet across, 19 up (the baseline is at the bottom of the drawing).
    const dot = courts[1]!.querySelector('.mc-dot')!
    expect(dot.getAttribute('cx')).toBe('17')
    expect(dot.getAttribute('cy')).toBe('28')
  })

  it('Save and Discard act on the right card of the right message', async () => {
    const chat = withCards([card(), card({ shot: elbow })])
    panel(chat)
    await userEvent.click(screen.getByRole('button', { name: 'Save shot 2' }))
    expect(chat.save).toHaveBeenCalledWith(7, 1)
    await userEvent.click(screen.getByRole('button', { name: 'Discard shot 1' }))
    expect(chat.discard).toHaveBeenCalledWith(7, 0)
  })

  it('shows a saved card as saved, without buttons', () => {
    panel(withCards([card({ status: 'saved' })]))
    expect(screen.getByText('Saved ✓')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save shot 1' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard shot 1' })).toBeNull()
  })

  it('hides a discarded card, but keeps the numbering of the others', () => {
    panel(withCards([card({ status: 'discarded' }), card({ shot: elbow })]))
    expect(screen.queryByText(/Right corner 3/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save shot 2' })).toBeTruthy()
  })

  it('shows Saving… and cannot be pressed again while a shot is being saved', () => {
    panel(withCards([card({ status: 'saving' })]))
    const save = screen.getByRole('button', { name: 'Save shot 1' }) as HTMLButtonElement
    expect(save.textContent).toBe('Saving…')
    expect(save.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Discard shot 1' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows why a save failed and offers Retry', () => {
    panel(withCards([card({ status: 'error', message: "Can't reach the backend" })]))
    expect(screen.getByText("Can't reach the backend")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save shot 1' }).textContent).toBe('Retry')
  })

  it('marks a look-alike of a shot just saved, offers Save again, and leaves it out of Save all', () => {
    panel(withCards([card({ lookalike: true }), card({ shot: elbow }), card({ shot: { ...elbow, x: 33 } })]))
    expect(screen.getByText('Looks like a shot you just saved.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save shot 1' }).textContent).toBe('Save again')
    expect(screen.getByRole('button', { name: 'Save all (2)' })).toBeTruthy()
  })

  it('Save all appears for two or more open shots and saves that message', async () => {
    const chat = withCards([card(), card({ shot: elbow })])
    panel(chat)
    await userEvent.click(screen.getByRole('button', { name: 'Save all (2)' }))
    expect(chat.saveAll).toHaveBeenCalledWith(7)
  })

  it('has no Save all for one open shot, or when the others are saved or discarded', () => {
    const view = panel(withCards([card()]))
    expect(screen.queryByRole('button', { name: /Save all/ })).toBeNull()
    view.unmount()
    panel(withCards([card(), card({ status: 'saved' }), card({ status: 'discarded' })]))
    expect(screen.queryByRole('button', { name: /Save all/ })).toBeNull()
  })

  it('cannot Save all while one is being saved', () => {
    panel(withCards([card(), card({ shot: elbow }), card({ status: 'saving' })]))
    expect((screen.getByRole('button', { name: 'Save all (2)' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('a new log with no player yet', () => {
  it('asks for a name, which the shots are saved under', async () => {
    const chat = stubChat({ savingFor: '' })
    panel(chat, { player: '' })
    await userEvent.type(screen.getByLabelText('Save my shots under the name'), 'N')
    expect(chat.setTypedPlayer).toHaveBeenCalledWith('N')
  })

  it('shows the name as typed, spaces and all, so a two-word name can be written', async () => {
    const chat = stubChat({ savingFor: 'Noam', typedPlayer: 'Noam ' })
    panel(chat, { player: '' })
    expect((screen.getByLabelText('Save my shots under the name') as HTMLInputElement).value).toBe('Noam ')
  })

  it('cannot save until there is a name, and says why', () => {
    const chat = stubChat({ savingFor: '', messages: [message({ cards: [card(), card({ shot: elbow })] })] })
    panel(chat, { player: '' })
    expect(screen.getByText(/Type your name below the chat/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save shot 1' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Save all (2)' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('can save once the name is there', () => {
    const chat = stubChat({ savingFor: 'Noam', messages: [message({ cards: [card()] })] })
    panel(chat, { player: '' })
    expect(screen.queryByText(/Type your name below the chat/)).toBeNull()
    expect((screen.getByRole('button', { name: 'Save shot 1' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not ask for a name when a player is chosen', () => {
    panel(stubChat())
    expect(screen.queryByLabelText('Save my shots under the name')).toBeNull()
  })
})

describe('many shots at once', () => {
  const withCards = (cards: Card[]) => stubChat({ messages: [message({ id: 7, cards })] })

  it('keeps a long list to one line until it is opened', async () => {
    const five = [card(), card({ shot: elbow }), card(), card(), card()]
    panel(withCards(five))
    const summary = screen.getByText('Review 5 shots')
    expect(summary.closest('details')!.open).toBe(false)
    expect(screen.getByRole('button', { name: 'Save all (5)' })).toBeTruthy()
    await userEvent.click(summary)
    expect(summary.closest('details')!.open).toBe(true)
  })

  it('shows a short list straight away', () => {
    panel(withCards([card(), card({ shot: elbow }), card()]))
    expect(screen.queryByText(/^Review \d+ shots$/)).toBeNull()
  })
})

describe('screen readers', () => {
  it('the log is not live: the caption announces each reply, so a reader hears it once', () => {
    panel(stubChat())
    expect(screen.getByRole('log', { name: 'Conversation with Deni' }).getAttribute('aria-live')).toBe('off')
  })
})

describe('the stylesheet', () => {
  it('stops his messages from taking the avatar\'s 100% x 100% box (both use the class "deni")', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf8')
    // The avatar rule is the reason: if it is ever changed, this test can go. Until then the message class must undo it.
    expect(css).toMatch(/\.deni \{[^}]*height: 100%/)
    const message = /\.chat-msg\.deni \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(message).toMatch(/height: auto/)
    expect(message).toMatch(/width: auto/)
  })
})
