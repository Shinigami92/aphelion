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
 *
 * The drawing helpers, orbit sampling and zoom gestures are in minimap/.
 */

import type { SimBody, SolarSystem } from '../core/system.ts';
import type { Plotted } from './minimap/draw.ts';
import { AU_KM } from '../core/constants.ts';
import { drawLagrange, drawOrbit, formatShort, gridStepAu, moonGridStep } from './minimap/draw.ts';
import { OrbitSampler } from './minimap/orbit-sampler.ts';
import { MinimapZoom } from './minimap/zoom.ts';

/** Where and how big the plan is drawn this frame. */
interface PlanView {
  width: number;
  height: number;
  /** Canvas centre, CSS pixels. */
  cx: number;
  cy: number;
  /** CSS pixels per km. */
  scale: number;
  heliocentric: boolean;
}

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private footer: HTMLElement;
  private titleContext: HTMLElement;
  private plotted: Plotted[] = [];
  private orbits: OrbitSampler;
  private zoom: MinimapZoom;

  /** Half-width of the view in km. */
  private span = AU_KM * 32;

  head!: HTMLElement;
  body!: HTMLElement;

  constructor(
    host: HTMLElement,
    private system: SolarSystem,
    private onSelect: (body: SimBody) => void,
  ) {
    this.orbits = new OrbitSampler(system);
    const title = document.createElement('div');
    title.className = 'panel__title';
    const label = document.createElement('span');
    label.textContent = 'Orrery';
    this.titleContext = document.createElement('span');
    this.titleContext.style.color = 'var(--text-faint)';
    this.titleContext.style.fontFamily = 'var(--mono)';
    title.append(label, this.titleContext);
    host.append(title);
    this.head = title;

    const body = document.createElement('div');
    body.className = 'panel__body';
    host.append(body);
    this.body = body;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap__canvas';
    body.append(this.canvas);

    this.footer = document.createElement('div');
    this.footer.className = 'minimap__foot';
    body.append(this.footer);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas unavailable for the mini-map');
    }
    this.ctx = ctx;

    this.canvas.addEventListener('click', (ev) => {
      this.pickAt(ev);
    });

    this.zoom = new MinimapZoom(this.canvas);
  }

  /** Called each frame; cheap enough at this size. */
  update(focus: SimBody, selected: SimBody | null, showLagrange = false): void {
    const size = this.prepareCanvas();
    if (!size) {
      return;
    }
    const { width, height } = size;
    const ctx = this.ctx;

    // Which system are we plotting?
    const host = this.contextHost(focus);
    const heliocentric = host === this.system.sun;
    const bodies = this.bodiesFor(host);

    this.fitSpan(bodies, heliocentric);

    const view: PlanView = {
      width,
      height,
      cx: width / 2,
      cy: height / 2,
      scale: Math.min(width, height) / 2 / this.span,
      heliocentric,
    };

    this.titleContext.textContent = heliocentric ? 'heliocentric' : host.name;
    this.plotted = [];

    this.drawGrid(view);
    this.drawCentre(host, view);

    // Orbits, then bodies on top.
    for (const body of bodies) {
      drawOrbit(ctx, this.orbits, body, view.cx, view.cy, view.scale, body === selected);
    }

    // Lagrange points, under the bodies so a marker never hides a planet. This
    // is the view the configuration was drawn in for two centuries — flat, from
    // the north, with the 60 degrees plainly 60 degrees — so it is worth more
    // here than the same five markers are in perspective.
    if (showLagrange && heliocentric) {
      drawLagrange(ctx, this.system, focus, selected, view.cx, view.cy, view.scale, this.plotted);
    }
    this.drawBodies(bodies, focus, selected, view);

    const spanLabel = heliocentric
      ? `${(this.span / AU_KM).toFixed(this.span / AU_KM < 10 ? 2 : 1)} AU radius`
      : `${formatShort(this.span)} km radius`;
    this.footer.textContent = `${spanLabel} · looking down the ecliptic`;
  }

  /** Match a click on the map to the nearest plotted body. */
  private pickAt(ev: MouseEvent): void {
    if (this.zoom.endsPinch()) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    let best: Plotted | null = null;
    let bestDistance = 16;
    for (const p of this.plotted) {
      const d = Math.hypot(p.screenX - x, p.screenY - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = p;
      }
    }
    if (best) {
      this.onSelect(best.body);
    }
  }

  /** Size the backing store to the element and clear it; null while the map has no size. */
  private prepareCanvas(): { width: number; height: number } | null {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return null;
    }
    if (this.canvas.width !== width * dpr || this.canvas.height !== height * dpr) {
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(3, 5, 9, 0.85)';
    ctx.fillRect(0, 0, width, height);
    return { width, height };
  }

  /** Fit the view to the widest orbit in the set. */
  private fitSpan(bodies: SimBody[], heliocentric: boolean): void {
    let maxRadius = 1;
    for (const body of bodies) {
      const r = heliocentric
        ? Math.hypot(body.helioKm.x, body.helioKm.y)
        : Math.hypot(body.localKm.x, body.localKm.y);
      const apo = body.elements ? body.elements.a * (1 + body.elements.e) : r;
      maxRadius = Math.max(maxRadius, Math.max(r, apo));
    }
    this.span = maxRadius * 1.12 * this.zoom.bias;
  }

  /** Reference circles: 1 AU steps, or parent-radius steps for a moon system. */
  private drawGrid(view: PlanView): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(150, 180, 220, 0.07)';
    ctx.lineWidth = 1;
    const gridStep = view.heliocentric ? AU_KM * gridStepAu(this.span) : moonGridStep(this.span);
    for (let r = gridStep; r <= this.span; r += gridStep) {
      ctx.beginPath();
      ctx.arc(view.cx, view.cy, r * view.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** The central body: the Sun, or the planet whose moons are shown. */
  private drawCentre(centre: SimBody, view: PlanView): void {
    const ctx = this.ctx;
    ctx.fillStyle = view.heliocentric
      ? '#ffd68a'
      : `#${centre.color.toString(16).padStart(6, '0')}`;
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, view.heliocentric ? 3.5 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    this.plotted.push({ body: centre, x: 0, y: 0, screenX: view.cx, screenY: view.cy, radius: 4 });
  }

  private drawBodies(
    bodies: SimBody[],
    focus: SimBody,
    selected: SimBody | null,
    view: PlanView,
  ): void {
    const ctx = this.ctx;
    for (const body of bodies) {
      const px = view.heliocentric ? body.helioKm.x : body.localKm.x;
      const py = view.heliocentric ? body.helioKm.y : body.localKm.y;
      const sx = view.cx + px * view.scale;
      const sy = view.cy - py * view.scale;
      if (sx < -8 || sy < -8 || sx > view.width + 8 || sy > view.height + 8) {
        continue;
      }

      const isFocus = body === focus;
      const isSelected = body === selected;
      const r = isFocus ? 4 : isSelected ? 3.5 : body.type === 'moon' ? 2 : 2.6;

      ctx.fillStyle = `#${body.color.toString(16).padStart(6, '0')}`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();

      if (isFocus || isSelected) {
        ctx.strokeStyle = isFocus ? '#6fb3ff' : 'rgba(220, 228, 240, 0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      this.plotted.push({ body, x: px, y: py, screenX: sx, screenY: sy, radius: r });
    }
  }

  /** The body whose system should be shown. */
  private contextHost(focus: SimBody): SimBody {
    if (focus.type === 'moon') {
      return focus.parent ?? this.system.sun;
    }
    // A planet with moons shows its own system once you are close enough to it;
    // otherwise the whole solar system is more useful.
    return this.system.sun;
  }

  private bodiesFor(host: SimBody): SimBody[] {
    if (host === this.system.sun) {
      return this.system.sun.children.filter((b) => b.type === 'planet' || b.type === 'dwarf');
    }
    // A moon system: cap the count so an outer irregular swarm stays readable.
    return host.children
      .filter((c) => c.type === 'moon')
      .toSorted((a, b) => b.radiusKm - a.radiusKm)
      .slice(0, 24);
  }
}
