import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, MAX_TURNS, sendChat } from '../api'
import type { ChatTurn, Shot, ShotInput } from '../api'
import type { MapShot } from '../court/stats'
import { today } from '../today'
import { buildStats } from './chatStats'
import type { Line } from './lines'
import { isOpen, keyOf, markLookalikes } from './proposals'
import type { Card } from './proposals'

export interface ChatMessage {
  id: number
  role: 'user' | 'deni'
  text: string
  /** Not Deni: the app saying it could not reach the AI. Never sent to the AI as part of the conversation. */
  failed?: boolean
  /** The shots Deni proposed with this reply, for the player to Save or Discard. */
  cards?: Card[]
}

interface Options {
  /** The shots of the player the app is showing, and who that is: each player has a chat of their own. */
  shots: MapShot[]
  player: string
  /** Makes Deni say a line (caption, face and voice). */
  say: (line: Line) => void
  /** Create one shot in the backend, nothing else. Rejects with an ApiError when refused. */
  onCreate: (input: ShotInput) => Promise<Shot>
  /** Called ONCE after one shot, or after a whole "Save all", with what was really saved (it refreshes the list). */
  onSaved: (saved: Shot[]) => Promise<void>
  /** Told after every try: did the AI answer? The app uses it to decide whether to offer the manual form. */
  onOutcome: (answered: boolean) => void
}

/**
 * The conversation with Deni. It lives as long as the page is open (a later step stores it in the backend), one
 * chat per player. Every message goes to the backend with the last few before it and the numbers the app worked
 * out from the log; Deni's reply comes back with any shots the player described, as cards. Nothing is saved until
 * the player presses Save on a card.
 */
