// Court geometry in feet, used only to DRAW the lines and place things in 3D. The
// backend decides each shot's zone and 2PT/3PT: these numbers just have to match its
// court (backend/app/court.py) so the painted lines sit where the rules say they do.

export const COURT_W = 50 // x runs across, 0-50
export const COURT_L = 47 // y runs from the baseline (0) out to half court (47)
export const HOOP_X = 25
export const HOOP_Y = 5.25
export const RIM_HEIGHT = 10
export const ARC_RADIUS = 23.75
export const CORNER_DISTANCE = 22
export const CORNER_LENGTH = HOOP_Y + Math.sqrt(ARC_RADIUS ** 2 - CORNER_DISTANCE ** 2)
export const LANE_HALF_WIDTH = 8
export const FREE_THROW_Y = 19
export const RESTRICTED_RADIUS = 4
export const BACKBOARD_Y = 4

/** Court (x, y) in feet to world [X, Z]. The camera sits behind the baseline looking
 *  toward half court, so +x is to the viewer's right and half court is far away. */
export function toWorld(x: number, y: number): [number, number] {
  return [x - HOOP_X, -y]
}
