/** Facts about the selected body: live readouts, physical data, orbit, composition. */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import { escapeVelocity } from '../../core/system.ts';
import { RELIEF_EXAGGERATION } from '../../data/bodies.ts';
import { reliefFor } from '../../data/generated/relief.ts';
import { el } from './dom.ts';
import {
  fmt,
  formatDistance,
  formatDuration,
  formatHours,
  formatLightTime,
  formatMass,
} from './format.ts';

export class InfoPanel {
  private nameEl = el('h2', 'info__name');
  private subEl = el('div', 'info__sub');
  private badgeEl = el('div', 'badge');
  private blurbEl = el('p', 'info__blurb');
  private noteEl = el('div', 'info__note');
  private liveFacts = el('div', 'facts');
  private physFacts = el('div', 'facts');
  private orbitFacts = el('div', 'facts');
  private compositionEl = el('div', 'facts');
  private ringsEl = el('div', 'rings');

  private current: SimBody | null = null;

  head = el('div', 'info__head');
  body = el('div', 'panel__body');

  constructor(private host: HTMLElement) {
    // This panel has no title row of its own; the body's name and subtitle are
    // its heading, so they are what stays visible when it collapses. Reading
    // "Mimas — Saturn I" off a shut panel is more use than the word "Body".
    this.head.append(this.nameEl, this.subEl);
    this.host.append(this.head, this.body);
    this.body.append(
      this.badgeEl,
      this.noteEl,
      this.blurbEl,
      el('div', 'section', 'Right now'),
      this.liveFacts,
      el('div', 'section', 'Physical'),
      this.physFacts,
      el('div', 'section', 'Orbit'),
      this.orbitFacts,
      el('div', 'section', 'Composition'),
      this.compositionEl,
      this.ringsEl,
    );
  }

  /** Rebuild the static parts when the selection changes. */
  setBody(body: SimBody, system: SolarSystem): void {
    this.current = body;
    this.nameEl.textContent = body.name;
    this.subEl.textContent = body.subtitle;

    const flags: string[] = [];
    if (body.radiusEstimated) {
      flags.push('size estimated');
    }
    // "surface synthesised" is a statement about imagery we do not have. A
    // Lagrange point has no surface to have imagery of.
    if ((body.textureFile === null || body.textureFile === '') && body.type !== 'lagrange') {
      flags.push('surface synthesised');
    }
    if (body.type === 'lagrange') {
      flags.push('massless point — nothing is drawn here');
    }
    if (body.sat?.frame === 'laplace') {
      flags.push('Laplace-plane elements');
    }
    this.badgeEl.textContent = flags.join(' · ');
    this.badgeEl.style.display = flags.length > 0 ? 'inline-block' : 'none';

    const note = body.note ?? '';
    this.noteEl.textContent = note;
    this.noteEl.style.display = note ? 'block' : 'none';

    const blurb = body.spec?.facts.blurb ?? '';
    this.blurbEl.textContent = blurb;
    this.blurbEl.style.display = blurb ? 'block' : 'none';

    this.buildPhysical(body);
    this.buildOrbit(body, system);
    this.buildComposition(body);
  }

  private rowsInto(target: HTMLElement, rows: Array<[string, string, boolean?]>): void {
    target.textContent = '';
    for (const [key, value, wrap] of rows) {
      if (!value) {
        continue;
      }
      target.append(el('div', 'facts__key', key));
      target.append(el('div', `facts__val${wrap === true ? ' facts__val--wrap' : ''}`, value));
    }
  }

  /**
   * A Lagrange point's own facts.
   *
   * It shares no field with a body: it has no mass, no radius, no surface and
   * no orbit of its own, so the "Physical" and "Orbit" sections are filled from
   * the *pair* instead. The nominal radius the camera frames it by is
   * deliberately not shown — it is a viewing convention, and printing it as a
   * measurement is exactly the kind of convincing-but-wrong number this panel
   * exists to avoid.
   */
  private buildLagrange(body: SimBody): void {
    const info = body.lagrange!;
    const planet = info.secondary;

    this.rowsInto(this.physFacts, [
      ['Point', `${info.id} of ${info.primary.name}–${planet.name}`],
      ['Family', info.collinear ? 'collinear' : 'triangular (equilateral)'],
      [
        'Stability',
        info.collinear
          ? 'unstable — a spacecraft here must station-keep'
          : 'stable — material collects and stays',
        true,
      ],
      ['Mass ratio', `μ = ${info.massRatio.toExponential(3)}`],
      [`Hill radius of ${planet.name}`, formatDistance(info.hillKm)],
    ]);

    this.rowsInto(this.orbitFacts, [
      // Not "orbits": it is carried round by the pair, one turn for one turn of
      // the planet, which is the whole reason the configuration holds together.
      ['Co-orbits with', planet.name],
      ['Period', formatDuration(body.periodDays)],
      [
        'Geometry',
        info.collinear
          ? `on the ${info.primary.name}–${planet.name} line`
          : `60° ${info.id === 'L4' ? 'ahead of' : 'behind'} ${planet.name}, equidistant from both`,
        true,
      ],
      ['Solved for', 'the circular restricted three-body problem', true],
    ]);
  }

