import type { StatsSummary } from '../api'
import { NBA_OVERALL, compareZones } from '../court/nba'
import { summarize } from '../court/stats'
import type { MapShot } from '../court/stats'

/**
 * The numbers Deni's AI may state: worked out HERE, by the same code the rest of the app uses, from the player's
 * own log. The AI never calculates; it is handed these and explains them. The league numbers are estimates
 * (court/nba.ts) and the AI is told so. Null when there are no shots yet.
 */
export function buildStats(shots: MapShot[], player: string): StatsSummary | null {
  if (shots.length === 0) return null
  const s = summarize(shots)
  return {
    player: player.slice(0, 50),
    attempts: s.attempts,
    made: s.made,
    fg_pct: s.fg,
    three_attempts: s.threeAttempts,
    three_made: s.threeMade,
    three_pct: s.three,
    // Only zones the player has shot from, most shots first (compareZones already sorts that way).
    zones: compareZones(shots)
      .filter((z) => z.attempts > 0)
      .map((z) => ({ zone: z.zone, attempts: z.attempts, made: z.made, pct: z.mine, nba_pct: z.nba })),
    nba_fg: NBA_OVERALL.fg,
    nba_three: NBA_OVERALL.three,
  }
}
