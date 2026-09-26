/**
 * The searchable tree of bodies, with the moon sort and the Lagrange rows.
 *
 * This is the panel around the list: the search box, the moon ordering control
 * and the Lagrange switch it follows. The list itself is `BodyTree`.
 */

import type { SimBody, SolarSystem } from '../../core/system.ts';
import type { MoonSort } from './browser-order.ts';
import { BodyTree } from './body-tree.ts';
import { MOON_SORTS } from './browser-order.ts';
import { el } from './dom.ts';

export class BodyBrowser {
  private search = el('input', 'search');
  private list = el('div', 'browser__list');
  private query = '';
  private sortRow = el('div', 'browser__sort');
  private moonSort: MoonSort = 'distance';
  private sortButtons: Array<{ mode: MoonSort; node: HTMLElement }> = [];
  /** What `showLagrange()` read at the last render, so `refresh` can skip. */
  private lagrangeShown = true;
  private tree: BodyTree;

  head!: HTMLElement;
  body!: HTMLElement;

  constructor(
    private host: HTMLElement,
    system: SolarSystem,
    private onSelect: (body: SimBody) => void,
    /**
     * Whether the Lagrange points are being drawn.
     *
     * The list follows the view switch rather than holding an opinion of its
     * own: a point that is not on screen should not be offered as somewhere to
     * fly to, and clicking a row here does fly there.
     */
    private showLagrange: () => boolean = (): boolean => true,
  ) {
    this.tree = new BodyTree(this.list, system, onSelect);

    const head = el('div', 'browser__head');
    const title = el('div', 'panel__title');
    title.append(el('span', undefined, 'Bodies'));
    const count = el('span', undefined, String(system.bodies.length));
    count.style.color = 'var(--text-faint)';
    count.style.fontFamily = 'var(--mono)';
    title.append(count);
    head.append(title);

    this.wireSearch(system.bodies.length);
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

    this.tree.expand('earth');
    this.lagrangeShown = showLagrange();
    this.render();
  }

  /** Filter as you type; Enter picks the best match and Escape clears the search. */
  private wireSearch(bodyCount: number): void {
    this.search.placeholder = `Search ${bodyCount} bodies…`;
    this.search.spellcheck = false;
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    });
    this.search.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        const first = this.tree.matches()[0];
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
    this.tree.setSelected(body);
  }

  private render(): void {
    this.sortRow.style.display = this.query ? 'none' : 'flex';
    this.tree.render({
      query: this.query,
      moonSort: this.moonSort,
      lagrangeShown: this.lagrangeShown,
    });
  }
}
