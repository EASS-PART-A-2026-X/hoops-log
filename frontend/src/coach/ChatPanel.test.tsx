// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProposedShot } from '../api'
import ChatPanel from './ChatPanel'
import { QUESTIONS } from './lines'
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
const shots = [1, 2, 3, 4, 5, 6].map((id) => ({ id, player: 'Yuly', made: true, zone: 'paint', shot_type: '2PT' as const, x: 25, y: 5 }))
const context = { shots, shooter: 'Yuly' }

function stubChat(over: Partial<ChatApi> = {}): ChatApi {
  return {
    messages: [],
    thinking: false,
    savingFor: 'Yuly',
    setTypedPlayer: vi.fn(),
    send: vi.fn(async () => {}),
    cancel: vi.fn(),
    reset: vi.fn(),
    addScripted: vi.fn(),
    save: vi.fn(async () => {}),
    discard: vi.fn(),
    saveAll: vi.fn(async () => {}),
    ...over,
  }
}
const panel = (chat: ChatApi, props: { aiAvailable?: boolean | null; player?: string } = {}) =>
  render(<ChatPanel chat={chat} aiAvailable={props.aiAvailable === undefined ? true : props.aiAvailable} context={context} player={props.player ?? 'Yuly'} />)
const box = () => screen.getByRole('textbox', { name: 'Message to Deni' }) as HTMLTextAreaElement
const message = (over: Partial<ChatMessage>): ChatMessage => ({ id: 1, role: 'deni', text: 'Hello', ...over })
const card = (over: Partial<Card> = {}): Card => ({ shot: corner, status: 'pending', ...over })

describe('what it says before anything is said', () => {
  it('invites you to ask or to tell him about a session', () => {
    panel(stubChat())
    expect(screen.getByText(/tell me about a session/)).toBeTruthy()
    expect(screen.getByRole('log', { name: 'Conversation with Deni' })).toBeTruthy()
  })

  it('says his AI helper is offline, and points to the questions and the by-hand route', () => {
    panel(stubChat(), { aiAvailable: false })
    expect(screen.getByText(/AI helper is offline/)).toBeTruthy()
    expect(box().placeholder).toBe('His AI helper is offline')
  })

  it('treats "not known yet" as there', () => {
    panel(stubChat(), { aiAvailable: null })
    expect(screen.queryByText(/offline/)).toBeNull()
    expect(box().placeholder).toBe('Message Deni…')
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
    for (const q of QUESTIONS) expect((screen.getByRole('button', { name: q.label }) as HTMLButtonElement).disabled).toBe(true)
    expect((box().form as HTMLFormElement).querySelector('button[type=submit]')).toBeTruthy()
  })

  it('shows no Cancel when nothing is running', () => {
    panel(stubChat())
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })
})

