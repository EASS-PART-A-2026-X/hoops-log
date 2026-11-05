import * as THREE from 'three'
import { HOOP_Y, RIM_HEIGHT } from './geometry'
import type { Vec3 } from './flight'

const PARTICLES = 96
const TRAIL = 10
const BALL_RADIUS = 0.42
const RIM_POINT: Vec3 = [0, RIM_HEIGHT - 0.3, -HOOP_Y]

const MAKE_COLORS = ['#ff7a2f', '#ffb27a', '#ffffff', '#ff9a5c']
const MISS_COLORS = ['#8ec1ff', '#ffffff', '#5a8fd8', '#bcd8ff']

/**
 * What the film adds to the scene besides the camera: the ball with a short trail, a burst of
 * sparks (orange for a make, blue shards for a miss), the net rippling, a small camera shake on a
 * miss and the crowd reacting. It only reads time, so a paused film stands still.
 */
export class FilmStage {
  private ball: THREE.Mesh
  private trail: THREE.InstancedMesh
  private history: Vec3[] = []
  private points: THREE.Points
  private positions = new Float32Array(PARTICLES * 3)
  private colors = new Float32Array(PARTICLES * 3)
  private velocity = new Float32Array(PARTICLES * 3)
  private life = new Float32Array(PARTICLES) // seconds left
  private lifeMax = new Float32Array(PARTICLES)
  private tint: THREE.Color[] = []
  private gravity = -18
  private netT = -1 // seconds since a make, or -1
  private shakeT = -1 // seconds since a miss, or -1
  private crowdT = -1
  private crowdKind: 'make' | 'miss' = 'make'
  private crowdBase: number
  private netScale: THREE.Vector3
  private m = new THREE.Matrix4()

  private net: THREE.Object3D | null
  private crowd: THREE.Material | null
  private reduced: boolean

