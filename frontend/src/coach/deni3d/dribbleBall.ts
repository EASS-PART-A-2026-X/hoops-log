/**
 * Where the ball is while the recorded dribble plays. The ball is never recorded: it is worked out from the dribbling
 * hand. Each bounce goes from one high point of the hand to the next, and the ball falls to the floor and comes back
 * on its own; whenever it is lower than the hand's palm it flies free, and whenever the hand would be lower than the
 * top of it, it rests in the hand. So the hand carries it down, lets go, and catches it again, whatever rhythm the
 * recording has. Pure, so it can be tested.
 */

/** Seconds of the highest points of the hand in a recording (`series` = its height, sampled `fps` times a second). */
export function findTops(series: readonly number[], fps: number): number[] {
  const n = series.length
  if (n < 5) return []
  const sm = series.map((_, i) => {
    const part = series.slice(Math.max(0, i - 2), Math.min(n, i + 3))
    return part.reduce((a, b) => a + b, 0) / part.length
  })
  const range = Math.max(...sm) - Math.min(...sm)
  const reach = Math.round(0.4 * fps)
  const tops: number[] = []
  for (let i = 1; i < n - 1; i++) {
    if (!(sm[i]! >= sm[i - 1]! && sm[i]! > sm[i + 1]!)) continue
    // A real high point: well above the lowest point nearby, not a wobble.
    const around = sm.slice(Math.max(0, i - reach), Math.min(n, i + reach + 1))
    if (sm[i]! - Math.min(...around) < 0.35 * range) continue
    const last = tops[tops.length - 1]
    if (last !== undefined && i - last < 0.35 * fps) {
      if (sm[i]! > sm[last]!) tops[tops.length - 1] = i
      continue
    }
    tops.push(i)
  }
  return tops.map((i) => i / fps)
}

/** The ball's height if nothing held it: from the top (a high point of the hand) to the floor and back to the next top. */
export function freeBallY(t: number, tops: readonly number[], duration: number, top: number, radius: number): number {
  if (tops.length === 0 || duration <= 0) return top
  const tt = ((t % duration) + duration) % duration
  // The recording repeats, so the bounce that crosses the end of it continues from the start.
  const cycle = [tops[tops.length - 1]! - duration, ...tops, tops[0]! + duration]
  let i = 0
  while (i < cycle.length - 2 && tt >= cycle[i + 1]!) i++
  const phase = (tt - cycle[i]!) / (cycle[i + 1]! - cycle[i]!)
  return radius + (top - radius) * Math.pow(Math.abs(Math.cos(Math.PI * phase)), 0.65)
}

/** Where the ball's centre is, given where the wrist is: under the palm while held, free when it has fallen below it. */
export function ballCentreY(freeY: number, wristY: number, below: number): number {
  return Math.min(freeY, wristY - below)
}
