/** The body browser's list: the grouped, expandable tree of bodies, or search results. */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { MoonSort } from './browser-order.ts';
import { localDistance, moonCount, moonMeta, searchBodies, sortMoons } from './browser-order.ts';
import { el } from './dom.ts';
import { fmt, formatDistance } from './format.ts';

/** What the panel around the list decides: the search, the moon order, the Lagrange layer. */
export interface TreeView {
  query: string;
  moonSort: MoonSort;
  lagrangeShown: boolean;
}

export class BodyTree {
  private expanded = new Set<string>();
  private rows = new Map<string, HTMLElement>();
  private selectedKey: string | null = null;
  private view: TreeView = { query: '', moonSort: 'distance', lagrangeShown: true };

  constructor(
    private list: HTMLElement,
    private system: SolarSystem,
    private onSelect: (body: SimBody) => void,
  ) {}

  expand(key: string): void {
    this.expanded.add(key);
  }

  setSelected(body: SimBody): void {
    if (this.selectedKey === body.key) {
      return;
    }
    if (this.selectedKey !== null) {
      this.rows.get(this.selectedKey)?.classList.remove('row--selected');
    }
    this.selectedKey = body.key;
    const row = this.rows.get(body.key);
    if (row) {
      row.classList.add('row--selected');
      row.scrollIntoView({ block: 'nearest' });
    } else if (body.parent) {
      // Reveal it by expanding its parent.
      this.expanded.add(body.parent.key);
      this.render();
      this.rows.get(body.key)?.classList.add('row--selected');
      this.rows.get(body.key)?.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * The Lagrange points of one planet, or none while the layer is hidden.
   *
   * Every read of `system.lagrange` in this list goes through here, so the
   * rows, the search results and the "5 Lagrange points" a planet row promises
   * cannot disagree about whether the points exist.
   */
  private lagrangeOf(key: string): SimBody[] {
    return this.view.lagrangeShown ? this.system.lagrangeOf(key) : [];
  }

  /** Bodies matching the current search, best first. */
  matches(): SimBody[] {
    if (!this.view.query) {
      return [];
    }
    return searchBodies(
      [...this.system.bodies, ...(this.view.lagrangeShown ? this.system.lagrange : [])],
      this.view.query,
    );
  }

  /** Rebuild the list, for a new view or, without one, for the current view. */
  render(view: TreeView = this.view): void {
    this.view = view;
    this.list.textContent = '';
    this.rows.clear();

    if (view.query) {
      this.renderMatches();
      return;
    }

    // Sun
    const sunGroup = el('div', 'group');
    sunGroup.append(this.makeRow(this.system.sun, 0));
    this.list.append(sunGroup);
    this.list.append(this.planetGroup(view));
    this.list.append(this.dwarfGroup(view));
    this.list.append(this.minorGroup());

    if (this.selectedKey !== null) {
      this.rows.get(this.selectedKey)?.classList.add('row--selected');
    }
  }

  /** The flat result list shown while a search is active. */
  private renderMatches(): void {
    const results = this.matches();
    const group = el('div', 'group');
    group.append(
      el('div', 'group__head', `${results.length} match${results.length === 1 ? '' : 'es'}`),
    );
    for (const body of results) {
      group.append(this.makeRow(body, 0, body.subtitle));
    }
    this.list.append(group);
    if (results.length === 0) {
      const empty = el('div', 'group__head', 'nothing found');
      this.list.append(empty);
    }
  }

  /** Planets, each expandable to its moons. */
  private planetGroup(view: TreeView): HTMLElement {
    const planets = this.system.sun.children.filter((b) => b.type === 'planet');
    const planetGroup = el('div', 'group');
    planetGroup.append(el('div', 'group__head', 'Planets'));
    for (const planet of planets) {
      planetGroup.append(this.makeRow(planet, 0, this.childCount(planet)));
      if (this.expanded.has(planet.key)) {
        // Lagrange points first: there are always five, and burying them under
        // Saturn's 291 moons would put them past the end of the list.
        for (const point of this.lagrangeOf(planet.key)) {
          planetGroup.append(this.makeRow(point, 1, formatDistance(localDistance(point))));
        }
        for (const moon of this.sortedMoons(planet.key).slice(0, 400)) {
          planetGroup.append(this.makeRow(moon, 1, moonMeta(moon, view.moonSort)));
        }
      }
    }
    return planetGroup;
  }

  /** Dwarf planets (Pluto included, with its moons). */
  private dwarfGroup(view: TreeView): HTMLElement {
    const dwarfs = this.system.sun.children.filter((b) => b.type === 'dwarf');
    const dwarfGroup = el('div', 'group');
    dwarfGroup.append(el('div', 'group__head', 'Dwarf planets'));
    for (const dwarf of dwarfs) {
      dwarfGroup.append(this.makeRow(dwarf, 0, moonCount(dwarf)));
      if (this.expanded.has(dwarf.key)) {
        for (const moon of this.sortedMoons(dwarf.key)) {
          dwarfGroup.append(this.makeRow(moon, 1, moonMeta(moon, view.moonSort)));
        }
      }
    }
    return dwarfGroup;
  }

  /** Minor planets, grouped by dynamical family. */
  private minorGroup(): HTMLElement {
    const minor = this.system.sun.children.filter((b) => b.type === 'asteroid');
    const families = new Map<string, SimBody[]>();
    for (const body of minor) {
      const list = families.get(body.subtitle);
      if (list) {
        list.push(body);
      } else {
        families.set(body.subtitle, [body]);
      }
    }
    const minorGroup = el('div', 'group');
    minorGroup.append(el('div', 'group__head', `Minor planets (${minor.length})`));
    for (const [family, bodies] of families) {
      const key = `family:${family}`;
      const header = el('div', 'row');
      header.append(el('span', 'row__toggle', this.expanded.has(key) ? '▾' : '▸'));
      const name = el('span', 'row__name', family);
      name.style.color = 'var(--text-dim)';
      header.append(name, el('span', 'row__meta', String(bodies.length)));
      header.addEventListener('click', () => {
        if (this.expanded.has(key)) {
          this.expanded.delete(key);
        } else {
          this.expanded.add(key);
        }
        this.render();
      });
      minorGroup.append(header);
      if (this.expanded.has(key)) {
        for (const body of bodies.toSorted((a, b) => b.radiusKm - a.radiusKm)) {
          minorGroup.append(this.makeRow(body, 1, `${fmt(body.radiusKm * 2, 0)} km`));
        }
      }
    }
    return minorGroup;
  }

  private sortedMoons(key: string): SimBody[] {
    return sortMoons(this.system.moonsOf(key), this.view.moonSort);
  }

  /**
   * What a planet row promises when you open it.
   *
   * Moons if it has any, otherwise its Lagrange points — Mercury and Venus have
   * no moons at all, and before the points existed their rows had nothing to
   * expand and so carried no chevron.
   */
  private childCount(body: SimBody): string {
    const moons = moonCount(body);
    if (moons) {
      return moons;
    }
    const points = this.lagrangeOf(body.key).length;
    return points ? `${points} Lagrange points` : '';
  }

  /**
   * Whether a row gets a chevron.
   *
   * The type test is not redundant with the lookup below it: `makeRow` runs for
   * every one of the ~700 rows, and `lagrangeOf` scans all forty points, so
   * without it a keystroke in the search box does 28,000 comparisons to
   * rediscover that minor planets do not have Lagrange points.
   */
  private expandable(body: SimBody): boolean {
    if (body.children.some((c) => c.type === 'moon')) {
      return true;
    }
    return body.type === 'planet' && this.lagrangeOf(body.key).length > 0;
  }

  private makeRow(body: SimBody, depth: number, meta?: string): HTMLElement {
    const row = el(
      'div',
      `row${depth === 1 ? ' row--child' : depth === 2 ? ' row--grandchild' : ''}`,
    );

    if (this.expandable(body) && depth === 0) {
      const toggle = el('span', 'row__toggle', this.expanded.has(body.key) ? '▾' : '▸');
      toggle.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (this.expanded.has(body.key)) {
          this.expanded.delete(body.key);
        } else {
          this.expanded.add(body.key);
        }
        this.render();
      });
      row.append(toggle);
    } else if (depth === 0) {
      row.append(el('span', 'row__toggle', ''));
    }

    const swatch = el('span', 'row__swatch');
    swatch.style.background = `#${body.color.toString(16).padStart(6, '0')}`;
    swatch.style.color = `#${body.color.toString(16).padStart(6, '0')}`;
    row.append(swatch, el('span', 'row__name', body.name));
    if (meta !== undefined && meta !== '') {
      row.append(el('span', 'row__meta', meta));
    }

    row.addEventListener('click', () => {
      this.onSelect(body);
    });
    this.rows.set(body.key, row);
    return row;
  }
}
