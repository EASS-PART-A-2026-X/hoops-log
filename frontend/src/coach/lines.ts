/**
 * What the coach says. Every line is written in advance and filled in with the user's own numbers: there is
 * no AI behind it (that is a later step), so the same shots always give the same words. The lines are
 * plain coaching, never quotes from a real person.
 */
import { MIN_SHOTS_FOR_MATCH, NBA_OVERALL, SMALL_SAMPLE, compareZones, rankPlayers } from '../court/nba'
import { summarize, zoneLabel } from '../court/stats'
import type { MapShot } from '../court/stats'
import { XP_LOG, XP_MAKE, XP_THREE_BONUS } from '../game/xp'

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
  text: 'I am Deni, a fan-made coach. I only know what is in your log, so ask me about your shots.',
  mood: 'happy',
}

export function greet(name: string, shots: number, rank: string, n = 0): Line {
  if (shots === 0) {
    return { text: 'Welcome. Your log is empty, so open the Shots button and add your first shot. I will be here.', mood: 'happy' }
  }
  const who = name || 'there'
  return {
    text: pick(
      [
        `Welcome back, ${who}. ${shots} shots logged, rank ${rank}. Let us add some more.`,
        `Good to see you, ${who}. You have ${shots} shots in the log and you are a ${rank}. Ready when you are.`,
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

export interface Question {
  id: QuestionId
  label: string
}

export type QuestionId = 'add' | 'doing' | 'practise' | 'best' | 'like' | 'map' | 'xp'

export const QUESTIONS: readonly Question[] = [
  { id: 'doing', label: 'How am I shooting?' },
  { id: 'practise', label: 'What should I practise?' },
  { id: 'best', label: 'Where am I best?' },
  { id: 'like', label: 'Which NBA player am I like?' },
  { id: 'add', label: 'How do I add a shot?' },
  { id: 'map', label: 'What am I looking at on the court?' },
  { id: 'xp', label: 'How do XP and levels work?' },
]

export interface AnswerContext {
  /** The shots of the player the app is showing. */
  shots: MapShot[]
  shooter: string
}

const empty: Line = { text: 'There are no shots in this log yet, so I have nothing to go on. Add a few and ask me again.', mood: 'hmm' }

/** The answer to a tapped question, worked out from the shots. Each answer says when the sample is too small. */
export function answer(id: QuestionId, ctx: AnswerContext): Line {
  const { shots } = ctx
  switch (id) {
    case 'add':
      return {
        text: 'Press the Shots button at the top, then Add a shot. Type where you shot from, X across the court and Y from the baseline, say made or missed, and save.',
        mood: 'idle',
      }
    case 'map':
      return {
        text: 'Each light is one shot: orange for made, blue for missed. Use Style to switch between the heat map, beams and flight paths, and the chips to filter by area or result.',
        mood: 'idle',
      }
    case 'xp':
      return {
        text: `Every shot you log gives ${XP_LOG} XP, a make gives ${XP_MAKE} more, and a three gives ${XP_THREE_BONUS} extra. Streaks add bonus XP. Fill the bar to level up and unlock trophies.`,
        mood: 'idle',
      }
    case 'doing': {
      if (shots.length === 0) return empty
      const s = summarize(shots)
      const parts = [`You have made ${s.made} of ${s.attempts}, which is ${s.fg}%. The NBA average is about ${NBA_OVERALL.fg}%.`]
      if (s.threeAttempts > 0) parts.push(`From three you are at ${s.three}% on ${s.threeAttempts} shots, against about ${NBA_OVERALL.three}%.`)
      else parts.push('You have not logged a three yet.')
      if (s.attempts < SMALL_SAMPLE * 2) parts.push('It is a small sample, so do not read too much into it.')
      return { text: parts.join(' '), mood: s.fg !== null && s.fg >= NBA_OVERALL.fg ? 'happy' : 'idle' }
    }
    case 'best': {
      if (shots.length === 0) return empty
      const zones = compareZones(shots).filter((z) => z.attempts >= SMALL_SAMPLE && z.mine !== null)
      if (zones.length === 0) return { text: `No area has ${SMALL_SAMPLE} shots yet, so I cannot say. Spread your shots out and ask again.`, mood: 'hmm' }
      const best = zones.reduce((a, b) => (b.mine! > a.mine! ? b : a))
      return {
        text: `${zoneLabel(best.zone)} is your best area: ${best.made} of ${best.attempts}, ${best.mine}%. Use it when you need a bucket.`,
        mood: 'happy',
      }
    }
    case 'practise': {
      if (shots.length === 0) return empty
      const zones = compareZones(shots).filter((z) => z.attempts >= SMALL_SAMPLE && z.diff !== null)
      if (zones.length === 0) return { text: `Take at least ${SMALL_SAMPLE} shots from a few areas first, and then I can tell you where to work.`, mood: 'hmm' }
      const worst = zones.reduce((a, b) => (b.diff! < a.diff! ? b : a))
      if (worst.diff! >= 0) {
        return { text: 'Every area with enough shots is at or above the NBA average. Keep going, and try shooting from a spot you rarely use.', mood: 'happy' }
      }
      return {
        text: `Work on ${zoneLabel(worst.zone)}. You make ${worst.mine}% there and the league makes about ${worst.nba}%. Take 20 shots from that spot next session and log them.`,
        mood: 'idle',
      }
    }
    case 'like': {
      const ranked = rankPlayers(shots)
      if (ranked === null) return { text: `I need at least ${MIN_SHOTS_FOR_MATCH} shots to find a match. Log a few more.`, mood: 'hmm' }
      const top = ranked[0]!
      return {
        text: `Closest in numbers: ${top.player.name}, a ${top.score} out of 100 match. It only compares overall percentages and how often you shoot threes, so take it as a fun guide.`,
        mood: 'happy',
      }
    }
  }
}
