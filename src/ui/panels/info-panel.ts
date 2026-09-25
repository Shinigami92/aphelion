/** Facts about the selected body: live readouts, physical data, orbit, composition. */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { FactRow } from './info-facts.ts';
import { el } from './dom.ts';
import { fmt } from './format.ts';
import {
  lagrangeOrbitRows,
  lagrangePhysicalRows,
  liveRows,
  orbitRows,
  physicalRows,
} from './info-facts.ts';

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
  setBody(body: SimBody): void {
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

    // A Lagrange point shares no field with a body, so both of its sections are
    // filled from the pair instead. See info-facts.ts.
    if (body.type === 'lagrange') {
      this.rowsInto(this.physFacts, lagrangePhysicalRows(body));
      this.rowsInto(this.orbitFacts, lagrangeOrbitRows(body));
    } else {
      this.rowsInto(this.physFacts, physicalRows(body));
      this.rowsInto(this.orbitFacts, orbitRows(body));
    }
    this.buildComposition(body);
  }

  private rowsInto(target: HTMLElement, rows: FactRow[]): void {
    target.textContent = '';
    for (const [key, value, wrap] of rows) {
      if (!value) {
        continue;
      }
      target.append(el('div', 'facts__key', key));
      target.append(el('div', `facts__val${wrap === true ? ' facts__val--wrap' : ''}`, value));
    }
  }

  private buildComposition(body: SimBody): void {
    const rows: FactRow[] = [];
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

  /** Live values that change every frame. See `liveRows` in info-facts.ts. */
  update(system: SolarSystem, focus: SimBody, cameraDistanceKm: number, cameraRadii: number): void {
    const body = this.current;
    if (!body) {
      return;
    }
    this.rowsInto(this.liveFacts, liveRows(system, body, focus, cameraDistanceKm, cameraRadii));
  }
}