  private buildPhysical(body: SimBody): void {
    if (body.type === 'lagrange') {
      this.buildLagrange(body);
      return;
    }
    const rows: Array<[string, string, boolean?]> = [];
    const facts = body.spec?.facts;

    const radius = body.radiusKm;
    rows.push(['Mean radius', `${fmt(radius, radius < 100 ? 2 : 1)} km`]);
    if (body.flattening > 0.001) {
      rows.push(
        ['Polar radius', `${fmt(radius * (1 - body.flattening), 1)} km`],
        ['Flattening', `1 / ${fmt(1 / body.flattening, 1)}`],
      );
    }
    // Terrain that has been exaggerated has to say so. The surface is real
    // measured topography, but at explore scale its vertical scale is not, and
    // an unlabelled 12x mountain is precisely the kind of convincing-but-wrong
    // this project keeps having to guard against.
    const relief = reliefFor(body.key);
    if (relief) {
      const factor = RELIEF_EXAGGERATION[body.key] ?? 1;
      rows.push([
        'Relief',
        factor > 1
          ? `${relief.credit.split('—')[0].trim()}, ×${factor} in explore scale`
          : relief.credit.split('—')[0].trim(),
        true,
      ]);
    }
    if (facts) {
      rows.push(
        ['Mass', formatMass(facts.mass)],
        ['Surface gravity', `${facts.gravity.toFixed(2)} m/s²`],
        ['Escape velocity', `${facts.escapeVelocity.toFixed(2)} km/s`],
        ['Rotation', formatHours(facts.rotationHours)],
        ['Axial tilt', `${facts.axialTilt.toFixed(2)}°`],
        ['Mean temperature', `${fmt(facts.temperatureC, 0)} °C`],
        ['Albedo', facts.albedo.toFixed(3)],
      );
    } else if (body.sat) {
      if (body.sat.gm !== null && body.sat.gm > 0) {
        // Mass from GM, and gravity/escape velocity from GM and radius.
        const massKg = (body.sat.gm * 1e9) / 6.6743e-11;
        rows.push(
          ['Mass', formatMass(massKg)],
          ['Surface gravity', `${((body.sat.gm / (radius * radius)) * 1000).toFixed(3)} m/s²`],
          ['Escape velocity', `${escapeVelocity(body.sat.gm, radius).toFixed(3)} km/s`],
        );
      }
      if (body.sat.density !== null && body.sat.density !== 0) {
        rows.push(['Density', `${body.sat.density.toFixed(3)} g/cm³`]);
      }
      rows.push(['Rotation', 'tidally locked']);
    } else if (body.small) {
      rows.push(
        ['Absolute magnitude', `H = ${body.small.h.toFixed(2)}`],
        // Only say "from H" when it really is: a body with a measured radius
        // (SMALL_BODY_RADII) is no longer being sized by its brightness.
        [body.radiusEstimated ? 'Diameter (from H)' : 'Diameter', `${fmt(radius * 2, 0)} km`],
      );
    }
    this.rowsInto(this.physFacts, rows);
  }

  private buildOrbit(body: SimBody, system: SolarSystem): void {
    // Both sections of a Lagrange point are filled together, from the pair.
    if (body.type === 'lagrange') {
      return;
    }
    const rows: Array<[string, string, boolean?]> = [];
    const elements = body.elements;

    if (body.parent) {
      rows.push(['Orbits', body.parent.name]);
    }
    if (body.periodDays) {
      rows.push(['Orbital period', formatDuration(body.periodDays)]);
    }
    if (elements) {
      rows.push(
        ['Semi-major axis', formatDistance(elements.a)],
        ['Eccentricity', elements.e.toFixed(5)],
        ['Inclination', `${((elements.i * 180) / Math.PI).toFixed(3)}°`],
        ['Periapsis', formatDistance(elements.a * (1 - elements.e))],
        ['Apoapsis', formatDistance(elements.a * (1 + elements.e))],
      );
      if (body.sat?.frame) {
        rows.push([
          'Reference plane',
          body.sat.frame === 'laplace'
            ? 'local Laplace plane'
            : body.sat.frame === 'equatorial'
              ? 'ICRF equator'
              : 'ecliptic J2000',
        ]);
      }
    }
    const discovered = body.spec?.facts.discovered;
    if (discovered !== undefined && discovered !== '' && discovered !== 'n/a') {
      rows.push(['Discovered', discovered, true]);
    }
    const moons = body.children.filter((c) => c.type === 'moon').length;
    if (moons) {
      rows.push(['Known moons', String(moons)]);
    }
    void system;
    this.rowsInto(this.orbitFacts, rows);
  }