  constructor(scene: THREE.Scene, net: THREE.Object3D | null, crowd: THREE.Material | null, reduced: boolean) {
    this.net = net
    this.crowd = crowd
    this.reduced = reduced
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 20, 14), new THREE.MeshBasicMaterial({ color: '#ffd6b0' }))
    this.ball.visible = false
    this.ball.renderOrder = 4

    this.trail = new THREE.InstancedMesh(
      new THREE.SphereGeometry(BALL_RADIUS, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#ff9a5c', transparent: true, opacity: 0.35, depthWrite: false }),
      TRAIL,
    )
    this.trail.count = 0
    this.trail.frustumCulled = false
    this.trail.renderOrder = 3

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.55, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    this.points.frustumCulled = false
    this.points.visible = false
    this.points.renderOrder = 6
    for (let i = 0; i < PARTICLES; i++) this.tint.push(new THREE.Color())

    this.netScale = net ? net.scale.clone() : new THREE.Vector3(1, 1, 1)
    this.crowdBase = (crowd as THREE.MeshBasicMaterial | null)?.opacity ?? 0.3
    scene.add(this.ball, this.trail, this.points)
  }

  /** Put everything back as it was: no ball, no sparks, the net and crowd at rest. */
  reset(): void {
    this.ball.visible = false
    this.trail.count = 0
    this.history = []
    this.life.fill(0)
    this.points.visible = false
    this.netT = -1
    this.shakeT = -1
    this.crowdT = -1
    if (this.net) this.net.scale.copy(this.netScale)
    this.setCrowd(this.crowdBase)
  }

  setBall(pos: Vec3 | null): void {
    if (!pos) {
      this.ball.visible = false
      this.trail.count = 0
      this.history = []
      return
    }
    this.ball.visible = true
    this.ball.position.set(pos[0], pos[1], pos[2])
    const last = this.history[this.history.length - 1]
    if (!last || Math.hypot(last[0] - pos[0], last[1] - pos[1], last[2] - pos[2]) > 0.25) {
      this.history.push(pos)
      if (this.history.length > TRAIL) this.history.shift()
    }
    if (this.reduced) {
      this.trail.count = 0
      return
    }
    const n = this.history.length
    this.trail.count = n
    for (let i = 0; i < n; i++) {
      const p = this.history[i]!
      const s = 0.25 + 0.6 * ((i + 1) / n)
      this.m.makeScale(s, s, s).setPosition(p[0], p[1], p[2])
      this.trail.setMatrixAt(i, this.m)
    }
    this.trail.instanceMatrix.needsUpdate = true
  }

  /** The ball reaches the rim: sparks for a make, shards and a shake for a miss. */
  impact(kind: 'make' | 'miss', hit: [number, number]): void {
    if (this.reduced) return
    const origin: Vec3 = kind === 'make' ? RIM_POINT : [hit[0], RIM_HEIGHT, hit[1]]
    const palette = kind === 'make' ? MAKE_COLORS : MISS_COLORS
    this.gravity = kind === 'make' ? -16 : -24
    for (let i = 0; i < PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2
      const spread = kind === 'make' ? 0.55 : 1
      const speed = (kind === 'make' ? 6 : 5) + Math.random() * (kind === 'make' ? 9 : 7)
      this.positions[i * 3] = origin[0]
      this.positions[i * 3 + 1] = origin[1]
      this.positions[i * 3 + 2] = origin[2]
      this.velocity[i * 3] = Math.cos(a) * speed * spread
      this.velocity[i * 3 + 1] = kind === 'make' ? speed * (0.7 + Math.random() * 0.8) : speed * (Math.random() * 0.8)
      this.velocity[i * 3 + 2] = Math.sin(a) * speed * spread
      const life = (kind === 'make' ? 0.9 : 0.6) + Math.random() * 0.6
      this.life[i] = life
      this.lifeMax[i] = life
      this.tint[i]!.set(palette[i % palette.length]!)
    }
    this.points.visible = true
    if (kind === 'make') this.netT = 0
    else this.shakeT = 0
  }

  /** The result is shown: the crowd cheers a make and groans at a miss. */
  reaction(kind: 'make' | 'miss'): void {
    if (this.reduced) return
    this.crowdKind = kind
    this.crowdT = 0
  }

  private setCrowd(opacity: number): void {
    if (this.crowd) (this.crowd as THREE.MeshBasicMaterial).opacity = opacity
  }

  /** Advance the effects by `dtMs` and return the camera shake offset to add this frame. */
  update(dtMs: number): Vec3 {
    const dt = dtMs / 1000
    if (this.points.visible) {
      let alive = 0
      for (let i = 0; i < PARTICLES; i++) {
        if (this.life[i]! <= 0) {
          this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0
          continue
        }
        alive++
        this.life[i] = this.life[i]! - dt
        this.velocity[i * 3 + 1] = this.velocity[i * 3 + 1]! + this.gravity * dt
        this.positions[i * 3] = this.positions[i * 3]! + this.velocity[i * 3]! * dt
        this.positions[i * 3 + 1] = Math.max(0.05, this.positions[i * 3 + 1]! + this.velocity[i * 3 + 1]! * dt)
        this.positions[i * 3 + 2] = this.positions[i * 3 + 2]! + this.velocity[i * 3 + 2]! * dt
        const fade = Math.max(0, this.life[i]! / this.lifeMax[i]!)
        const c = this.tint[i]!
        this.colors[i * 3] = c.r * fade
        this.colors[i * 3 + 1] = c.g * fade
        this.colors[i * 3 + 2] = c.b * fade
      }
      const geo = this.points.geometry
      geo.attributes.position!.needsUpdate = true
      geo.attributes.color!.needsUpdate = true
      if (alive === 0) this.points.visible = false
    }
    if (this.netT >= 0 && this.net) {
      this.netT += dt
      const tn = this.netT / 0.9
      if (tn >= 1) {
        this.netT = -1
        this.net.scale.copy(this.netScale)
      } else {
        const r = Math.sin(Math.PI * Math.min(1, tn * 1.6)) * (1 - tn)
        this.net.scale.set(this.netScale.x * (1 + 0.32 * r), this.netScale.y * (1 - 0.12 * r), this.netScale.z * (1 + 0.32 * r))
      }
    }
    if (this.crowdT >= 0) {
      this.crowdT += dt
      const tc = this.crowdT / 1.2
      if (tc >= 1) {
        this.crowdT = -1
        this.setCrowd(this.crowdBase)
      } else {
        const swell = Math.sin(Math.PI * Math.min(1, tc * 1.4)) * (1 - tc * 0.5)
        this.setCrowd(this.crowdKind === 'make' ? this.crowdBase + 0.32 * swell : this.crowdBase - 0.12 * swell)
      }
    }
    let shake: Vec3 = [0, 0, 0]
    if (this.shakeT >= 0) {
      this.shakeT += dt
      const ts = this.shakeT / 0.28
      if (ts >= 1) this.shakeT = -1
      else {
        const amp = 0.16 * (1 - ts)
        shake = [(Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp]
      }
    }
    return shake
  }
}
