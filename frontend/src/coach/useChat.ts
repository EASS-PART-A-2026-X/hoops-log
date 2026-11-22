import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, MAX_TURNS, deleteChatHistory, getChatHistory, sendChat } from '../api'
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
 * The conversation with Deni, one chat per player. The backend keeps it (text only, never the cards), so when a
 * player's chat is first needed the saved conversation is loaded, and "Start over" makes the backend forget it.
 * Every message goes to the backend with the last few before it and the numbers the app worked
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

  // Whose saved conversation was already asked for, and how many times "Start over" was pressed (an answer that
  // arrives after one is old news and is dropped).
  const asked = useRef(new Set<string>())
  const startedOver = useRef(0)
  useEffect(() => {
    if (player === '' || asked.current.has(player)) return
    asked.current.add(player)
    const startedAt = startedOver.current
    getChatHistory(player)
      .then((lines) => {
        if (lines.length === 0 || startedAt !== startedOver.current) return
        // The saved lines come BEFORE anything said while they were loading.
        const earlier: ChatMessage[] = lines.map((line) => ({ id: nextId.current++, role: line.role, text: line.text }))
        setChats((all) => ({ ...all, [player]: [...earlier, ...(all[player] ?? [])] }))
      })
      .catch(() => {
        // No saved conversation to show (the backend may be down): start empty, and ask again next time.
        asked.current.delete(player)
      })
  }, [player])

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
        const answer = await sendChat(turns, buildStats(shots, who), today(), controller.signal, who)
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
    startedOver.current++
    setChats((all) => ({ ...all, [player]: [] }))
    if (player !== '') {
      const who = player
      deleteChatHistory(who).catch(() => {
        // The page is empty but the backend still has the conversation: say so, instead of looking done.
        append(who, { role: 'deni', failed: true, text: 'I could not forget our earlier chat just now. It may come back when you reopen this. Try Start over again.' })
      })
    }
  }, [append, cancel, player])

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