export function useChat({ shots, player, say, onCreate, onSaved, onOutcome }: Options) {
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({})
  const [thinking, setThinking] = useState(false)
  // Who the saved shots are for when no player is chosen yet (a new log): a name typed in the chat.
  const [typedPlayer, setTypedPlayer] = useState('')
  const savingFor = player !== '' ? player : typedPlayer.trim()
  // The latest chats for the callbacks below, which run later (events, after awaits) and must not read old ones.
  const chatsRef = useRef(chats)
  useEffect(() => {
    chatsRef.current = chats
  })
  const nextId = useRef(1)
  // A ticket per question: one that was cancelled (or whose chat was cleared) is ignored when its answer arrives.
  const latest = useRef(0)
  const pending = useRef<AbortController | null>(null)
  // Shots saved from the cards, so a later reply that proposes the same shot can say so.
  const savedKeys = useRef<string[]>([])
  useEffect(() => () => pending.current?.abort(), [])

  const messages = chats[player] ?? []

  const append = useCallback((who: string, message: Omit<ChatMessage, 'id'>) => {
    const full = { ...message, id: nextId.current++ }
    setChats((all) => ({ ...all, [who]: [...(all[who] ?? []), full] }))
    return full.id
  }, [])

  /** Change one card from what it is NOW (not from a copy taken earlier, which Save all would make stale). */
  const patchCard = useCallback((who: string, messageId: number, index: number, patch: Partial<Card>) => {
    setChats((all) => ({
      ...all,
      [who]: (all[who] ?? []).map((m) =>
        m.id === messageId ? { ...m, cards: m.cards?.map((old, i) => (i === index ? { ...old, ...patch } : old)) } : m,
      ),
    }))
  }, [])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (text === '' || pending.current !== null) return
      const who = player
      // What the AI is shown: the chat so far (not the app's own error notes) and the new message, at most MAX_TURNS.
      const history: ChatTurn[] = (chatsRef.current[who] ?? [])
        .filter((m) => !m.failed)
        .map((m) => ({ role: m.role, text: m.text }))
      const turns = [...history, { role: 'user' as const, text }].slice(-MAX_TURNS)
      append(who, { role: 'user', text })
      const ticket = ++latest.current
      const controller = new AbortController()
      pending.current = controller
      setThinking(true)
      try {
        const answer = await sendChat(turns, buildStats(shots, who), today(), controller.signal)
        if (ticket !== latest.current) return
        const marks = markLookalikes(savingFor, answer.proposals, savedKeys.current)
        const cards: Card[] = answer.proposals.map((shot, i) => ({ shot, status: 'pending', lookalike: marks[i] }))
        append(who, { role: 'deni', text: answer.reply, cards })
        say({ text: answer.reply, mood: answer.proposals.length > 0 ? 'happy' : 'idle' })
        onOutcome(true)
      } catch (caught) {
        if (ticket !== latest.current) return
        append(who, {
          role: 'deni',
          failed: true,
          text: caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.',
        })
        onOutcome(false)
      } finally {
        if (ticket === latest.current) {
          pending.current = null
          setThinking(false)
        }
      }
    },
    [append, onOutcome, player, savingFor, say, shots],
  )

  const cancel = useCallback(() => {
    latest.current++
    pending.current?.abort()
    pending.current = null
    setThinking(false)
  }, [])

  const reset = useCallback(() => {
    cancel()
    setChats((all) => ({ ...all, [player]: [] }))
  }, [cancel, player])

  /** Create one proposed shot; the card shows how it went. Returns the saved shot, or null when it failed. */
  const create = useCallback(
    async (messageId: number, index: number): Promise<Shot | null> => {
      const card = chatsRef.current[player]?.find((m) => m.id === messageId)?.cards?.[index]
      if (!card || savingFor === '') return null
      const { shot } = card
      patchCard(player, messageId, index, { status: 'saving', message: undefined })
      try {
        const saved = await onCreate({ player: savingFor, x: shot.x, y: shot.y, made: shot.made, game_date: shot.game_date, note: shot.note })
        savedKeys.current.push(keyOf(savingFor, shot))
        patchCard(player, messageId, index, { status: 'saved' })
        return saved
      } catch (caught) {
        const message = caught instanceof ApiError ? caught.message : 'Could not save this shot.'
        patchCard(player, messageId, index, { status: 'error', message })
        return null
      }
    },
    [onCreate, patchCard, player, savingFor],
  )

  /**
   * After the first shot of a new log is saved under a typed name, that name becomes the chosen player, and the
   * conversation moves with it (each player has a chat of their own, so it would otherwise seem to vanish).
   */
  const adopt = useCallback(() => {
    if (player !== '' || savingFor === '') return
    setChats((all) => {
      const moved = all[''] ?? []
      if (moved.length === 0) return all
      return { ...all, '': [], [savingFor]: [...(all[savingFor] ?? []), ...moved] }
    })
  }, [player, savingFor])

  const save = useCallback(
    async (messageId: number, index: number) => {
      const saved = await create(messageId, index)
      if (saved) {
        adopt()
        await onSaved([saved])
      }
    },
    [adopt, create, onSaved],
  )

  const discard = useCallback(
    (messageId: number, index: number) => {
      patchCard(player, messageId, index, { status: 'discarded' })
    },
    [patchCard, player],
  )

  const saveAll = useCallback(
    async (messageId: number) => {
      const cards = chatsRef.current[player]?.find((m) => m.id === messageId)?.cards ?? []
      // One at a time, in order, so the shot numbers follow the order of the chat; then ONE refresh and ONE notice.
      const todo = cards.flatMap((card, index) => (isOpen(card) ? [index] : []))
      const saved: Shot[] = []
      for (const index of todo) {
        const one = await create(messageId, index)
        if (one) saved.push(one)
      }
      if (saved.length > 0) {
        adopt()
        await onSaved(saved)
      }
    },
    [adopt, create, onSaved, player],
  )

  return { messages, thinking, savingFor, typedPlayer, setTypedPlayer, send, cancel, reset, save, discard, saveAll }
}

export type ChatApi = ReturnType<typeof useChat>
