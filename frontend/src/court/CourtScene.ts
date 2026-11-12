import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { buildArena } from './arena'
import { CINEMATIC, SESSION, STILL, frameAt, makePlan, shotStartMs } from './film'
import type { FilmFrame, FilmPlan, Phase } from './film'
import { FilmStage } from './filmStage'
import { flightPoint, planFlight } from './flight'
import type { FlightPlan } from './flight'
import { BACKBOARD_Y, COURT_L, COURT_W, HOOP_Y, RIM_HEIGHT, toWorld } from './geometry'
import type { HeatGrid, HexBins, HexCell } from './stats'
import { drawCourt, drawCourtLines, heatColor, paintHeat } from './textures'

export type MapMode = 'heat' | 'beams' | 'arcs'

export interface ScenePoint {
  x: number // court feet
  y: number
  made: boolean
  three: boolean
}
export interface SceneLabel {
  x: number
  y: number
  title: string // the zone name
  value: string // the big number, e.g. "64%"
  sub: string // e.g. "27/42"
}
export interface SceneData {
  points: ScenePoint[]
  labels: SceneLabel[]
  heat: HeatGrid | null
  hexes: HexBins | null
}
/** What the film is doing, for the on-screen graphics. */
export interface FilmState {
  /** True while a film is running (the camera is not the user's). */
  active: boolean
  /** The film's current shot, 0-based, and how many shots it has. */
  k: number
  total: number
  phase: Phase
  /** The current shot's index in the scene's points, or null. */
  index: number | null
  paused: boolean
  /** True once, when a film has played to its end. */
  finished: boolean
}

export interface SceneOptions {
  reducedMotion: boolean
  /** The film started, moved to another shot or phase, was paused, stopped or finished. */
  onFilm: (state: FilmState) => void
  /** Index into the current points, or null; x and y are pixels inside the container. */
  onHover: (index: number | null, x: number, y: number) => void
  /** A shot was clicked, or null when the click hit empty space. */
  onPick: (index: number | null) => void
  /** The hex under the pointer in heat mode (null when none); x and y as for onHover. */
  onHoverCell: (cell: HexCell | null, x: number, y: number) => void
  onFail: () => void
}

const MADE_2 = '#ff7a2f'
const MADE_3 = '#ffb27a'
const MISSED = '#8ec1ff'
// The selected shot's marker: a colour no shot uses (orange = made, blue = missed).
const SELECTED = '#ffffff'
const FLIGHT_MS = 900
const SETTLE_MS = 520
const ARC_SEGMENTS = 36
const PICK_RADIUS_PX = 16
const MISS_STUB = 1.3 // height of the short beam over a missed shot
const MARKER_PIN_Y = 19 // resting height of the selected-shot pin
const MARKER_COLUMN_END = MARKER_PIN_Y - 1.5 // the column stops just under the pin

