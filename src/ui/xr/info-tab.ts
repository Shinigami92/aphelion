/**
 * The Info tab: the selected body, as the page's info panel describes it —
 * the same caveat badge, the same fact rows from info-facts.ts, and the live
 * readings — laid out for a headset.
 */

import type { CameraController } from '../../controls/camera.ts';
import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { Tab } from './panel.ts';
import { Container } from '@pmndrs/uikit';
import { CameraRange } from '../../app/camera-range.ts';
import { liveRows } from '../panels/info-facts.ts';
import { badgeFlags, compositionRows, factSections } from '../panels/info-sections.ts';
import { FactList } from './fact-list.ts';
import { LiveText } from './live-text.ts';
import { COLOR, SCROLL } from './theme.ts';
import { title } from './widgets.ts';

/** What the Info tab reads. */
export interface InfoTabDeps {
  system: SolarSystem;
  camera: CameraController;
  selected: () => SimBody;
  focused: () => SimBody;
}

/**
 * How often the live readings are rewritten, milliseconds. Each rewrite
 * relayouts the panel, and nobody reads a distance changing sixty times a
 * second.
 */
const LIVE_MS = 250;

function section(name: string, list: FactList): Container {
  const node = new Container({ flexDirection: 'column', gap: 5, flexShrink: 0 });
  node.add(title(name), list.node);
  return node;
}

export class InfoTab implements Tab {
  readonly name = 'Info';
  readonly node = new Container({ flexDirection: 'column', gap: 10, ...SCROLL });
  private readonly title = new LiveText('', { fontSize: 20, fontWeight: 'semi-bold' });
  private readonly subtitle = new LiveText('', { fontSize: 12, color: COLOR.textDim });
  private readonly badge = new LiveText('', { fontSize: 11, color: COLOR.warn });
  private readonly blurb = new LiveText('', { fontSize: 12, color: COLOR.textDim });
  private readonly live = new FactList(8);
  private readonly physical = new FactList(14);
  private readonly orbit = new FactList(12);
  private readonly composition = new FactList(2);
  private readonly range: CameraRange;
  private shown: SimBody | null = null;
  private liveAt = -Infinity;

  constructor(private readonly deps: InfoTabDeps) {
    this.range = new CameraRange(deps.camera, deps.focused);
    this.node.add(
      this.title.node,
      this.subtitle.node,
      this.badge.node,
      this.blurb.node,
      section('Right now', this.live),
      section('Physical', this.physical),
      section('Orbit', this.orbit),
      section('Composition', this.composition),
    );
  }

  refresh(now: number): void {
    const body = this.deps.selected();
    if (body !== this.shown) {
      this.shown = body;
      this.describe(body);
      this.liveAt = -Infinity;
    }
    if (now - this.liveAt >= LIVE_MS) {
      this.liveAt = now;
      this.range.update();
      const { system, focused } = this.deps;
      this.live.set(liveRows(system, body, focused(), this.range.km, this.range.radii));
    }
  }

  /** The parts that change only with the selection. */
  private describe(body: SimBody): void {
    this.title.set(body.name);
    this.subtitle.set(body.subtitle);
    this.badge.set(badgeFlags(body).join(' · '));
    this.blurb.set(body.note ?? body.spec?.facts.blurb ?? '');
    const sections = factSections(body);
    this.physical.set(sections.physical);
    this.orbit.set(sections.orbit);
    this.composition.set(compositionRows(body));
  }
}
