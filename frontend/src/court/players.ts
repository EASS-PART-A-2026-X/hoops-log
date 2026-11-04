/**
 * A hand-written list of well-known players. The numbers are rounded, recent-seasons figures
 * typed in by hand (not from a data feed), so the page calls them "about". Teams change, so a
 * player's team may be out of date. Photos and logos come from the NBA's public image
 * host and are only ever shown with a drawn fallback (see `PlayerImage`).
 */
export interface Team {
  id: number
  name: string
  abbr: string
  color: string
}

export interface Player {
  id: number
  name: string
  team: string // key into TEAMS
  position: string
  fg: number
  three: number
  ppg: number
  style: string
}

export const TEAMS: Record<string, Team> = {
  GSW: { id: 1610612744, name: 'Warriors', abbr: 'GSW', color: '#1d428a' },
  LAL: { id: 1610612747, name: 'Lakers', abbr: 'LAL', color: '#552583' },
  HOU: { id: 1610612745, name: 'Rockets', abbr: 'HOU', color: '#ce1141' },
  DEN: { id: 1610612743, name: 'Nuggets', abbr: 'DEN', color: '#0e2240' },
  BOS: { id: 1610612738, name: 'Celtics', abbr: 'BOS', color: '#007a33' },
  MIA: { id: 1610612748, name: 'Heat', abbr: 'MIA', color: '#98002e' },
  OKC: { id: 1610612760, name: 'Thunder', abbr: 'OKC', color: '#007ac1' },
  SAS: { id: 1610612759, name: 'Spurs', abbr: 'SAS', color: '#5f6b73' },
  PHI: { id: 1610612755, name: '76ers', abbr: 'PHI', color: '#006bb6' },
  PHX: { id: 1610612756, name: 'Suns', abbr: 'PHX', color: '#e56020' },
  MIN: { id: 1610612750, name: 'Timberwolves', abbr: 'MIN', color: '#236192' },
  NYK: { id: 1610612752, name: 'Knicks', abbr: 'NYK', color: '#f58426' },
  LAC: { id: 1610612746, name: 'Clippers', abbr: 'LAC', color: '#c8102e' },
}

export const PLAYERS: Player[] = [
  { id: 201939, name: 'Stephen Curry', team: 'GSW', position: 'Guard', fg: 47, three: 41, ppg: 25, style: 'The greatest shooter ever: threes off the dribble from anywhere.' },
  { id: 2544, name: 'LeBron James', team: 'PHI', position: 'Forward', fg: 51, three: 35, ppg: 25, style: 'Drives and finishes at the rim, with a steady jumper.' },
  { id: 201142, name: 'Kevin Durant', team: 'HOU', position: 'Forward', fg: 52, three: 39, ppg: 27, style: 'A 7-footer who scores from every spot, mid-range included.' },
  { id: 203999, name: 'Nikola Jokić', team: 'DEN', position: 'Center', fg: 57, three: 36, ppg: 27, style: 'Hooks, floaters and passes, with very high percentages inside.' },
  { id: 1628369, name: 'Jayson Tatum', team: 'BOS', position: 'Forward', fg: 46, three: 37, ppg: 26, style: 'Big wing who mixes threes with step-back mid-range shots.' },
  { id: 203507, name: 'Giannis Antetokounmpo', team: 'MIA', position: 'Forward', fg: 55, three: 28, ppg: 30, style: 'Almost all points at the rim and from the free-throw line.' },
  { id: 1629029, name: 'Luka Dončić', team: 'LAL', position: 'Guard', fg: 46, three: 35, ppg: 28, style: 'Slow, step-back threes and pull-up jumpers.' },
  { id: 1628983, name: 'Shai Gilgeous-Alexander', team: 'OKC', position: 'Guard', fg: 54, three: 36, ppg: 31, style: 'The mid-range master: gets to his spot and rarely misses.' },
  { id: 1641705, name: 'Victor Wembanyama', team: 'SAS', position: 'Center', fg: 47, three: 33, ppg: 24, style: 'Seven foot five and shoots threes: a rim protector who spaces the floor.' },
  { id: 203954, name: 'Joel Embiid', team: 'PHI', position: 'Center', fg: 47, three: 34, ppg: 28, style: 'Elbow jumpers and post moves, and he lives at the free-throw line.' },
  { id: 1626164, name: 'Devin Booker', team: 'PHX', position: 'Guard', fg: 49, three: 37, ppg: 26, style: 'A classic mid-range scorer who also shoots from deep.' },
  { id: 1630162, name: 'Anthony Edwards', team: 'MIN', position: 'Guard', fg: 46, three: 36, ppg: 26, style: 'Explosive drives and deep pull-up threes.' },
  { id: 1628973, name: 'Jalen Brunson', team: 'NYK', position: 'Guard', fg: 48, three: 40, ppg: 26, style: 'Footwork and pull-up jumpers: a lot of points from 10 to 18 feet.' },
  { id: 202695, name: 'Kawhi Leonard', team: 'LAC', position: 'Forward', fg: 50, three: 40, ppg: 24, style: 'Efficient from mid-range and the wing, with few wasted shots.' },
  { id: 201935, name: 'James Harden', team: 'LAC', position: 'Guard', fg: 43, three: 36, ppg: 22, style: 'Step-back threes and free throws: the original "Moreyball" shot diet.' },
]

export const headshotUrl = (id: number) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`
export const logoUrl = (teamId: number) => `https://cdn.nba.com/logos/nba/${teamId}/global/L/logo.svg`

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
