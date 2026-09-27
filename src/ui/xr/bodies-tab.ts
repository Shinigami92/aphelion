/**
 * The Bodies tab: a list to fly to anything by name, for when the thing you
 * want is a speck too small to aim a ray at. Rows come from body-list.ts; a
 * row's name selects and flies, its arrow opens it.
 *
 * The list is a window onto the rows, drawn with a fixed handful of reusable
 * slots (body-slot.ts). Scrolling slides the slots by the part of a row and
 * shifts which rows they show by the whole rows, so it moves smoothly by the
 * pixel while only ever rewriting text. Building a node per row instead made
 * opening Jupiter stall the headset for the better part of half a second. It
 * scrolls with the right stick while the ray is on it.
 *
 * There is no search box: typing in a headset needs a keyboard nobody has.
 */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { ListRow } from './body-list.ts';
import type { SlotHost } from './body-slot.ts';
import type { Tab } from './panel.ts';
import { Container } from '@pmndrs/uikit';
import { bodyRows } from './body-list.ts';
import { BodySlot, ROW_HEIGHT } from './body-slot.ts';

/** What the Bodies tab reads and does. */
export interface BodiesTabDeps {
  system: SolarSystem;
  selected: () => SimBody;
  lagrangeShown: () => boolean;
  select: (body: SimBody) => void;
  goTo: (body: SimBody) => void;
}

/** The list's height in layout pixels: the panel below its tab bar. */
const VIEW_HEIGHT = 322;
/** Enough slots to cover the view with a row half scrolled in at each end. */
const SLOTS = Math.ceil(VIEW_HEIGHT / ROW_HEIGHT) + 1;

export class BodiesTab implements Tab {
  readonly name = 'Bodies';
  readonly node = new Container({
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
    overflow: 'hidden',
    onWheel: (event: { deltaY: number }): void => {
      this.scrollBy(event.deltaY);
    },
  });
  private readonly track = new Container({ flexDirection: 'column', flexShrink: 0 });
  private readonly slots: BodySlot[] = [];
  private readonly expanded = new Set<string>();
  private rows: ListRow[] = [];
  /** How far down the list is scrolled, layout pixels. */
  private scrolled = 0;
  /** The row the first slot shows, or -1 to redraw every slot. */
  private first = -1;
  private dirty = true;
  private lagrange: boolean;
  private selected: SimBody | null = null;

  constructor(private readonly deps: BodiesTabDeps) {
    this.lagrange = deps.lagrangeShown();
    for (let i = 0; i < SLOTS; i++) {
      const slot = new BodySlot(this.host);
      this.slots.push(slot);
      this.track.add(slot.node);
    }
    this.node.add(this.track);
  }

  refresh(): void {
    if (this.lagrange !== this.deps.lagrangeShown()) {
      this.lagrange = this.deps.lagrangeShown();
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.rows = bodyRows(this.deps.system, this.expanded, this.lagrange);
      this.first = -1;
      this.scrollBy(0);
    }
    const now = this.deps.selected();
    if (now !== this.selected) {
      this.selected = now;
      for (const slot of this.slots) {
        slot.paint();
      }
    }
  }

  /** Scroll by `pixels`, kept inside the list. */
  scrollBy(pixels: number): void {
    const end = Math.max(0, this.rows.length * ROW_HEIGHT - VIEW_HEIGHT);
    this.scrolled = Math.min(end, Math.max(0, this.scrolled + pixels));
    const first = Math.floor(this.scrolled / ROW_HEIGHT);
    if (first !== this.first) {
      this.first = first;
      this.slots.forEach((slot, i) => {
        slot.show(this.rows[first + i]);
      });
    }
    this.track.setProperties({ transformTranslateY: first * ROW_HEIGHT - this.scrolled });
  }

  /** What each slot asks of the list. */
  private readonly host: SlotHost = {
    isOpen: (key) => this.expanded.has(key),
    toggle: (key) => {
      if (!this.expanded.delete(key)) {
        this.expanded.add(key);
      }
      this.dirty = true;
    },
    choose: (body) => {
      this.deps.select(body);
      this.deps.goTo(body);
    },
    isSelected: (body) => body === this.selected,
  };
}
