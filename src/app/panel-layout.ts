/** Where the panels sit: bounds between neighbours, folding, and the phone layout. */

import type { Collapsible } from '../ui/collapse.ts';
import { makeCollapsible } from '../ui/collapse.ts';
import { installMobileShell } from '../ui/mobile.ts';
import { need } from './dom.ts';

/** A panel with a header that folds its body away. */
interface Foldable {
  readonly head: HTMLElement;
  readonly body: HTMLElement;
}

/** Whether a panel takes up room on screen right now, collapsed or hidden ones not. */
const isShown = (el: HTMLElement): boolean =>
  el.offsetParent !== null && getComputedStyle(el).display !== 'none';

export class PanelLayout {
  /**
   * Whether the phone shell is in charge of panel placement.
   *
   * A plain flag rather than a reference to the shell: it calls back while it is
   * still being constructed, so reading its binding from here would be a temporal
   * dead zone.
   */
  mobile = false;

  /**
   * The orrery's handle is held separately: folding the map away is what the view
   * panel's checkbox used to do, and the frame loop asks this whether the map is
   * worth redrawing.
   */
  readonly minimapPanel: Collapsible;
  private readonly collapsibles: Collapsible[];

  constructor(panels: {
    timePanel: Foldable;
    browser: Foldable;
    infoPanel: Foldable;
    minimap: Foldable;
    togglePanel: Foldable;
  }) {
    const { timePanel, browser, infoPanel, minimap, togglePanel } = panels;

    // No panel's height is final at startup, and all of them change later: the
    // orrery caption wraps to a second line once the first frame fills it in, the
    // view panel grows whenever a toggle is added, and any of them can now be
    // collapsed. Observe them rather than measuring once and trusting the result.
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        this.sync();
      });
      observer.observe(need('minimap'));
      observer.observe(need('toggles'));
      observer.observe(need('time-panel'));
    }

    // Every panel folds down to its own header, so a crowded screen can be cleared
    // without losing track of what is selected or what the clock reads. Collapsing
    // the view panel changes its height, which the ResizeObserver above already
    // watches, so the browser panel's lower bound follows on its own.

    this.minimapPanel = makeCollapsible(
      need('minimap'),
      minimap.head,
      minimap.body,
      'the orrery map',
    );
    this.collapsibles = [
      makeCollapsible(need('time-panel'), timePanel.head, timePanel.body, 'the time controls'),
      makeCollapsible(need('browser'), browser.head, browser.body, 'the body browser'),
      makeCollapsible(need('info'), infoPanel.head, infoPanel.body, 'the body details'),
      this.minimapPanel,
      makeCollapsible(need('toggles'), togglePanel.head, togglePanel.body, 'the view options'),
    ];

    /**
     * The phone layout: the clock docks across the top and the other four panels
     * become bottom sheets driven by a tab bar. The panels themselves are re-used,
     * so there is no second implementation of the browser or the info readouts.
     */
    installMobileShell(
      need('app'),
      [
        { id: 'bodies', label: 'Bodies', panel: need('browser') },
        { id: 'info', label: 'Info', panel: need('info') },
        { id: 'view', label: 'View', panel: need('toggles') },
        { id: 'orrery', label: 'Orrery', panel: need('minimap') },
      ],
      (mobile) => {
        this.mobile = mobile;
        if (mobile) {
          // A panel left collapsed on desktop carries an inline height that would
          // fight the sheet's own sizing, so every panel starts the phone layout
          // open. The chevrons are hidden there anyway.
          for (const panel of this.collapsibles) {
            if (panel.collapsed) {
              panel.toggle();
            }
          }
        }
        this.sync();
      },
    );
  }

  /**
   * Bound the info panel so it stops short of the orrery map in the same corner.
   *
   * Measured from real geometry rather than expressed in `vh`: viewport units do
   * not always equal the client height a panel is actually laid out against, and
   * being a few pixels out means long content (Saturn's ring table) disappears
   * under the map. Does nothing under the phone layout, which places its panels
   * from the stylesheet instead.
   */
  sync(): void {
    // The phone layout positions these panels from the stylesheet, and inline
    // styles would win over it. Hand them back rather than merely skipping, or a
    // rotation from desktop widths leaves a stale `bottom` pinning a sheet.
    if (this.mobile) {
      for (const id of ['browser', 'info']) {
        const panel = need(id);
        panel.style.top = '';
        panel.style.bottom = '';
        panel.style.maxHeight = '';
        panel.style.height = '';
      }
      return;
    }

    const viewportHeight = document.documentElement.clientHeight;

    // Right column: the info panel stops above the orrery map. The map is always
    // in the corner now — collapsing it moves its top edge down, which this reads
    // straight off the geometry, so the info panel reclaims the space either way.
    const info = need('info');
    const available = need('minimap').getBoundingClientRect().top - 12;
    info.style.maxHeight = `${Math.max(220, Math.round(available - 14))}px`;

    // Left column: the body browser stops above the view panel. Both are fixed to
    // the same edge, so the browser's `bottom` has to clear the view panel's whole
    // height — and that height is content-dependent (it grows with every toggle
    // added), which is exactly why the hard-coded 176px in the stylesheet was 29px
    // short and the two overlapped.
    const browserEl = need('browser');
    const toggles = need('toggles');
    const clearance = isShown(toggles)
      ? Math.round(viewportHeight - toggles.getBoundingClientRect().top + 12)
      : 14;
    browserEl.style.bottom = `${clearance}px`;

    // ...and starts below the time panel, for the same reason in the other
    // direction. The stylesheet's 186px assumes a fully expanded clock, so
    // collapsing it used to leave the browser stranded with a band of empty space
    // above it while the other two edges of the column tracked their neighbours.
    const timePanelEl = need('time-panel');
    browserEl.style.top = isShown(timePanelEl)
      ? `${Math.round(timePanelEl.getBoundingClientRect().bottom + 12)}px`
      : '14px';
  }
}
