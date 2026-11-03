import {
  ARC_RADIUS,
  COURT_L,
  COURT_W,
  CORNER_DISTANCE,
  CORNER_LENGTH,
  FREE_THROW_Y,
  HOOP_X,
  HOOP_Y,
  LANE_HALF_WIDTH,
  RESTRICTED_RADIUS,
} from './geometry'
import type { HeatGrid } from './stats'

const PX = 24 // texture pixels per foot

/** The court surface: dark floor with the regulation lines. Canvas top is half court,
 *  canvas bottom is the baseline, so it reads like the top-down drawing in the README. */
export function drawCourt(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = COURT_W * PX
  canvas.height = COURT_L * PX
  const g = canvas.getContext('2d')!
  // y in court feet to canvas pixels (flip so the baseline is at the bottom).
  const X = (x: number) => x * PX
  const Y = (y: number) => (COURT_L - y) * PX

  const floor = g.createLinearGradient(0, 0, 0, canvas.height)
  floor.addColorStop(0, '#0e1620')
  floor.addColorStop(1, '#131d2a')
  g.fillStyle = floor
  g.fillRect(0, 0, canvas.width, canvas.height)

  // Faint floorboards, so the surface has scale and the eye can read perspective.
  g.strokeStyle = 'rgba(120,150,190,0.05)'
  g.lineWidth = 1
  for (let x = 0; x <= COURT_W; x += 1.5) {
    g.beginPath()
    g.moveTo(X(x), 0)
    g.lineTo(X(x), canvas.height)
    g.stroke()
  }

  // The lane (key) is lightly painted.
  g.fillStyle = 'rgba(255,122,47,0.09)'
  g.fillRect(X(HOOP_X - LANE_HALF_WIDTH), Y(FREE_THROW_Y), X(LANE_HALF_WIDTH * 2), Y(0) - Y(FREE_THROW_Y))

  const line = (width: number, alpha: number) => {
    g.strokeStyle = `rgba(255,170,115,${alpha})`
    g.lineWidth = width * PX
    g.lineCap = 'round'
  }
  const arc = (cx: number, cy: number, r: number, from: number, to: number, clockwise = false) => {
    g.beginPath()
    // Canvas y points down while court y points up, so negate the angles.
    g.arc(X(cx), Y(cy), r * PX, -from, -to, !clockwise)
    g.stroke()
  }

  line(0.2, 0.95)
  // Boundary and lane.
  g.strokeRect(X(0), Y(COURT_L), X(COURT_W), Y(0) - Y(COURT_L))
  g.strokeRect(X(HOOP_X - LANE_HALF_WIDTH), Y(FREE_THROW_Y), X(LANE_HALF_WIDTH * 2), Y(0) - Y(FREE_THROW_Y))

  // Three-point line: straight corners, then the arc between them.
  const cornerAngle = Math.atan2(CORNER_LENGTH - HOOP_Y, CORNER_DISTANCE)
  g.beginPath()
  g.moveTo(X(HOOP_X - CORNER_DISTANCE), Y(0))
  g.lineTo(X(HOOP_X - CORNER_DISTANCE), Y(CORNER_LENGTH))
  g.stroke()
  g.beginPath()
  g.moveTo(X(HOOP_X + CORNER_DISTANCE), Y(0))
  g.lineTo(X(HOOP_X + CORNER_DISTANCE), Y(CORNER_LENGTH))
  g.stroke()
  arc(HOOP_X, HOOP_Y, ARC_RADIUS, Math.PI - cornerAngle, cornerAngle, true)

  // Free-throw circle: solid above the line, dashed below it. Restricted area arc.
  arc(HOOP_X, FREE_THROW_Y, 6, 0, Math.PI, false)
  g.setLineDash([0.6 * PX, 0.6 * PX])
  line(0.16, 0.7)
  arc(HOOP_X, FREE_THROW_Y, 6, Math.PI, 2 * Math.PI, false)
  g.setLineDash([])
  line(0.2, 0.95)
  arc(HOOP_X, HOOP_Y, RESTRICTED_RADIUS, 0, Math.PI, false)

  // Center circle at half court, and the rim marker.
  arc(HOOP_X, COURT_L, 6, Math.PI, 2 * Math.PI, false)
  line(0.14, 0.9)
  g.beginPath()
  g.arc(X(HOOP_X), Y(HOOP_Y), 0.75 * PX, 0, 2 * Math.PI)
  g.stroke()
  return canvas
}

const COLD = [59, 130, 246] // blue
const MID = [58, 66, 92] // dim slate: "average" should look quiet, not alarming
const HOT_LOW = [255, 122, 47] // orange
const HOT_HIGH = [255, 214, 140] // warm white at the very top

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)

/** Map heat (0 cold .. 1 hot) to a colour. Blue and orange differ in lightness as well
 *  as hue, so the ramp still reads for people who cannot tell red from green. */
export function heatColor(heat: number): [number, number, number] {
  const h = Math.min(1, Math.max(0, heat))
  const c =
    h < 0.5
      ? mix(COLD, MID, h / 0.5)
      : h < 0.8
        ? mix(MID, HOT_LOW, (h - 0.5) / 0.3)
        : mix(HOT_LOW, HOT_HIGH, (h - 0.8) / 0.2)
  return [c[0], c[1], c[2]]
}

/** Paint a HeatGrid into a canvas (one pixel per grid cell; the GPU smooths it). */
export function paintHeat(canvas: HTMLCanvasElement, grid: HeatGrid | null): void {
  const g = canvas.getContext('2d')!
  if (!grid) {
    g.clearRect(0, 0, canvas.width, canvas.height)
    return
  }
  const image = g.createImageData(grid.cols, grid.rows)
  for (let r = 0; r < grid.rows; r++) {
    // Grid row 0 is the baseline; canvas row 0 is half court, so flip.
    const row = grid.rows - 1 - r
    for (let c = 0; c < grid.cols; c++) {
      const i = r * grid.cols + c
      const [R, G, B] = heatColor(grid.hot[i])
      const o = (row * grid.cols + c) * 4
      image.data[o] = R
      image.data[o + 1] = G
      image.data[o + 2] = B
      image.data[o + 3] = Math.round(grid.confidence[i] * 185)
    }
  }
  g.putImageData(image, 0, 0)
}