describe('the quick questions', () => {
  it.each(['How am I shooting?', 'What should I practise?', 'Where am I best?'])('send "%s" to the AI when it is there', async (label) => {
    const chat = stubChat()
    panel(chat)
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(chat.send).toHaveBeenCalledWith(label)
    expect(chat.addScripted).not.toHaveBeenCalled()
  })

  it.each(['How am I shooting?', 'What should I practise?', 'Where am I best?'])('are answered from his written lines when the AI is offline: "%s"', async (label) => {
    const chat = stubChat()
    panel(chat, { aiAvailable: false })
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(chat.send).not.toHaveBeenCalled()
    expect(chat.addScripted).toHaveBeenCalledWith(label, expect.objectContaining({ text: expect.stringMatching(/./) }))
  })

  it.each(['Which NBA player am I like?', 'What am I looking at on the court?', 'How do XP and levels work?', 'Tell me something about Deni'])(
    'about the app or about him ("%s") always come from lines written in advance, so the AI cannot make things up',
    async (label) => {
      const chat = stubChat()
      panel(chat)
      await userEvent.click(screen.getByRole('button', { name: label }))
      expect(chat.send).not.toHaveBeenCalled()
      expect(chat.addScripted).toHaveBeenCalledTimes(1)
    },
  )

  it('answers how to add a shot by saying to tell him, or by pointing to the form when he is offline', async () => {
    const online = stubChat()
    const view = panel(online)
    await userEvent.click(screen.getByRole('button', { name: 'How do I add a shot?' }))
    expect(vi.mocked(online.addScripted).mock.calls[0]![1].text).toMatch(/Just tell me/)
    view.unmount()
    const offline = stubChat()
    panel(offline, { aiAvailable: false })
    await userEvent.click(screen.getByRole('button', { name: 'How do I add a shot?' }))
    expect(vi.mocked(offline.addScripted).mock.calls[0]![1].text).toMatch(/offline.*Add a shot/)
  })

  it('answers the same written question twice with a remark, but not a fact, and an AI question in between resets it', async () => {
    const chat = stubChat()
    panel(chat)
    const lines = () => vi.mocked(chat.addScripted).mock.calls.map((call) => call[1].text)
    await userEvent.click(screen.getByRole('button', { name: 'How do XP and levels work?' }))
    await userEvent.click(screen.getByRole('button', { name: 'How do XP and levels work?' }))
    expect(lines()[0]).not.toMatch(/^Same question/)
    expect(lines()[1]).toMatch(/^Same question/)
    await userEvent.click(screen.getByRole('button', { name: 'Where am I best?' })) // goes to the AI: resets
    await userEvent.click(screen.getByRole('button', { name: 'How do XP and levels work?' }))
    expect(lines()[2]).not.toMatch(/^Same question/)
    await userEvent.click(screen.getByRole('button', { name: 'Tell me something about Deni' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tell me something about Deni' }))
    expect(lines()[4]).not.toMatch(/^Same question/)
    expect(lines()[3]).not.toBe(lines()[4]) // facts rotate
  })
})

describe('the conversation', () => {
  it('shows what was said by whom', () => {
    panel(stubChat({ messages: [message({ id: 1, role: 'user', text: 'hi Deni' }), message({ id: 2, role: 'deni', text: 'Hello player' })] }))
    const items = within(screen.getByRole('log')).getAllByRole('listitem')
    expect(items[0]!.className).toContain('user')
    expect(items[0]!.textContent).toContain('hi Deni')
    expect(items[1]!.className).toContain('deni')
    expect(items[1]!.textContent).toContain('Hello player')
  })

  it('shows what the app says when the AI could not answer as an alert, apart from Deni\'s words', () => {
    panel(stubChat({ messages: [message({ failed: true, text: 'Deni\'s AI helper is busy. Try again in a minute.' })] }))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Deni\'s AI helper is busy. Try again in a minute.')
    expect(alert.closest('li')!.className).toContain('failed')
  })

  it('has no invitation once there are messages', () => {
    panel(stubChat({ messages: [message({})] }))
    expect(screen.queryByText(/tell me about a session/)).toBeNull()
  })

  it('can clear the chat, but only when there is one and he is not busy', async () => {
    const empty = stubChat()
    const view = panel(empty)
    expect(screen.queryByRole('button', { name: 'Clear the chat' })).toBeNull()
    view.unmount()
    const chat = stubChat({ messages: [message({})] })
    const second = panel(chat)
    await userEvent.click(screen.getByRole('button', { name: 'Clear the chat' }))
    expect(chat.reset).toHaveBeenCalledTimes(1)
    second.unmount()
    panel(stubChat({ messages: [message({})], thinking: true }))
    expect((screen.getByRole('button', { name: 'Clear the chat' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the shots he understood', () => {
  const withCards = (cards: Card[], over: Partial<ChatApi> = {}) => stubChat({ messages: [message({ id: 7, cards })], ...over })

  it('shows each one with its zone, result, date, note and the words it came from', () => {
    panel(withCards([card(), card({ shot: elbow })]))
    expect(screen.getByText('Right corner 3 · 3PT · made · 2026-11-19')).toBeTruthy()
    expect(screen.getByText('caught and shot')).toBeTruthy()
    expect(screen.getByText('hit one from the right corner')).toBeTruthy()
    expect(screen.getByText('Left elbow · 2PT · missed · 2026-11-19')).toBeTruthy()
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

  it('shows why a save failed and offers Try again', () => {
    panel(withCards([card({ status: 'error', message: "Can't reach the backend" })]))
    expect(screen.getByText("Can't reach the backend")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save shot 1' }).textContent).toBe('Try again')
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
