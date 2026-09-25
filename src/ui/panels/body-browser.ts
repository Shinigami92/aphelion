/** The searchable tree of bodies, with the moon sort and the Lagrange rows. */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import { el } from './dom.ts';
import { fmt, formatDistance } from './format.ts';

/** How the moon list under a planet is ordered. */
type MoonSort = 'size' | 'name' | 'distance';

const MOON_SORTS: Array<{ mode: MoonSort; label: string; title: string }> = [
  {
    mode: 'distance',
    label: 'distance',
    title: 'Innermost first, by semi-major axis about its planet',
  },
  { mode: 'size', label: 'size', title: 'Largest first, by mean radius' },
  {
    mode: 'name',
    label: 'name',
    title: 'Alphabetical, with provisional designations in numeric order',
  },
];

/** Semi-major axis about the parent, km. Unknown orbits sort to the end. */
const orbitRadius = (moon: SimBody): number => moon.elements?.a ?? Infinity;

/** Live distance from the parent, km. */
const localDistance = (body: SimBody): number =>
  Math.hypot(body.localKm.x, body.localKm.y, body.localKm.z);

export class BodyBrowser {
  private search = el('input', 'search');
  private list = el('div', 'browser__list');
  private expanded = new Set<string>();
  private query = '';
  private rows = new Map<string, HTMLElement>();
  private selectedKey: string | null = null;
  private sortRow = el('div', 'browser__sort');
  private moonSort: MoonSort = 'distance';
  private sortButtons: Array<{ mode: MoonSort; node: HTMLElement }> = [];
  /** What `showLagrange()` read at the last render, so `refresh` can skip. */
  private lagrangeShown = true;

  head!: HTMLElement;
  body!: HTMLElement;

