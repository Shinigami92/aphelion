/**
 * Orrery mini-map.
 *
 * A schematic top-down plan of whichever system you are currently in, looking
 * down the ecliptic north pole. Orbits are sampled from the same elements the 3D
 * view uses — so the shapes, inclinations-in-projection and phases are real, not
 * decorative circles — and every body is clickable.
 *
 * The view switches context automatically: looking at a moon shows you its
 * planet's system; looking at a planet shows the whole solar system with that
 * planet highlighted.
 */

import { AU_KM } from '../core/constants.ts'
import type { SimBody, SolarSystem } from '../core/system.ts'
import { applyBasis, type Basis } from '../astro/frames.ts'
import { sampleOrbit, type Vec3 } from '../astro/kepler.ts'

interface Plotted {
  body: SimBody
  x: number
  y: number
  screenX: number
  screenY: number
  radius: number
}

const ORBIT_SAMPLES = 128

export class Minimap {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private footer: HTMLElement
  private plotted: Plotted[] = []
  private orbitCache = new Map<string, { points: Float64Array; jd: number }>()
  private scratch: Vec3 = { x: 0, y: 0, z: 0 }

  /** Half-width of the view in km. */
  private span = AU_KM * 32

  head!: HTMLElement
  body!: HTMLElement

  constructor(
    private host: HTMLElement,
    private system: SolarSystem,
    private onSelect: (body: SimBody) => void,
  ) {
    const title = document.createElement('div')
    title.className = 'panel__title'
    const label = document.createElement('span')
    label.textContent = 'Orrery'
    this.titleContext = document.createElement('span')
    this.titleContext.style.color = 'var(--text-faint)'
    this.titleContext.style.fontFamily = 'var(--mono)'
    title.append(label, this.titleContext)
    host.append(title)
    this.head = title

    const body = document.createElement('div')
    body.className = 'panel__body'
    host.append(body)
    this.body = body

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'minimap__canvas'
    body.append(this.canvas)

    this.footer = document.createElement('div')
    this.footer.className = 'minimap__foot'
    body.append(this.footer)

    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable for the mini-map')
    this.ctx = ctx

    this.canvas.addEventListener('click', (ev) => {
      // A pinch ends with a click from the last finger lifted; without this the
      // gesture would also select whatever happened to be under it.
      if (performance.now() - this.pinchedAt < 400) return
      const rect = this.canvas.getBoundingClientRect()
      const x = ev.clientX - rect.left
      const y = ev.clientY - rect.top
      let best: Plotted | null = null
      let bestDistance = 16
      for (const p of this.plotted) {
        const d = Math.hypot(p.screenX - x, p.screenY - y)
        if (d < bestDistance) {
          bestDistance = d
          best = p
        }
      }
      if (best) this.onSelect(best.body)
    })

    this.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault()
      this.setZoomBias(this.zoomBias * Math.exp(ev.deltaY * 0.0012))
    })

    // Pinch to zoom the map. Without this the map had no touch zoom at all, and
    // — worse — no `touch-action`, so a pinch fell through to the browser and
    // zoomed the entire page. iOS has ignored `user-scalable=no` since iOS 10,
    // so declaring the gesture ours in CSS is the only way to keep it.
    this.canvas.addEventListener('pointerdown', (ev) => {
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      if (this.pointers.size === 2) this.pinchDistance = this.pinchSpan()
    })

    this.canvas.addEventListener('pointermove', (ev) => {
      if (!this.pointers.has(ev.pointerId)) return
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      if (this.pointers.size !== 2) return
      const d = this.pinchSpan()
      if (this.pinchDistance > 0 && d > 0) {
        this.setZoomBias(this.zoomBias * (this.pinchDistance / d))
        this.pinchedAt = performance.now()
      }
      this.pinchDistance = d
    })

    const release = (ev: PointerEvent): void => {
      this.pointers.delete(ev.pointerId)
      if (this.pointers.size < 2) this.pinchDistance = 0
    }
    this.canvas.addEventListener('pointerup', release)
    this.canvas.addEventListener('pointercancel', release)
  }

  private setZoomBias(value: number): void {
    this.zoomBias = Math.max(0.05, Math.min(8, value))
  }

  private pinchSpan(): number {
    const pts = [...this.pointers.values()]
    if (pts.length < 2) return 0
    return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
  }

  private titleContext: HTMLElement
  private zoomBias = 1

  private pointers = new Map<number, { x: number; y: number }>()
  private pinchDistance = 0
  /** When a pinch last moved, so the click it ends with can be ignored. */
  private pinchedAt = 0

  /** Called each frame; cheap enough at this size. */
  update(focus: SimBody, selected: SimBody | null): void {
    const dpr = Math.min(window.devicePixelRatio, 2)
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width === 0 || height === 0) return
    if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
      this.canvas.width = width * dpr
      this.canvas.height = height * dpr
    }

    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(3, 5, 9, 0.85)'
    ctx.fillRect(0, 0, width, height)

    // Which system are we plotting?
    const host = this.contextHost(focus)
    const heliocentric = host === this.system.sun
    const bodies = this.bodiesFor(host)

    // Fit the view to the widest orbit in the set.
    let maxRadius = 1
    for (const body of bodies) {
      const r = heliocentric
        ? Math.hypot(body.helioKm.x, body.helioKm.y)
        : Math.hypot(body.localKm.x, body.localKm.y)
      const apo = body.elements ? body.elements.a * (1 + body.elements.e) : r
      maxRadius = Math.max(maxRadius, Math.max(r, apo))
    }
    this.span = maxRadius * 1.12 * this.zoomBias

    const cx = width / 2
    const cy = height / 2
    const scale = Math.min(width, height) / 2 / this.span

    this.titleContext.textContent = heliocentric ? 'heliocentric' : host.name
    this.plotted = []

    // Reference circles: 1 AU steps, or parent-radius steps for a moon system.
    ctx.strokeStyle = 'rgba(150, 180, 220, 0.07)'
    ctx.lineWidth = 1
    const gridStep = heliocentric ? AU_KM * this.gridStepAu() : this.moonGridStep(host)
    for (let r = gridStep; r <= this.span; r += gridStep) {
      ctx.beginPath()
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Central body.
    const centre = host
    ctx.fillStyle = heliocentric ? '#ffd68a' : `#${centre.color.toString(16).padStart(6, '0')}`
    ctx.beginPath()
    ctx.arc(cx, cy, heliocentric ? 3.5 : 4.5, 0, Math.PI * 2)
    ctx.fill()
    this.plotted.push({ body: centre, x: 0, y: 0, screenX: cx, screenY: cy, radius: 4 })

    // Orbits, then bodies on top.
    for (const body of bodies) {
      this.drawOrbit(ctx, body, cx, cy, scale, heliocentric, body === selected)
    }
    for (const body of bodies) {
      const px = heliocentric ? body.helioKm.x : body.localKm.x
      const py = heliocentric ? body.helioKm.y : body.localKm.y
      const sx = cx + px * scale
      const sy = cy - py * scale
      if (sx < -8 || sy < -8 || sx > width + 8 || sy > height + 8) continue

      const isFocus = body === focus
      const isSelected = body === selected
      const r = isFocus ? 4 : isSelected ? 3.5 : body.type === 'moon' ? 2 : 2.6

      ctx.fillStyle = `#${body.color.toString(16).padStart(6, '0')}`
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fill()

      if (isFocus || isSelected) {
        ctx.strokeStyle = isFocus ? '#6fb3ff' : 'rgba(220, 228, 240, 0.7)'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(sx, sy, r + 3.5, 0, Math.PI * 2)
        ctx.stroke()
      }
      this.plotted.push({ body, x: px, y: py, screenX: sx, screenY: sy, radius: r })
    }

    const spanLabel = heliocentric
      ? `${(this.span / AU_KM).toFixed(this.span / AU_KM < 10 ? 2 : 1)} AU radius`
      : `${formatShort(this.span)} km radius`
    this.footer.textContent = `${spanLabel} · looking down the ecliptic`
  }

  /** The body whose system should be shown. */
  private contextHost(focus: SimBody): SimBody {
    if (focus.type === 'moon') return focus.parent ?? this.system.sun
    // A planet with moons shows its own system once you are close enough to it;
    // otherwise the whole solar system is more useful.
    return this.system.sun
  }

  private bodiesFor(host: SimBody): SimBody[] {
    if (host === this.system.sun) {
      return this.system.sun.children.filter((b) => b.type === 'planet' || b.type === 'dwarf')
    }
    // A moon system: cap the count so an outer irregular swarm stays readable.
    return host.children
      .filter((c) => c.type === 'moon')
      .sort((a, b) => b.radiusKm - a.radiusKm)
      .slice(0, 24)
  }

  private gridStepAu(): number {
    const au = this.span / AU_KM
    if (au > 60) return 20
    if (au > 20) return 10
    if (au > 6) return 5
    if (au > 2) return 1
    return 0.5
  }

  private moonGridStep(host: SimBody): number {
    const step = Math.pow(10, Math.floor(Math.log10(this.span / 3)))
    void host
    return step
  }

  private drawOrbit(
    ctx: CanvasRenderingContext2D,
    body: SimBody,
    cx: number,
    cy: number,
    scale: number,
    heliocentric: boolean,
    highlight: boolean,
  ): void {
    if (!body.elements) return
    const points = this.orbitPoints(body)
    if (!points) return

    ctx.strokeStyle = highlight
      ? 'rgba(111, 179, 255, 0.55)'
      : `rgba(150, 180, 220, ${body.type === 'moon' ? 0.16 : 0.2})`
    ctx.lineWidth = highlight ? 1.4 : 1
    ctx.beginPath()
    for (let i = 0; i < ORBIT_SAMPLES; i++) {
      const x = points[i * 3]!
      const y = points[i * 3 + 1]!
      const sx = cx + x * scale
      const sy = cy - y * scale
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }
    ctx.closePath()
    ctx.stroke()
    void heliocentric
  }

  /**
   * Orbit sample points in the parent's frame, cached until the elements
   * meaningfully precess (a day of simulated time is plenty of slack here).
   */
  private orbitPoints(body: SimBody): Float64Array | null {
    if (!body.elements) return null
    const cached = this.orbitCache.get(body.key)
    if (cached && Math.abs(cached.jd - this.system.jdTT) < 1) return cached.points

    const raw = sampleOrbit(body.elements, ORBIT_SAMPLES, this.system.jdTT)
    const out = new Float64Array(ORBIT_SAMPLES * 3)
    const basis: Basis = body.basis
    for (let i = 0; i < ORBIT_SAMPLES; i++) {
      applyBasis(basis, raw[i * 3]!, raw[i * 3 + 1]!, raw[i * 3 + 2]!, this.scratch)
      out[i * 3] = this.scratch.x
      out[i * 3 + 1] = this.scratch.y
      out[i * 3 + 2] = this.scratch.z
    }
    this.orbitCache.set(body.key, { points: out, jd: this.system.jdTT })
    return out
  }

  show(): void {
    this.host.style.display = 'block'
  }

  hide(): void {
    this.host.style.display = 'none'
  }

  get visible(): boolean {
    return this.host.style.display !== 'none'
  }
}

function formatShort(km: number): string {
  if (km > 1e6) return `${(km / 1e6).toFixed(2)} M`
  if (km > 1e3) return `${(km / 1e3).toFixed(0)} k`
  return km.toFixed(0)
}
