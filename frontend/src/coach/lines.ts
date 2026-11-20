/**
 * What the coach says on his own, WITHOUT the AI: greetings, milestones, streaks, level-ups and his reactions when
 * he is poked. Every line is written in advance and filled in with the user's own numbers, so the same shots always
 * give the same words. When you talk to him, the AI answers (see useChat.ts). The lines are plain coaching, never
 * quotes from a real person.
 */
import { NBA_THREE_SHARE, SMALL_SAMPLE, compareZones } from '../court/nba'
import { summarize, zoneLabel } from '../court/stats'
import type { MapShot } from '../court/stats'

export type Mood = 'idle' | 'happy' | 'hype' | 'hmm'

export interface Line {
  text: string
  mood: Mood
}

/** One of a few wordings, rotating with `n` so a repeat does not sound the same (and tests stay exact). */
function pick<T>(options: readonly T[], n: number): T {
  return options[Math.abs(Math.trunc(n)) % options.length]!
}

export const INTRO: Line = {
  text: 'I am Deni, a fan-made coach. Ask me about your shots, or tell me about a session and I will show the shots for you to save.',
  mood: 'happy',
}

/** "1 shot", "2 shots". */
function shotsOf(n: number): string {
  return `${n} shot${n === 1 ? '' : 's'}`
}

export function greet(name: string, shots: number, rank: string, n = 0): Line {
  if (shots === 0) {
    return { text: 'Welcome. Your log is empty, so tell me about your first shot. I will be here.', mood: 'happy' }
  }
  const who = name || 'there'
  return {
    text: pick(
      [
        `Welcome back, ${who}. ${shotsOf(shots)} logged, rank ${rank}. Let us add some more.`,
        `Good to see you, ${who}. You have ${shotsOf(shots)} in the log and you are a ${rank}. Ready when you are.`,
      ],
      n,
    ),
    mood: 'happy',
  }
}

export function saved(made: boolean, n = 0): Line {
  return made
    ? { text: pick(['Bucket. Nice one.', 'That one is in. Keep that form.', 'Good make. Same routine next time.'], n), mood: 'happy' }
    : { text: pick(['Missed, but it is logged. The misses teach you the most.', 'No problem. Log it and take the next one.', 'Off the rim. Check the spot on the map.'], n), mood: 'hmm' }
}

export function streak(len: number): Line {
  return { text: `${len} in a row. You are heating up, keep shooting.`, mood: 'hype' }
}

export function levelUp(level: number, rank: string): Line {
  return { text: `Level ${level}, ${rank}. That is real progress, well done.`, mood: 'hype' }
}

export function trophy(title: string): Line {
  return { text: `Trophy unlocked: ${title}. Nicely done.`, mood: 'hype' }
}

export type TabName = 'log' | 'nba' | 'players'

/** A short hint the first time a page is opened in a session. */
export function tip(tab: TabName): Line {
  switch (tab) {
    case 'log':
      return { text: 'This is your court. Click a shot to select it, or press Watch session to see your latest shots replayed.', mood: 'idle' }
    case 'nba':
      return { text: 'Here you can compare your numbers with the NBA average, or with a player you pick. Orange is you, blue is them.', mood: 'idle' }
    case 'players':
      return { text: 'These are NBA players. The closest match to your shooting is first. Press Compare my shots to put one side by side with you.', mood: 'idle' }
  }
}

export interface AnswerContext {
  /** The shots of the player the app is showing, oldest first. */
  shots: MapShot[]
  shooter: string
  /** Which wording to use when a line has several (a rotating number). */
  n?: number
}

// ---------- Things he says without being asked, and small surprises ----------

/** Shot counts that get a line of their own when a saved shot reaches them. */
export const MILESTONES = [25, 50, 100, 150, 200, 300, 500, 1000] as const

export function milestone(count: number): Line {
  return { text: `Shot number ${count} in the log. Most people quit long before this. Keep stacking them.`, mood: 'hype' }
}

/** Whole days from one calendar date (YYYY-MM-DD) to another; null when either is not a date. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/** The greeting for someone who has been away: he says how long, and tells them to ease in. */
export function welcomeBack(name: string, days: number): Line {
  const who = name || 'there'
  return { text: `Welcome back, ${who}. ${days} days since your last shot, so ease in with a few warm-up ones.`, mood: 'happy' }
}

/** Fun facts that do not change with a season, so they stay true. */
export const FACTS: readonly string[] = [
  'Fun fact: Deni Avdija was born on January 3, 2001, in Beit Zera, in Israel.',
  'Fun fact: Deni was picked 9th overall in the 2020 NBA draft, the highest an Israeli has ever been drafted.',
  'Fun fact: before the NBA, Deni played for Maccabi Tel Aviv, and he plays for the Israeli national team.',
]

