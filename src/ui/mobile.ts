/**
 * The phone layout.
 *
 * Desktop puts five panels around the edges of a wide screen at once. A phone
 * has room for the scene and one panel, so below the breakpoint the same panels
 * are re-used — not duplicated — in a different shell: the clock docks as a top
 * bar, and the other four become bottom sheets, one at a time, chosen from a tab
 * bar. Nothing here runs on desktop beyond a media query listener.
 *
 * Re-using the panel elements rather than building phone-specific copies means
 * the body browser's search, the info panel's live readouts and the orrery's
 * canvas all keep working with no second implementation to keep in step.
 */

export const MOBILE_QUERY = '(max-width: 880px)';

export interface MobileTab {
  id: string;
  label: string;
  panel: HTMLElement;
}

export interface MobileShell {
  readonly active: boolean;
  /** Close whatever sheet is open. */
  closeSheet(): void;
}

/**
 * @param onModeChange fires whenever the layout switches, so the rest of the
 *   app can stand its desktop-only measuring down and back up again.
 */
export function installMobileShell(
  app: HTMLElement,
  tabs: MobileTab[],
  onModeChange: (mobile: boolean) => void,
): MobileShell {
  return new PhoneShell(app, tabs, onModeChange);
}

class PhoneShell implements MobileShell {
  private readonly bar = document.createElement('nav');
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private openId: string | null = null;
  private mobile = false;

  constructor(
    private readonly app: HTMLElement,
    private readonly tabs: MobileTab[],
    private readonly onModeChange: (mobile: boolean) => void,
  ) {
    this.bar.className = 'tabbar';
    this.bar.setAttribute('aria-label', 'Panels');
    for (const tab of this.tabs) {
      const button = document.createElement('button');
      button.className = 'tabbar__btn';
      button.type = 'button';
      button.textContent = tab.label;
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => {
        this.toggle(tab.id);
      });
      this.buttons.set(tab.id, button);
      this.bar.append(button);
    }

    const media = window.matchMedia(MOBILE_QUERY);
    this.applyMode(media.matches);
    media.addEventListener('change', (ev) => {
      this.applyMode(ev.matches);
    });
  }

  get active(): boolean {
    return this.mobile;
  }

  closeSheet(): void {
    this.setOpen(null);
  }

  private setOpen(id: string | null): void {
    this.openId = id;
    for (const tab of this.tabs) {
      const on = tab.id === id;
      tab.panel.classList.toggle('is-sheet-open', on);
      const button = this.buttons.get(tab.id);
      button?.classList.toggle('is-active', on);
      button?.setAttribute('aria-expanded', String(on));
      // A closed sheet is off the layout entirely, so its contents cannot be
      // reached by tabbing behind the scene.
      tab.panel.inert = !on;
    }
  }

  /**
   * Tapping the open tab again closes it, so the scene can be seen whole
   * without hunting for a dismiss control.
   */
  private toggle(id: string): void {
    this.setOpen(this.openId === id ? null : id);
  }

  private applyMode(next: boolean): void {
    if (next === this.mobile) {
      return;
    }
    this.mobile = next;
    document.body.classList.toggle('is-mobile', this.mobile);
    if (this.mobile) {
      this.app.append(this.bar);
      this.setOpen(null);
    } else {
      this.bar.remove();
      // Hand every panel back to the desktop layout: no sheet state, nothing
      // inert, and no leftover open sheet.
      for (const tab of this.tabs) {
        tab.panel.classList.remove('is-sheet-open');
        tab.panel.inert = false;
      }
      this.openId = null;
      for (const button of this.buttons.values()) {
        button.classList.remove('is-active');
        button.setAttribute('aria-expanded', 'false');
      }
    }
    this.onModeChange(this.mobile);
  }
}
