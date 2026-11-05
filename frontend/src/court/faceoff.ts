import { sideOf } from './verdict'
import type { Side } from './verdict'
import type { CardProfile } from './cardData'

/** The face-off closes by itself after this long, so picking players never leaves a screen to dismiss. */
export const FACE_OFF_MS = 7500

export interface Row {
  label: string
  you: number | null
  them: number | null
  /** The bar's full length: 99 for the rating, 100 for a percentage. */
  max: number
  /** Whether the higher number wins. Share of threes is a style, so nobody wins it. */
  judged: boolean
  unit: string
}

/** The rows between the two cards. Exported so the numbers can be tested without the animation. */
export function faceOffRows(you: CardProfile, them: CardProfile): Row[] {
  return [
    { label: 'Shooting rating', you: you.rating, them: them.rating, max: 99, judged: true, unit: '' },
    { label: 'Field goal', you: you.fg, them: them.fg, max: 100, judged: true, unit: '%' },
    { label: 'Three point', you: you.three, them: them.three, max: 100, judged: true, unit: '%' },
    { label: 'Share of threes', you: you.threeShare, them: them.threeShare, max: 100, judged: false, unit: '%' },
  ]
}

/** Who wins a row: nobody if it is not judged or either side has no number. */
export function rowWinner(row: Row): Side | null {
  if (!row.judged || row.you === null || row.them === null) return null
  return sideOf(row.you, row.them)
}