  constructor(
    private host: HTMLElement,
    private system: SolarSystem,
    private onSelect: (body: SimBody) => void,
    /**
     * Whether the Lagrange points are being drawn.
     *
     * The list follows the view switch rather than holding an opinion of its
     * own: a point that is not on screen should not be offered as somewhere to
     * fly to, and clicking a row here does fly there.
     */
    private showLagrange: () => boolean = () => true,
  ) {
    const head = el('div', 'browser__head');
    const title = el('div', 'panel__title');
    title.append(el('span', undefined, 'Bodies'));
    const count = el('span', undefined, String(system.bodies.length));
    count.style.color = 'var(--text-faint)';
    count.style.fontFamily = 'var(--mono)';
    title.append(count);
    head.append(title);

    this.search.placeholder = `Search ${system.bodies.length} bodies…`;
    this.search.spellcheck = false;
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.search.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        const first = this.matches()[0];
        if (first !== undefined) {
          this.onSelect(first);
        }
      } else if (ev.key === 'Escape') {
        this.search.value = '';
        this.query = '';
        this.search.blur();
        this.render();
      }
    });
    // The search box collapses with the list: a hidden panel should not still
    // have a focusable input inside it.
    const body = el('div', 'panel__body');
    body.append(this.search, this.buildSortRow(), this.list);
    this.host.append(head, body);
    // The title row, not its padded wrapper: `.panel__title` is already a flex
    // row with space-between, so the collapse control lands beside the count
    // instead of stacking under it.
    this.head = title;
    this.body = body;

    this.expanded.add('earth');
    this.lagrangeShown = showLagrange();
    this.render();
  }

  /**
   * Re-list, because something outside the panel changed what belongs in it.
   *
   * Called from every route to the Lagrange switch — the checkbox, the X key,
   * and a restored link — and the X key repeats while held, so it compares
   * before rebuilding rather than throwing away the scroll position and the
   * open planets several times a second.
   */
  refresh(): void {
    const shown = this.showLagrange();
    if (shown === this.lagrangeShown) {
      return;
    }
    this.lagrangeShown = shown;
    this.render();
  }

  /**
   * The Lagrange points of one planet, or none while the layer is hidden.
   *
   * Every read of `system.lagrange` in this panel goes through here, so the
   * rows, the search results and the "5 Lagrange points" a planet row promises
   * cannot disagree about whether the points exist.
   */
  private lagrangeOf(key: string): SimBody[] {
    return this.lagrangeShown ? this.system.lagrangeOf(key) : [];
  }

  /**
   * The moon ordering control.
   *
   * Labelled "Moons" because that is all it touches: the planet and dwarf
   * planet groups are in ephemeris order and search results are ranked by how
   * well they match, so neither has an ordering to offer.
   */
  private buildSortRow(): HTMLElement {
    const row = this.sortRow;
    row.append(el('span', 'browser__sort-label', 'Moons'));
    const segmented = el('div', 'segmented');
    for (const option of MOON_SORTS) {
      const btn = el('button', 'btn', option.label);
      btn.title = option.title;
      btn.addEventListener('click', () => {
        if (this.moonSort === option.mode) {
          return;
        }
        this.moonSort = option.mode;
        this.refreshSortRow();
        this.render();
      });
      segmented.append(btn);
      this.sortButtons.push({ mode: option.mode, node: btn });
    }
    row.append(segmented);
    this.refreshSortRow();
    return row;
  }

  private refreshSortRow(): void {
    for (const { mode, node } of this.sortButtons) {
      node.classList.toggle('btn--active', mode === this.moonSort);
    }
  }

  focusSearch(): void {
    this.search.focus();
    this.search.select();
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

  private matches(): SimBody[] {
    if (!this.query) {
      return [];
    }
    // Lagrange points are not in `bodies` — they are markers, not objects — but
    // they are findable while the layer is on, and their subtitle is searched as
    // well as their name: "L4" alone cannot tell you whose, and "earth" or
    // "lagrange" is how anyone would actually look for them.
    return [...this.system.bodies, ...(this.lagrangeShown ? this.system.lagrange : [])]
      .filter(
        (b) =>
          b.name.toLowerCase().includes(this.query) ||
          (b.type === 'lagrange' && b.subtitle.toLowerCase().includes(this.query)),
      )
      .toSorted((a, b) => {
        // Prefer prefix matches, then bigger bodies.
        const ap = a.name.toLowerCase().startsWith(this.query) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(this.query) ? 0 : 1;
        if (ap !== bp) {
          return ap - bp;
        }
        return b.radiusKm - a.radiusKm;
      })
      .slice(0, 90);
  }

  private render(): void {
    this.list.textContent = '';
    this.rows.clear();
    this.sortRow.style.display = this.query ? 'none' : 'flex';

    if (this.query) {
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
      return;
    }

    // Sun
    const sunGroup = el('div', 'group');
    sunGroup.append(this.makeRow(this.system.sun, 0));
    this.list.append(sunGroup);

    // Planets, each expandable to its moons.
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
          planetGroup.append(this.makeRow(moon, 1, this.moonMeta(moon)));
        }
      }
    }
    this.list.append(planetGroup);

    // Dwarf planets (Pluto included, with its moons).
    const dwarfs = this.system.sun.children.filter((b) => b.type === 'dwarf');
    const dwarfGroup = el('div', 'group');
    dwarfGroup.append(el('div', 'group__head', 'Dwarf planets'));
    for (const dwarf of dwarfs) {
      dwarfGroup.append(this.makeRow(dwarf, 0, this.moonCount(dwarf)));
      if (this.expanded.has(dwarf.key)) {
        for (const moon of this.sortedMoons(dwarf.key)) {
          dwarfGroup.append(this.makeRow(moon, 1, this.moonMeta(moon)));
        }
      }
    }
    this.list.append(dwarfGroup);

    // Minor planets, grouped by dynamical family.
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
    this.list.append(minorGroup);

    if (this.selectedKey !== null) {
      this.rows.get(this.selectedKey)?.classList.add('row--selected');
    }
  }

  /**
   * The moons of one body in the chosen order.
   *
   * `moonsOf` hands back a fresh array already sorted largest first, so the
   * size case needs no work at all.
   */
  private sortedMoons(key: string): SimBody[] {
    const moons = this.system.moonsOf(key);
    if (this.moonSort === 'name') {
      // Numeric collation so that S/2004 S 9 precedes S/2004 S 24 rather than
      // following it — half of Saturn's family is still provisional.
      return moons.toSorted((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    }
    if (this.moonSort === 'distance') {
      // Semi-major axis rather than where the moon happens to be right now: a
      // live distance would reshuffle the list under the cursor every frame.
      return moons.toSorted((a, b) => orbitRadius(a) - orbitRadius(b));
    }
    return moons;
  }

  /** The figure on the right of a moon row is whatever the list is ordered by. */
  private moonMeta(moon: SimBody): string {
    if (this.moonSort !== 'distance') {
      return `${fmt(moon.radiusKm, 0)} km`;
    }
    const a = moon.elements?.a;
    return a === undefined ? '' : formatDistance(a);
  }

  private moonCount(body: SimBody): string {
    const n = body.children.filter((c) => c.type === 'moon').length;
    return n ? `${n} moon${n === 1 ? '' : 's'}` : '';
  }

  /**
   * What a planet row promises when you open it.
   *
   * Moons if it has any, otherwise its Lagrange points — Mercury and Venus have
   * no moons at all, and before the points existed their rows had nothing to
   * expand and so carried no chevron.
   */
  private childCount(body: SimBody): string {
    const moons = this.moonCount(body);
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