  private buildComposition(body: SimBody): void {
    const rows: Array<[string, string, boolean?]> = [];
    const composition = body.spec?.facts.composition;
    if (composition !== undefined && composition !== '') {
      rows.push(['Makeup', composition, true]);
    }
    if (body.small) {
      rows.push(['Family', body.subtitle, true]);
    }
    this.rowsInto(this.compositionEl, rows);

    // Ring names run long ("Main rings (C, B, Cassini division, A, F)"), so they
    // get stacked blocks rather than a key/value grid that would squeeze the
    // numbers into a one-word-per-line column.
    this.ringsEl.textContent = '';
    const rings = body.spec?.rings ?? [];
    for (const ring of rings) {
      const block = el('div', 'ring');
      block.append(el('div', 'ring__name', ring.name));
      block.append(el('div', 'ring__span', `${fmt(ring.innerKm, 0)} – ${fmt(ring.outerKm, 0)} km`));
      if (ring.note !== undefined && ring.note !== '') {
        block.append(el('div', 'ring__note', ring.note));
      }
      this.ringsEl.append(block);
    }

    const hasAny = rows.length > 0 || rings.length > 0;
    for (const section of this.host.querySelectorAll<HTMLElement>('.section')) {
      if (section.textContent === 'Composition') {
        section.style.display = hasAny ? 'block' : 'none';
      }
    }
  }

  /**
   * Live values that change every frame.
   *
   * `cameraDistanceKm` is a true distance in both scale modes and
   * `cameraRadii` the same figure in radii of the focused body — see
   * updateCameraDistance() in main.ts for why the raw scene distance will not do.
   */
  update(system: SolarSystem, focus: SimBody, cameraDistanceKm: number, cameraRadii: number): void {
    const body = this.current;
    if (!body) {
      return;
    }

    const rows: Array<[string, string, boolean?]> = [];
    const sunKm = system.distanceToSun(body);
    if (body.type !== 'star') {
      rows.push(
        ['Distance from Sun', formatDistance(sunKm)],
        ['Light travel from Sun', formatLightTime(sunKm)],
      );
    }
    if (body.parent && body.parent.type !== 'star') {
      const localKm = Math.hypot(body.localKm.x, body.localKm.y, body.localKm.z);
      rows.push([`Distance from ${body.parent.name}`, formatDistance(localKm)]);
    }
    const earth = system.byKey.get('earth');
    if (earth && body !== earth) {
      const dx = body.helioKm.x - earth.helioKm.x;
      const dy = body.helioKm.y - earth.helioKm.y;
      const dz = body.helioKm.z - earth.helioKm.z;
      const d = Math.hypot(dx, dy, dz);
      // The parent row above has already given this distance for anything that
      // belongs to Earth — the Moon, and all five Lagrange points — so only the
      // light time, which it does not carry, is added on top. Printing the same
      // figure twice under two headings reads as a bug even when both are right.
      if (body.parent !== earth) {
        rows.push(['Distance from Earth', formatDistance(d)]);
      }
      rows.push(['Light travel from Earth', formatLightTime(d)]);
    }
    if (body.parent) {
      const speed = system.speedKmS(body);
      if (speed > 0) {
        rows.push(['Orbital speed', `${speed.toFixed(3)} km/s`]);
      }
    }
    // The camera orbits the focused body, which is not always the selected one:
    // select Titan while orbiting Saturn and a "camera distance" on Titan's
    // panel would be quietly wrong.
    if (body === focus) {
      rows.push(['Camera distance', formatDistance(cameraDistanceKm)]);
      // A Lagrange point has no surface to be above and no radius to be
      // measured in, so it gets the distance and nothing else. Its `radiusKm`
      // is only the scale the camera frames it by.
      if (body.type !== 'lagrange') {
        const altitude = cameraDistanceKm - body.radiusKm;
        if (altitude > 0) {
          rows.push(['Camera altitude', formatDistance(altitude)]);
        }
        rows.push(['Camera range', `${cameraRadii.toFixed(2)} × radius`]);
      }
    }

    this.rowsInto(this.liveFacts, rows);
  }
}