export function fact(n: number): Line {
  return { text: pick(FACTS, n), mood: 'happy' }
}

const POKES = ['Hey, careful, I am dribbling here.', 'Yes? I am right here, coach.', 'That tickles. Focus on your shot.', 'You can keep poking, the ball does not stop.']

export function poke(n: number): Line {
  return { text: pick(POKES, n), mood: 'happy' }
}

/** Poking him many times in a row. */
export const POKE_SPAM: Line = { text: 'Okay, okay, I am awake. Go take some shots.', mood: 'hype' }

/** The old cheat code: up up down down left right left right B A. */
export const KONAMI_CODE = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a']

export const KONAMI: Line = { text: 'Cheat code accepted. Sadly it adds nothing to your log, so go earn it on the court.', mood: 'hype' }


export interface ChatterContext extends AnswerContext {
  /** The local date and time, passed in so the lines can be tested. */
  now: Date
  /** The shooter's shots with their game dates (YYYY-MM-DD), for "today". */
  dates: string[]
  /** XP left to the next level, and the level's rank. */
  xpToNext: number
}

/** The local calendar date of `now` as YYYY-MM-DD. */
export function dayOf(now: Date): string {
  const p = (v: number) => String(v).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

interface Candidate {
  id: string
  line: Line | null
}

/** Everything he could say right now, each tied to something true at this moment. */
function candidates(ctx: ChatterContext): Candidate[] {
  const { shots, now } = ctx
  const out: Candidate[] = []
  const hour = now.getHours()
  if (hour >= 23 || hour < 5) out.push({ id: 'night', line: { text: 'It is late. Take one more, then get some sleep. Shooters need it too.', mood: 'idle' } })
  if (hour >= 5 && hour < 9) out.push({ id: 'morning', line: { text: 'An early session. That habit pays off.', mood: 'happy' } })
  if (now.getDay() === 5 && hour >= 14) out.push({ id: 'friday', line: { text: 'Friday afternoon, last shots before the weekend. Make them count.', mood: 'happy' } })
  const today = ctx.dates.filter((d) => d === dayOf(now)).length
  if (today >= 3) out.push({ id: 'today', line: { text: `${shotsOf(today)} logged today. That is a real session.`, mood: 'happy' } })
  if (ctx.xpToNext > 0 && ctx.xpToNext <= 40) out.push({ id: 'xp', line: { text: `Only ${ctx.xpToNext} XP to the next level. One good streak does it.`, mood: 'hype' } })
  const zones = compareZones(shots).filter((z) => z.attempts >= SMALL_SAMPLE && z.mine !== null)
  if (zones.length > 0) {
    const best = zones.reduce((a, b) => (b.mine! > a.mine! ? b : a))
    out.push({ id: 'best', line: { text: `Quick note: ${zoneLabel(best.zone)} is your best area at ${best.mine}%. Do not forget to use it.`, mood: 'happy' } })
    const worst = zones.reduce((a, b) => (b.diff! < a.diff! ? b : a))
    if (worst.diff! < 0) out.push({ id: 'worst', line: { text: `I keep thinking about your ${zoneLabel(worst.zone).toLowerCase()}: ${worst.mine}% against about ${worst.nba}% in the league. A few extra shots there would help.`, mood: 'idle' } })
  }
  const s = summarize(shots)
  if (s.attempts >= 20 && s.threeAttempts / s.attempts < 0.2) {
    out.push({ id: 'threes', line: { text: `Only ${Math.round((s.threeAttempts / s.attempts) * 100)}% of your shots are threes. The league takes about ${NBA_THREE_SHARE}% from there.`, mood: 'idle' } })
  }
  const last3 = shots.slice(-3)
  if (last3.length === 3 && last3.every((x) => !x.made)) {
    out.push({ id: 'cold', line: { text: 'Three misses in a row. Breathe, reset, same routine on the next one.', mood: 'hmm' } })
  }
  out.push({ id: 'water', line: { text: 'Water break? Staying hydrated is part of the training.', mood: 'idle' } })
  return out
}

/**
 * One thing to say out of the choices that fit right now, avoiding the ones already said (`used`). Null when
 * none are left, so he stays quiet instead of repeating himself.
 */
export function chatter(ctx: ChatterContext, used: ReadonlySet<string>, n: number): { id: string; line: Line } | null {
  const fresh = candidates(ctx).filter((c): c is { id: string; line: Line } => c.line !== null && !used.has(c.id))
  if (fresh.length === 0) return null
  return pick(fresh, n)
}