// The camera stands on the half-court side and looks toward the basket (+Z).
/** Where the camera starts and returns to: behind the shooter, looking at the hoop. */
const HOME: { pos: [number, number, number]; target: [number, number, number] } = { pos: [0, 34, -66], target: [0, 0, -15] }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOutBack = (t: number) => {
  const c1 = 1.5
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class CourtScene {
  private container: HTMLElement
  private opts: SceneOptions
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private dummy = new THREE.Object3D()
  private color = new THREE.Color()

  private heatCanvas = document.createElement('canvas')
  private heatTexture: THREE.CanvasTexture
  private heatPlane: THREE.Mesh
  private labelRenderer = new CSS2DRenderer()
  private labels: CSS2DObject[] = []
  private marker = new THREE.Group()
  private arena: THREE.Group | null = null
  private filmStage: FilmStage | null = null
  /** The film that is playing; the clock only moves while it is not paused. */
  private film: { plan: FilmPlan; clock: number; paused: boolean; lastNow: number; last: { k: number; phase: Phase } } | null = null
  /** What the last film was, so "watch again" can play it once more. */
  private lastFilm: { indices: number[]; mode: 'shot' | 'session' } | null = null
  // The parts of the marker that tick animates; set in buildMarker.
  private markerRing: THREE.Mesh | null = null
  private markerOuter: THREE.Mesh | null = null
  private markerPin: THREE.Mesh | null = null

  // Shared geometry and materials, made once.
  private beamGeo: THREE.CylinderGeometry
  private orbGeo = new THREE.SphereGeometry(0.5, 16, 10)
  private ballGeo = new THREE.SphereGeometry(0.34, 8, 6)
  private xGeo = new THREE.BoxGeometry(2.3, 0.12, 0.42)
  private beamMat = new THREE.MeshBasicMaterial({
    color: '#8c8c8c', // dims the additive beams so overlapping ones do not blow out to white
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  private solidMat = new THREE.MeshBasicMaterial()
  private ballMat = new THREE.MeshBasicMaterial()
  private arcMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  private hexGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1)
  private hexMat = new THREE.MeshLambertMaterial()
  private hexMesh: THREE.InstancedMesh | null = null
  private hexCells: HexCell[] = []
  private hexRadius = 2
  private hexStart = 0
  private hexGrowing = false
  private hoverCell: HexCell | null = null
  private beams: THREE.InstancedMesh | null = null
  private orbs: THREE.InstancedMesh | null = null
  private xa: THREE.InstancedMesh | null = null
  private xb: THREE.InstancedMesh | null = null
  private balls: THREE.InstancedMesh | null = null
  private arcs: THREE.LineSegments | null = null

  private pts: ScenePoint[] = []
  /** One flight plan per shot, made when the data changes (not on every frame). */
  private plans: FlightPlan[] = []
  /** 1 for a normal log, smaller as thousands of shots crowd the court. */
  private density = 1
  private mode: MapMode = 'beams'
  private playing = false
  private playStart = 0
  private stagger = 0
  private dirty = true
  private shadows: THREE.InstancedMesh | null = null
  private shadowGeo = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2)
  private shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.55, depthWrite: false })
  private selected: number | null = null
  private tween: {
    t0: number
    dur: number
    fromPos: THREE.Vector3
    toPos: THREE.Vector3
    fromTarget: THREE.Vector3
    toTarget: THREE.Vector3
  } | null = null

  private raf = 0
  private visible = true
  /** True while something covers the whole page (the title screen): no frames are drawn. */
  private suspended = false
  private disposed = false
  private hoverIndex: number | null = null
  private pendingMove: PointerEvent | null = null
  private down: { x: number; y: number; t: number } | null = null
  private resizeObserver: ResizeObserver
  private intersection: IntersectionObserver

  constructor(container: HTMLElement, opts: SceneOptions) {
    this.container = container
    this.opts = opts
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer = renderer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    const canvas = renderer.domElement
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none'
    canvas.tabIndex = 0
    container.appendChild(canvas)

    try {
      this.scene.background = new THREE.Color('#0b0f14')
      this.scene.fog = new THREE.FogExp2('#0b0f14', 0.0085)
      this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400)
      this.camera.position.set(...HOME.pos)

      this.controls = new OrbitControls(this.camera, canvas)
      this.controls.enableDamping = true
      this.controls.dampingFactor = 0.08
      this.controls.minDistance = 10
      this.controls.maxDistance = 95
      this.controls.maxPolarAngle = Math.PI / 2 - 0.035
      this.controls.target.set(...HOME.target)
      this.controls.listenToKeyEvents(canvas)

      this.composer = new EffectComposer(renderer)
      this.composer.addPass(new RenderPass(this.scene, this.camera))
      // Strength, radius, threshold. A high threshold means only the brightest spots bloom, so the shots keep their shape.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.3, 0.7)
      this.composer.addPass(this.bloom)
      this.composer.addPass(new OutputPass())

      this.beamGeo = this.makeBeamGeometry()
      this.hexGeo.translate(0, 0.5, 0)
      // Only the hex cells are lit; everything else is unlit and glows on its own.
      this.scene.add(new THREE.AmbientLight('#ffffff', 0.85), new THREE.DirectionalLight('#ffffff', 1.15).translateX(-12).translateY(34).translateZ(18))
      this.buildStatic()

      this.heatCanvas.width = 100
      this.heatCanvas.height = 94
      this.heatTexture = new THREE.CanvasTexture(this.heatCanvas)
      this.heatTexture.colorSpace = THREE.SRGBColorSpace
      this.heatTexture.generateMipmaps = false
      this.heatTexture.minFilter = THREE.LinearFilter
      this.heatTexture.magFilter = THREE.LinearFilter
      this.heatPlane = new THREE.Mesh(
        this.flatPlane(),
        new THREE.MeshBasicMaterial({ map: this.heatTexture, transparent: true, depthWrite: false, opacity: 0.22 }),
      )
      this.heatPlane.position.y = 0.04
      this.scene.add(this.heatPlane)
      // Zone labels are real HTML (crisp, selectable, untouched by the glow effect).
      const labelDom = this.labelRenderer.domElement
      // isolation: the library gives every label a huge z-index; keep it inside this layer so the
      // tooltip (a normal z-index) always draws above the labels.
      labelDom.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1;isolation:isolate'
      container.appendChild(labelDom)
      this.buildMarker()

      canvas.addEventListener('pointermove', this.onPointerMove)
      canvas.addEventListener('pointerdown', this.onPointerDown)
      canvas.addEventListener('pointerup', this.onPointerUp)
      canvas.addEventListener('pointerleave', this.onPointerLeave)
      canvas.addEventListener('webglcontextlost', this.onContextLost)

      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(container)
      this.intersection = new IntersectionObserver((entries) => {
        this.visible = entries.some((e) => e.isIntersecting)
      })
      this.intersection.observe(container)
      this.resize()
      this.raf = requestAnimationFrame(this.tick)
    } catch (error) {
      // A constructor that throws leaves no object to dispose(), so release what exists.
      // Some of these were never created, hence the loose type.
      const made = this as unknown as {
        resizeObserver?: ResizeObserver
        intersection?: IntersectionObserver
        controls?: OrbitControls
      }
      cancelAnimationFrame(this.raf)
      made.resizeObserver?.disconnect()
      made.intersection?.disconnect()
      made.controls?.dispose()
      this.labelRenderer.domElement.remove()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      throw error
    }
  }

  // ---------- public API ----------

  setData(data: SceneData, intro: boolean): void {
    if (this.film) this.stopFilm() // the shots under the film are changing
    this.pts = data.points
    this.plans = data.points.map((p, i) => planFlight(p, i))
    // Crowded courts get dimmer beams, smaller markers and less glow, or they wash out to white.
    this.density = Math.min(1, Math.sqrt(250 / Math.max(1, data.points.length)))
    this.beamMat.color.setScalar(0.16 + 0.26 * this.density)
    this.bloom.strength = 0.08 + 0.12 * this.density
    this.rebuildMarkers()
    this.rebuildArcs()
    paintHeat(this.heatCanvas, data.heat)
    this.heatTexture.needsUpdate = true
    this.rebuildLabels(data.labels)
    this.rebuildHexes(data.hexes)
    this.applyMode()
    if (intro && !this.opts.reducedMotion && data.points.length > 0) this.replay(2400, 2, 90)
    else this.playing = false
    this.dirty = true
  }

  setMode(mode: MapMode): void {
    this.mode = mode
    if (this.hoverCell) {
      this.hoverCell = null
      this.opts.onHoverCell(null, 0, 0)
    }
    if (this.hoverIndex !== null) {
      this.hoverIndex = null
      this.opts.onHover(null, 0, 0)
    }
    this.applyMode()
    this.dirty = true
  }

  /** Fly every ball from the shooter to the rim, in order, then let the markers settle. */
  replay(totalMs = 7000, minStagger = 14, maxStagger = 420): void {
    if (this.pts.length === 0) return
    this.stagger = Math.min(maxStagger, Math.max(minStagger, totalMs / this.pts.length))
    this.playStart = performance.now()
    this.playing = true
    this.dirty = true
  }

  setSelected(index: number | null): void {
    this.selected = index !== null && index >= 0 && index < this.pts.length ? index : null
    if (this.selected !== null) {
      this.updateMarker()
    }
    this.applyDim()
  }

  /**
   * Dim every shot while one is selected (so the marker is what the eye lands on) or a film plays
   * (so the film's ball is). The marker itself is hidden during a film.
   */
  private applyDim(): void {
    const dim = this.selected !== null || this.film !== null
    this.marker.visible = this.selected !== null && this.film === null
    for (const m of [this.solidMat, this.ballMat, this.arcMat, this.beamMat]) {
      m.transparent = dim || m === this.arcMat || m === this.beamMat
      m.opacity = dim ? 0.3 : 1
      m.needsUpdate = true
    }
    this.dirty = true
  }

  // ---------- the shot film ----------

  /** Play a film of these shots (indices into the points): one shot in full, or a quicker session. */
  startFilm(indices: number[], mode: 'shot' | 'session' = 'shot'): void {
    if (this.disposed || !this.filmStage) return
    const valid = indices.filter((i) => i >= 0 && i < this.pts.length)
    if (valid.length === 0) return
    const timings = this.opts.reducedMotion ? STILL : mode === 'session' ? SESSION : CINEMATIC
    // A film that is already running keeps its original start, so the camera still returns to the user's view.
    const startPose = this.film
      ? this.film.plan.startPose
      : { pos: this.camera.position.toArray() as [number, number, number], target: this.controls.target.toArray() as [number, number, number] }
    this.tween = null
    this.playing = false
    this.hoverIndex = null
    this.opts.onHover(null, 0, 0)
    this.filmStage.reset()
    const plan = makePlan(this.pts, valid, timings, startPose)
    this.lastFilm = { indices: valid, mode }
    this.film = { plan, clock: 0, paused: false, lastNow: performance.now(), last: { k: -1, phase: 'lead' } }
    this.controls.enabled = false
    this.applyDim()
    this.emitFilm(frameAt(plan, 0), false)
  }

  /** Play the last film again from its first shot. */
  restartFilm(): void {
    if (this.lastFilm) this.startFilm(this.lastFilm.indices, this.lastFilm.mode)
  }

  pauseFilm(paused: boolean): void {
    if (!this.film) return
    this.film.paused = paused
    this.film.lastNow = performance.now()
    this.emitFilm(frameAt(this.film.plan, this.film.clock), false)
  }

  /** Jump to the next (+1) or previous (-1) shot; the previous one restarts the current shot first. */
  stepFilm(delta: 1 | -1): void {
    const f = this.film
    if (!f || !this.filmStage) return
    const frame = frameAt(f.plan, f.clock)
    const total = f.plan.shots.length
    let k = frame.k + delta
    if (delta < 0 && frame.phaseT > 0 && frame.phase !== 'lead') k = frame.k // restart this shot
    f.clock = shotStartMs(f.plan, Math.max(0, Math.min(total, k)))
    this.filmStage.reset()
    f.last = { k: -1, phase: 'lead' }
  }

  /** Stop now: the camera glides back to where the user had it. */
  stopFilm(): void {
    const f = this.film
    if (!f) return
    const frame = frameAt(f.plan, f.clock)
    this.finishFilm(false)
    if (this.opts.reducedMotion) {
      this.camera.position.set(...f.plan.startPose.pos)
      this.controls.target.set(...f.plan.startPose.target)
      this.controls.update()
      return
    }
    this.tween = {
      t0: performance.now(),
      dur: 700,
      fromPos: this.camera.position.clone(),
      toPos: new THREE.Vector3(...f.plan.startPose.pos),
      fromTarget: new THREE.Vector3(...frame.camera.target),
      toTarget: new THREE.Vector3(...f.plan.startPose.target),
    }
  }

  private finishFilm(finished: boolean): void {
    const f = this.film
    if (!f) return
    this.film = null
    this.filmStage?.reset()
    this.controls.enabled = true
    if (finished) {
      this.camera.position.set(...f.plan.startPose.pos)
      this.controls.target.set(...f.plan.startPose.target)
      this.controls.update()
    }
    this.applyDim()
    const total = f.plan.shots.length
    this.opts.onFilm({ active: false, k: Math.max(0, total - 1), total, phase: 'done', index: null, paused: false, finished })
  }

  private emitFilm(frame: FilmFrame, finished: boolean): void {
    const f = this.film
    if (!f) return
    this.opts.onFilm({
      active: true,
      k: frame.k,
      total: f.plan.shots.length,
      phase: frame.phase,
      index: f.plan.shots[frame.k]?.index ?? null,
      paused: f.paused,
      finished,
    })
  }

  /** One frame of the film: move the camera and the ball, and set off the effects when a phase begins. */
  private updateFilm(now: number): void {
    const f = this.film
    if (!f || !this.filmStage) return
    // Capped, so a tab that was in the background does not make the film jump ahead.
    const dt = Math.min(100, now - f.lastNow)
    f.lastNow = now
    if (!f.paused) f.clock += dt
    const frame = frameAt(f.plan, f.clock)
    const shake = this.filmStage.update(f.paused ? 0 : dt)
    const [px, py, pz] = frame.camera.pos
    const [tx, ty, tz] = frame.camera.target
    this.camera.position.set(px + shake[0], py + shake[1], pz + shake[2])
    this.controls.target.set(tx, ty, tz)
    this.camera.lookAt(tx, ty, tz)
    this.filmStage.setBall(frame.ball)

    if (frame.k !== f.last.k || frame.phase !== f.last.phase) {
      const fs = f.plan.shots[frame.k]
      if (fs && frame.phase === 'drop') this.filmStage.impact(fs.shot.made ? 'make' : 'miss', fs.flight.hit)
      if (fs && frame.phase === 'hold') this.filmStage.reaction(fs.shot.made ? 'make' : 'miss')
      f.last = { k: frame.k, phase: frame.phase }
      if (frame.phase === 'done') this.finishFilm(true)
      else this.emitFilm(frame, false)
    }
    this.dirty = true
  }

  /** Place the marker and the lit copy of the selected shot (the mode decides how tall the shot is). */
  private updateMarker(): void {
    const p = this.selected === null ? undefined : this.pts[this.selected]
    if (!p) return // nothing selected, or the data changed under the selection
    const [wx, wz] = toWorld(p.x, p.y)
    this.marker.position.set(wx, 0, wz)
    const beams = this.mode === 'beams'
    const top = beams && p.made ? (p.three ? 6 : 3.4) + 0.45 : p.made ? 0.5 : 0.1
    const ball = this.marker.getObjectByName('heroBall')
    const xa = this.marker.getObjectByName('heroXa')
    const xb = this.marker.getObjectByName('heroXb')
    if (ball) {
      ball.visible = p.made
      ball.position.set(0, top, 0)
      ball.scale.setScalar(1.7)
    }
    for (const x of [xa, xb]) {
      if (!x) continue
      x.visible = !p.made
      x.position.set(0, 0.16, 0)
      x.scale.setScalar(1.55)
    }
    // The column starts just above the lit shot and runs up to the pin.
    const start = top + 1.6
    const end = MARKER_COLUMN_END
    const column = this.marker.getObjectByName('column')
    if (column) {
      column.visible = end - start > 1
      column.scale.y = Math.max(end - start, 0.01)
      column.position.y = start + (end - start) / 2
    }
  }

  /** Pixel position of a shot inside the container (for tests and focus helpers). */
  screenPositionOf(index: number): { x: number; y: number } | null {
    if (!this.pts[index]) return null
    const v = this.anchor(index, new THREE.Vector3()).project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.intersection.disconnect()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointerleave', this.onPointerLeave)
    canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.controls.dispose()
    for (const label of this.labels) label.element.remove()
    this.labelRenderer.domElement.remove()
    this.scene.traverse((obj) => {
      const o = obj as THREE.Mesh
      if (o.geometry) o.geometry.dispose()
      const m = o.material as THREE.Material | THREE.Material[] | undefined
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        // The court's lines are a second texture, only reachable through emissiveMap.
        const { map, emissiveMap } = mat as THREE.MeshStandardMaterial
        if (map) map.dispose()
        if (emissiveMap) emissiveMap.dispose()
        mat.dispose()
      }
      if ((obj as THREE.InstancedMesh).isInstancedMesh) (obj as THREE.InstancedMesh).dispose()
    })
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    canvas.remove()
  }

  // ---------- building the world ----------

  private flatPlane(): THREE.PlaneGeometry {
    const g = new THREE.PlaneGeometry(COURT_W, COURT_L)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, -COURT_L / 2)
    return g
  }

  private makeBeamGeometry(): THREE.CylinderGeometry {
    const g = new THREE.CylinderGeometry(0.2, 0.2, 1, 10, 1, true)
    g.translate(0, 0.5, 0)
    const pos = g.getAttribute('position')
    const colors = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const shade = 0.04 + 0.96 * pos.getY(i) // dark at the floor, bright at the top
      colors.set([shade, shade, shade], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }

  private buildStatic(): void {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy()
    const courtTex = new THREE.CanvasTexture(drawCourt())
    courtTex.colorSpace = THREE.SRGBColorSpace
    courtTex.anisotropy = maxAniso
    // The lines are also added as a glow of their own: the lit floor would dim them.
    const linesTex = new THREE.CanvasTexture(drawCourtLines())
    linesTex.colorSpace = THREE.SRGBColorSpace
    linesTex.anisotropy = maxAniso
    const court = new THREE.Mesh(
      this.flatPlane(),
      new THREE.MeshStandardMaterial({
        map: courtTex,
        color: '#ffe9d6', // multiplies the texture: keeps the lit floor as dark as the smoked oak was drawn
        roughness: 0.8,
        metalness: 0,
        emissive: '#ffffff',
        emissiveMap: linesTex,
        emissiveIntensity: 0.85,
      }),
    )
    this.scene.add(court)

    // A slab under the court so it has thickness, and a glowing edge.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(COURT_W + 1.2, 0.5, COURT_L + 1.2),
      new THREE.MeshBasicMaterial({ color: '#0a1017' }),
    )
    slab.position.set(0, -0.26, -COURT_L / 2)
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(slab.geometry),
      new THREE.LineBasicMaterial({ color: '#ff7a2f', transparent: true, opacity: 0.55 }),
    )
    edge.position.copy(slab.position)
    this.scene.add(slab, edge)

    // Ground and a faint grid that fades into the fog: gives depth when you orbit.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#080c11' }),
    )
    ground.position.y = -0.55
    const grid = new THREE.GridHelper(400, 80, 0x1b2a3b, 0x121c28)
    grid.position.y = -0.5
    this.scene.add(ground, grid)

    // The arena around the court: stands, crowd and ribbon board. See-through, drawn behind the shots.
    this.arena = buildArena()
    this.scene.add(this.arena)

    // The hoop: glass, rim and net.
    // No pole or arm: a stanchion between the camera and the rim would hide the key.
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(6, 3.5, 0.12),
      new THREE.MeshBasicMaterial({ color: '#9fc5ff', transparent: true, opacity: 0.1, depthWrite: false }),
    )
    glass.position.set(0, 10.9, -BACKBOARD_Y)
    const glassEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(glass.geometry),
      new THREE.LineBasicMaterial({ color: '#cfe3ff', transparent: true, opacity: 0.6 }),
    )
    glassEdge.position.copy(glass.position)
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.06, 8, 40).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ff7a2f' }),
    )
    rim.position.set(0, RIM_HEIGHT, -HOOP_Y)
    const net = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.42, 1.3, 14, 3, true),
      new THREE.MeshBasicMaterial({ color: '#dfe9f7', wireframe: true, transparent: true, opacity: 0.35 }),
    )
    net.position.set(0, RIM_HEIGHT - 0.68, -HOOP_Y)
    this.scene.add(glass, glassEdge, rim, net)
    const crowd = (this.arena?.getObjectByName('crowd') as THREE.InstancedMesh | undefined)?.material as THREE.Material | undefined
    this.filmStage = new FilmStage(this.scene, net, crowd ?? null, this.opts.reducedMotion)
  }

  /**
   * The marker for the selected shot. It has to be easy to find among hundreds of shots, so it is
   * big and a colour nothing else on the court uses (SELECTED), and the other shots are dimmed
   * while it is shown (see setSelected). The ring, outer ring and pin are kept as fields because tick animates them.
   */
  private buildMarker(): void {
    const accent = SELECTED
    const mat = (opacity: number, additive = false) =>
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
    const flat = (geo: THREE.BufferGeometry, material: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), material)
      m.position.y = y
      m.renderOrder = 5
      return m
    }
    const ring = flat(new THREE.RingGeometry(2.3, 2.9, 56), mat(1), 0.1)
    const outer = flat(new THREE.RingGeometry(3.6, 3.9, 56), mat(0.7), 0.1)
    // Unit-height column; updateMarker stretches it so it starts above the shot, not through it.
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1, 12, 1, true), mat(0.5, true))
    column.name = 'column'
    column.renderOrder = 5
    // A pin above the shot pointing down at it; it bobs in tick.
    const pin = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 4).rotateX(Math.PI), mat(1))
    pin.name = 'pin'
    pin.position.y = MARKER_PIN_Y
    pin.renderOrder = 6
    // The chosen shot itself, drawn bigger and in a light colour, so it is what stands out and
    // nothing of the marker covers it. A ball for a made shot, a cross for a miss.
    const lit = (hex: string) => new THREE.MeshBasicMaterial({ color: hex })
    const heroBall = new THREE.Mesh(this.orbGeo, lit('#ffe3cc'))
    heroBall.name = 'heroBall'
    const heroXa = new THREE.Mesh(this.xGeo, lit('#e6f2ff'))
    heroXa.name = 'heroXa'
    heroXa.rotation.y = Math.PI / 4
    const heroXb = new THREE.Mesh(this.xGeo, lit('#e6f2ff'))
    heroXb.name = 'heroXb'
    heroXb.rotation.y = -Math.PI / 4
    for (const m of [heroBall, heroXa, heroXb]) m.renderOrder = 4
    this.markerRing = ring
    this.markerOuter = outer
    this.markerPin = pin
    this.marker.add(ring, outer, column, pin, heroBall, heroXa, heroXb)
    this.marker.visible = false
    this.scene.add(this.marker)
  }

  private clearInstanced(): void {
    for (const m of [this.beams, this.orbs, this.xa, this.xb, this.balls, this.shadows]) {
      if (m) {
        this.scene.remove(m)
        m.dispose()
      }
    }
    this.beams = this.orbs = this.xa = this.xb = this.balls = this.shadows = null
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n))
    mesh.count = n
    mesh.frustumCulled = false
    this.scene.add(mesh)
    return mesh
  }

  private rebuildMarkers(): void {
    this.clearInstanced()
    const n = this.pts.length
    this.beams = this.instanced(this.beamGeo, this.beamMat, n)
    this.orbs = this.instanced(this.orbGeo, this.solidMat, n)
    this.xa = this.instanced(this.xGeo, this.solidMat, n)
    this.xb = this.instanced(this.xGeo, this.solidMat, n)
    this.balls = this.instanced(this.ballGeo, this.ballMat, n)
    // A dark pool under every shot, so a made (orange) or missed (blue) marker never melts into the wood.
    this.shadows = this.instanced(this.shadowGeo, this.shadowMat, n)
    // Drawn first among the transparent layers, so the heat plane (y 0.04) and everything above the floor blends over it.
    // The shadow sits 0.03 above the floor. Only that gap to the opaque floor is depth tested (shadow and heat plane both skip depth writes,
    // so draw order, not their 0.01 gap, decides how they blend). The orbit controls stop at 95, where the depth buffer resolves about 0.001.
    this.shadows.renderOrder = -1
    for (let i = 0; i < n; i++) {
      const p = this.pts[i]
      this.color.set(p.made ? (p.three ? MADE_3 : MADE_2) : MISSED)
      this.beams.setColorAt(i, this.color)
      this.orbs.setColorAt(i, this.color)
      this.xa.setColorAt(i, this.color)
      this.xb.setColorAt(i, this.color)
      this.color.lerp(new THREE.Color('#ffffff'), 0.3) // balls glow a touch whiter than their marker
      this.balls.setColorAt(i, this.color)
    }
    for (const m of [this.beams, this.orbs, this.xa, this.xb, this.balls]) {
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }

  /** Point on a shot's whole flight, u from 0 (release) to 1 (through the net, or off the iron to the floor). */
  private arcPoint(i: number, u: number, out: THREE.Vector3): THREE.Vector3 {
    const [x, y, z] = flightPoint(this.pts[i], i, u, this.plans[i])
    return out.set(x, y, z)
  }

  private rebuildArcs(): void {
    if (this.arcs) {
      this.scene.remove(this.arcs)
      this.arcs.geometry.dispose()
      this.arcs = null
    }
    const n = this.pts.length
    if (n === 0) return
    const positions = new Float32Array(n * ARC_SEGMENTS * 2 * 3)
    const colors = new Float32Array(n * ARC_SEGMENTS * 2 * 3)
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    let o = 0
    for (let i = 0; i < n; i++) {
      const p = this.pts[i]
      this.color.set(p.made ? (p.three ? MADE_3 : MADE_2) : MISSED)
      for (let s = 0; s < ARC_SEGMENTS; s++) {
        const u0 = s / ARC_SEGMENTS
        const u1 = (s + 1) / ARC_SEGMENTS
        this.arcPoint(i, u0, a)
        this.arcPoint(i, u1, b)
        // Brighter toward the rim, so each arc reads as travelling somewhere.
        const f0 = 0.06 + 0.4 * u0
        const f1 = 0.06 + 0.4 * u1
        positions.set([a.x, a.y, a.z, b.x, b.y, b.z], o)
        colors.set(
          [this.color.r * f0, this.color.g * f0, this.color.b * f0, this.color.r * f1, this.color.g * f1, this.color.b * f1],
          o,
        )
        o += 6
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    this.arcs = new THREE.LineSegments(geo, this.arcMat)
    this.arcs.frustumCulled = false
    this.scene.add(this.arcs)
  }

  private rebuildLabels(labels: SceneLabel[]): void {
    for (const label of this.labels) {
      this.scene.remove(label)
      label.element.remove()
    }
    this.labels = []
    for (const l of this.spreadLabels(labels)) {
      const el = document.createElement('div')
      el.className = 'zone-label'
      const name = document.createElement('span')
      name.className = 'zl-name'
      name.textContent = l.title
      const value = document.createElement('strong')
      value.textContent = l.value
      const sub = document.createElement('span')
      sub.className = 'zl-sub'
      sub.textContent = l.sub
      el.append(name, value, sub)
      const object = new CSS2DObject(el)
      const [wx, wz] = toWorld(l.x, l.y)
      object.position.set(wx, 1.6, wz)
      this.scene.add(object)
      this.labels.push(object)
    }
  }

  /** Nudge labels apart (in court feet) so neighbouring zones do not print over each other. */
  private spreadLabels(labels: SceneLabel[]): SceneLabel[] {
    const out = labels.map((l) => ({ ...l }))
    const halfW = 3.4
    const halfH = 1.9
    for (let pass = 0; pass < 40; pass++) {
      let moved = false
      for (let a = 0; a < out.length; a++) {
        for (let b = a + 1; b < out.length; b++) {
          const dx = out[b].x - out[a].x
          const dy = out[b].y - out[a].y
          if (Math.abs(dx) < 2 * halfW && Math.abs(dy) < 2 * halfH) {
            // Push apart along whichever axis has the smaller overlap, away from each other.
            if (2 * halfW - Math.abs(dx) < 2 * halfH - Math.abs(dy)) {
              const push = (2 * halfW - Math.abs(dx)) / 2 + 0.05
              const sign = dx >= 0 ? 1 : -1
              out[a].x -= sign * push
              out[b].x += sign * push
            } else {
              const push = (2 * halfH - Math.abs(dy)) / 2 + 0.05
              const sign = dy >= 0 ? 1 : -1
              out[a].y -= sign * push
              out[b].y += sign * push
            }
            moved = true
          }
        }
      }
      if (!moved) break
    }
    return out
  }

  private rebuildHexes(bins: HexBins | null): void {
    if (this.hexMesh) {
      this.scene.remove(this.hexMesh)
      this.hexMesh.dispose()
      this.hexMesh = null
    }
    this.hexCells = bins?.cells ?? []
    this.hexRadius = bins?.radius ?? 2
    if (this.hexCells.length === 0) return
    const mesh = new THREE.InstancedMesh(this.hexGeo, this.hexMat, this.hexCells.length)
    mesh.frustumCulled = false
    this.hexCells.forEach((cell, i) => {
      const [r, g, b] = heatColor(cell.heat)
      mesh.setColorAt(i, this.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace))
    })
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.hexMesh = mesh
    this.scene.add(mesh)
    this.hexStart = performance.now()
    this.hexGrowing = true
  }

  /** Hexes rise one after another (nearest the first shot first); settled, this is a no-op. */
  private layoutHexes(now: number): void {
    const mesh = this.hexMesh
    if (!mesh) return
    const t = now - this.hexStart
    const d = this.dummy
    let growing = false
    this.hexCells.forEach((cell, i) => {
      const delay = this.opts.reducedMotion ? -1000 : Math.min(800, i * 16)
      const u = clamp01((t - delay) / 520)
      if (u < 1) growing = true
      const g = Math.max(easeOutBack(u), 0.0001)
      const radius = this.hexRadius * (0.5 + 0.46 * Math.sqrt(cell.size))
      const height = 0.14 + 1.7 * Math.sqrt(cell.size)
      const [wx, wz] = toWorld(cell.x, cell.y)
      d.rotation.set(0, 0, 0)
      d.position.set(wx, 0.03, wz)
      d.scale.set(radius * Math.min(g, 1), height * g, radius * Math.min(g, 1))
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.boundingSphere = null
    mesh.boundingBox = null
    this.hexGrowing = growing
  }

  /** The hex under the pointer: nearest centre on screen, inside the hex's drawn radius. */
  private pickCell(clientX: number, clientY: number): HexCell | null {
    if (this.hexCells.length === 0) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const a = new THREE.Vector3()
    const edge = new THREE.Vector3()
    let best: HexCell | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const cell of this.hexCells) {
      const [wx, wz] = toWorld(cell.x, cell.y)
      a.set(wx, 0.5, wz).project(this.camera)
      if (a.z > 1) continue
      edge.set(wx + this.hexRadius * 0.9, 0.5, wz).project(this.camera)
      const sx = ((a.x + 1) / 2) * rect.width
      const sy = ((1 - a.y) / 2) * rect.height
      const reach = Math.max(14, Math.abs(((edge.x - a.x) / 2) * rect.width))
      const dist = Math.hypot(sx - px, sy - py)
      if (dist < reach && dist < bestD) {
        bestD = dist
        best = cell
      }
    }
    return best
  }

  private applyMode(): void {
    const m = this.mode
    // Heat mode is the hex chart; the soft glow under the court is for the other two.
    this.heatPlane.visible = m !== 'heat'
    ;(this.heatPlane.material as THREE.MeshBasicMaterial).opacity = m === 'beams' ? 0.22 : 0.2
    if (this.hexMesh) this.hexMesh.visible = m === 'heat'
    this.hexStart = performance.now()
    this.hexGrowing = m === 'heat'
    this.updateMarker()
    for (const label of this.labels) label.visible = m === 'heat'
    if (this.arcs) this.arcs.visible = m === 'arcs'
    this.dirty = true
  }

  // ---------- per-frame work ----------

  private layout(now: number): void {
    const n = this.pts.length
    if (!this.beams || !this.orbs || !this.xa || !this.xb || !this.balls || !this.shadows) return
    const d = this.dummy
    const t = now - this.playStart
    const tail = n > 0 ? (n - 1) * this.stagger + FLIGHT_MS + SETTLE_MS : 0
    if (this.playing && t > tail) this.playing = false
    const beamsOn = this.mode === 'beams'
    const heatOn = this.mode === 'heat'
    // In heat mode the hexes carry the data; the individual dots would only clutter them.
    const dot = heatOn ? 0 : (beamsOn ? 1 : 0.5) * (0.55 + 0.45 * this.density)
    const tmp = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const p = this.pts[i]
      const [wx, wz] = toWorld(p.x, p.y)
      const local = this.playing ? t - i * this.stagger : Number.POSITIVE_INFINITY
      const settle = this.playing ? easeOutBack(clamp01((local - FLIGHT_MS) / SETTLE_MS)) : 1
      const shown = this.playing ? (local >= FLIGHT_MS ? Math.max(0.001, settle) : 0) : 1
      const height = p.three ? 6 : 3.4

      // beam
      d.rotation.set(0, 0, 0)
      d.position.set(wx, 0, wz)
      d.scale.set(1, beamsOn ? (p.made ? height : MISS_STUB) * shown : 0.0001, 1)
      d.updateMatrix()
      this.beams.setMatrixAt(i, d.matrix)
      // orb (made only)
      d.position.set(wx, beamsOn ? height * shown + 0.45 : 0.5 * shown, wz)
      const orbScale = p.made ? dot * shown : 0.0001
      d.scale.setScalar(Math.max(orbScale, 0.0001))
      d.updateMatrix()
      this.orbs.setMatrixAt(i, d.matrix)
      // X marks (missed only), two crossed bars lying on the floor
      // Misses stay large: a cross that is too small to see is a missing data point.
      const xs = p.made || heatOn ? 0.0001 : Math.max((beamsOn ? 1 : 0.85) * (0.7 + 0.3 * this.density) * shown, 0.0001)
      d.position.set(wx, 0.1, wz)
      d.scale.setScalar(xs)
      d.rotation.set(0, Math.PI / 4, 0)
      d.updateMatrix()
      this.xa.setMatrixAt(i, d.matrix)
      d.rotation.set(0, -Math.PI / 4, 0)
      d.updateMatrix()
      this.xb.setMatrixAt(i, d.matrix)
      // contact shadow under the marker (not in heat mode, where the hexes carry the data)
      d.rotation.set(0, 0, 0)
      d.position.set(wx, 0.03, wz)
      d.scale.setScalar(heatOn ? 0.0001 : Math.max((p.made ? 1.15 : 1.35) * (0.6 + 0.4 * this.density) * shown, 0.0001))
      d.updateMatrix()
      this.shadows.setMatrixAt(i, d.matrix)
      // ball in flight: during a replay, or looping along every arc in flight-path mode
      let ballScale = 0.0001
      if (this.playing && local > 0 && local < FLIGHT_MS) {
        this.arcPoint(i, local / FLIGHT_MS, tmp)
        ballScale = 1
      } else if (!this.playing && this.mode === 'arcs' && !this.opts.reducedMotion) {
        const u = (now / 2600 + i * 0.173) % 1
        this.arcPoint(i, u, tmp)
        ballScale = 0.55
      }
      d.rotation.set(0, 0, 0)
      d.position.copy(tmp)
      d.scale.setScalar(ballScale)
      d.updateMatrix()
      this.balls.setMatrixAt(i, d.matrix)
    }
    for (const m of [this.beams, this.orbs, this.xa, this.xb, this.balls, this.shadows]) {
      m.instanceMatrix.needsUpdate = true
      // Picking uses these bounds; they must follow the instances.
      m.boundingSphere = null
      m.boundingBox = null
    }
  }

  /**
   * The court's entrance, for when the title screen opens onto it: the camera swings in from high up
   * at the side while every shot flies in, one after another. Nothing moves with reduced motion.
   */
  playEntrance(): void {
    if (this.opts.reducedMotion || this.film) return
    const to = HOME
    const from = { pos: new THREE.Vector3(-72, 58, -82), target: new THREE.Vector3(0, 0, -22) }
    this.camera.position.copy(from.pos)
    this.controls.target.copy(from.target)
    this.tween = {
      t0: performance.now(),
      dur: 3000,
      fromPos: from.pos,
      toPos: new THREE.Vector3(...to.pos),
      fromTarget: from.target,
      toTarget: new THREE.Vector3(...to.target),
    }
    this.replay(3800, 3, 140)
    this.dirty = true
  }

  /** Stop or resume drawing, for when the page is covered. */
  setSuspended(on: boolean): void {
    this.suspended = on
    this.dirty = true
  }

  private tick = (now: number): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    if (!this.visible || this.suspended) return
    if (this.tween) {
      const u = clamp01((now - this.tween.t0) / this.tween.dur)
      const e = easeInOut(u)
      this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, e)
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, e)
      if (u >= 1) this.tween = null
    }
    // The film moves the camera itself. OrbitControls must not run then: it would pull the low
    // shooter's-eye camera up to its own height limit.
    if (this.film) this.updateFilm(now)
    else this.controls.update()
    if (this.hexGrowing && this.mode === 'heat') this.layoutHexes(now)
    if (this.dirty || this.playing || (this.mode === 'arcs' && !this.opts.reducedMotion)) {
      this.layout(now)
      this.dirty = false
    }
    if (this.marker.visible && !this.opts.reducedMotion) {
      const pulse = 1 + 0.22 * Math.sin(now / 260)
      this.markerRing?.scale.set(pulse, 1, pulse)
      const outerPulse = 1 + 0.08 * Math.sin(now / 260 + 1.5)
      this.markerOuter?.scale.set(outerPulse, 1, outerPulse)
      if (this.markerPin) this.markerPin.position.y = MARKER_PIN_Y + 0.7 * Math.sin(now / 320)
    }
    this.runPendingHover()
    this.composer.render()
    this.labelRenderer.render(this.scene, this.camera)
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.labelRenderer.setSize(w, h)
    this.bloom.resolution.set(w, h)
    this.camera.aspect = w / h
    // A narrow container needs a wider field of view or the court is cut off.
    this.camera.fov = w / h < 1 ? 60 : w / h < 1.4 ? 50 : 42
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  // ---------- pointer handling ----------

  /** The shot whose marker is nearest the pointer on screen, within a finger-sized
   *  radius. Projecting is cheaper and far easier to hit than ray-casting tiny orbs. */
  private pick(clientX: number, clientY: number): number | null {
    const n = this.pts.length
    if (n === 0) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const v = new THREE.Vector3()
    let best: number | null = null
    let bestD = PICK_RADIUS_PX
    for (let i = 0; i < n; i++) {
      if (this.playing && performance.now() - this.playStart < i * this.stagger + FLIGHT_MS) continue
      this.anchor(i, v).project(this.camera)
      if (v.z > 1) continue // behind the camera
      const d = Math.hypot(((v.x + 1) / 2) * rect.width - px, ((1 - v.y) / 2) * rect.height - py)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  /** Where a shot's marker sits in the world (the top of its beam in beam mode). */
  private anchor(i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.pts[i]
    const [wx, wz] = toWorld(p.x, p.y)
    const height = this.mode === 'beams' && p.made ? (p.three ? 6 : 3.4) + 0.45 : 0.5
    return out.set(wx, height, wz)
  }

  private runPendingHover(): void {
    const e = this.pendingMove
    if (!e) return
    this.pendingMove = null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (this.mode === 'heat') {
      const cell = this.pickCell(e.clientX, e.clientY)
      this.renderer.domElement.style.cursor = cell ? 'help' : 'grab'
      if (cell || this.hoverCell) this.opts.onHoverCell(cell, x, y)
      this.hoverCell = cell
      return
    }
    const index = this.pick(e.clientX, e.clientY)
    this.renderer.domElement.style.cursor = index === null ? 'grab' : 'pointer'
    if (index !== this.hoverIndex || index !== null) {
      this.hoverIndex = index
      this.opts.onHover(index, x, y)
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.film) return // the film is playing: nothing to hover
    if (e.buttons !== 0) return // dragging to orbit, not hovering
    this.pendingMove = e
  }

  private onPointerLeave = (): void => {
    this.pendingMove = null
    if (this.hoverCell) {
      this.hoverCell = null
      this.opts.onHoverCell(null, 0, 0)
    }
    if (this.hoverIndex !== null) {
      this.hoverIndex = null
      this.opts.onHover(null, 0, 0)
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.film) return
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() }
    if (this.hoverIndex !== null) {
      this.hoverIndex = null
      this.opts.onHover(null, 0, 0)
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (this.film) return
    const d = this.down
    this.down = null
    if (!d) return
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y)
    if (moved > 5 || performance.now() - d.t > 500) return // that was a drag
    if (this.mode === 'heat') return // hexes are groups of shots, not shots
    const index = this.pick(e.clientX, e.clientY)
    this.opts.onPick(index)
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault()
    this.opts.onFail()
  }
}
