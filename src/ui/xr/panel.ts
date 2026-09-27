/**
 * The VR panel: one slab with a tab per job — Time, Info, Bodies, View — in
 * place of the page's four separate panels. A headset has room for one thing
 * in front of you at a time, and a wrist has room for less.
 *
 * The header carries a status line, which is where the headset sees what the
 * page shows as toasts ("Paused", "Free flight", …); a toast on the page is
 * invisible to whoever is wearing the headset.
 */

import { Container } from '@pmndrs/uikit';
import { LiveText } from './live-text.ts';
import { COLOR, FONT_FAMILIES, PANEL_HEIGHT, PANEL_WIDTH, PIXEL_SIZE, RADIUS } from './theme.ts';
import { Button, row, title } from './widgets.ts';

/** One tab's content. */
export interface Tab {
  readonly name: string;
  readonly node: Container;
  /** Bring the content up to date; called every frame while the tab is showing. */
  refresh(now: number): void;
}

/** How long a status message stays up, milliseconds. */
const STATUS_MS = 2500;

function header(status: LiveText): Container {
  const node = new Container({
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexShrink: 0,
  });
  node.add(title('Aphelion'), status.node);
  return node;
}

export class VrPanel {
  readonly root: Container;
  private readonly tabButtons: Button[];
  private readonly status = new LiveText('', { fontSize: 12, color: COLOR.accent });
  private readonly content = new Container({
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    flexDirection: 'column',
  });
  private active = 0;
  private statusUntil = 0;

  constructor(private readonly tabs: ReadonlyArray<Tab>) {
    this.root = new Container({
      pixelSize: PIXEL_SIZE,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      flexDirection: 'column',
      padding: 14,
      gap: 10,
      backgroundColor: COLOR.panel,
      borderRadius: RADIUS,
      borderWidth: 1,
      borderColor: COLOR.border,
      fontFamilies: FONT_FAMILIES,
      fontFamily: 'inter',
      color: COLOR.text,
      fontSize: 13,
    });
    this.tabButtons = tabs.map(
      (tab, i) =>
        new Button(
          tab.name,
          () => {
            this.select(i);
          },
          { grow: true, active: (): boolean => this.active === i },
        ),
    );
    this.root.add(header(this.status), row(this.tabButtons), this.content);
    this.select(0);
  }

  /**
   * Show tab `index`. Only the showing tab is attached to the panel: uikit
   * lays out the whole tree whenever any text in it changes, hidden subtrees
   * included, so a tab left hidden in place (the Bodies list most of all) made
   * every tick of the clock cost a dozen milliseconds of layout.
   */
  select(index: number): void {
    this.content.remove(this.tabs[this.active].node);
    this.active = index;
    this.content.add(this.tabs[index].node);
  }

  /** Show a short message in the header, as the page shows a toast. */
  say(message: string, now: number): void {
    this.status.set(message);
    this.statusUntil = now + STATUS_MS;
  }

  /** Refresh what is showing, then lay out and draw. */
  update(now: number, deltaMs: number): void {
    for (const button of this.tabButtons) {
      button.refresh();
    }
    this.tabs[this.active].refresh(now);
    if (this.statusUntil !== 0 && now > this.statusUntil) {
      this.statusUntil = 0;
      this.status.set('');
    }
    this.root.update(deltaMs);
  }
}
