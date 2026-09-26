/**
 * Panel collapsing.
 *
 * The five panels are laid out three different ways — the time and view panels
 * are sized by their content, the info panel is clamped by a max-height, and the
 * body browser is stretched between `top` and `bottom` — so there is no single
 * CSS rule that collapses all of them. What they do have in common is a real
 * measured height at any moment, so this animates `height` explicitly: read the
 * current height, pin it, then transition to the header's height and back.
 *
 * Pinning `height` also settles the browser panel's over-constrained case for
 * free. With `top`, `bottom` and `height` all set, CSS drops `bottom`, so the
 * panel follows the animation instead of staying stretched — and clearing
 * `height` again hands it straight back to the layout in main.ts.
 */

const DURATION_MS = 260;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface Collapsible {
  readonly collapsed: boolean;
  toggle(): void;
  /** Re-measure while collapsed, after the header itself changes size. */
  remeasure(): void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** A caret, rather than a text glyph, so it can rotate instead of being swapped. */
function caret(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M2 3.5 5 6.5 8 3.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

class CollapsiblePanel implements Collapsible {
  private isCollapsed = false;
  private timer: number | undefined;
  private readonly button = document.createElement('button');

  constructor(
    private readonly panel: HTMLElement,
    head: HTMLElement,
    private readonly body: HTMLElement,
    private readonly label: string,
  ) {
    const button = this.button;
    button.className = 'chip chip--collapse';
    button.type = 'button';
    button.append(caret());
    head.append(button);

    this.apply(false, false);
    button.addEventListener('click', () => {
      this.toggle();
    });
  }

  get collapsed(): boolean {
    return this.isCollapsed;
  }

  toggle(): void {
    this.apply(!this.isCollapsed, !prefersReducedMotion());
  }

  remeasure(): void {
    if (this.isCollapsed) {
      this.panel.style.height = `${measureCollapsed(this.panel, this.body)}px`;
    }
  }

  private apply(next: boolean, animate: boolean): void {
    this.isCollapsed = next;
    const verb = this.isCollapsed ? 'Expand' : 'Collapse';
    this.button.setAttribute('aria-expanded', String(!this.isCollapsed));
    this.button.setAttribute('aria-label', `${verb} ${this.label}`);
    this.button.title = `${verb} ${this.label}`;
    // Hidden from assistive tech and from tab order, not merely from view: a
    // collapsed panel's search box must not still be focusable.
    this.body.inert = this.isCollapsed;

    if (!animate) {
      this.panel.classList.toggle('is-collapsed', this.isCollapsed);
      this.panel.style.height = this.isCollapsed
        ? `${measureCollapsed(this.panel, this.body)}px`
        : '';
      return;
    }
    this.animateTo(this.isCollapsed);
  }

  /** Transition the panel's height from where it is now to its folded or unfolded height. */
  private animateTo(collapsed: boolean): void {
    const from = this.panel.getBoundingClientRect().height;

    // Work out the destination first, and with the end-state class applied so
    // the margins that close up are accounted for. Measuring has to come before
    // the pin, not after: each measurement forces a layout, and a forced layout
    // at the destination size is what the transition then treats as its start —
    // which silently produces no animation at all.
    let to: number;
    if (collapsed) {
      this.panel.classList.add('is-collapsed');
      to = measureCollapsed(this.panel, this.body);
      this.panel.classList.remove('is-collapsed');
    } else {
      this.panel.classList.remove('is-collapsed');
      this.panel.style.height = '';
      to = this.panel.getBoundingClientRect().height;
    }

    this.panel.style.height = `${from}px`;
    this.panel.classList.add('is-animating');
    // Settle the layout at the starting height, so that is where the transition
    // begins.
    void this.panel.offsetHeight;

    this.panel.classList.toggle('is-collapsed', collapsed);
    this.panel.style.height = `${to}px`;
    this.settle();
  }

  private settle(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.panel.classList.remove('is-animating');
      // Expanded panels give their height back to the stylesheet; collapsed ones
      // keep theirs pinned, since the header height is the whole point.
      if (!this.isCollapsed) {
        this.panel.style.height = '';
      }
    }, DURATION_MS + 30);
  }
}

/**
 * @param panel  the `.panel` element
 * @param head   the row that stays visible
 * @param body   everything that collapses
 * @param label  used for the button's accessible name, e.g. "time controls"
 */
export function makeCollapsible(
  panel: HTMLElement,
  head: HTMLElement,
  body: HTMLElement,
  label: string,
): Collapsible {
  return new CollapsiblePanel(panel, head, body, label);
}

/**
 * Height of the panel with only its header showing — measured by hiding the
 * body and asking, rather than by adding up the header and the padding. The
 * headers differ too much for arithmetic to be safe: two sit inside padded
 * wrappers, and the info panel's is two stacked block elements.
 *
 * `bottom` is neutralised for the measurement because the browser panel is
 * stretched between `top` and `bottom`; left alone it would report the
 * stretched height and the panel would refuse to fold.
 */
function measureCollapsed(panel: HTMLElement, body: HTMLElement): number {
  const prevHeight = panel.style.height;
  const prevBottom = panel.style.bottom;
  const prevDisplay = body.style.display;
  panel.style.height = '';
  panel.style.bottom = 'auto';
  body.style.display = 'none';
  const measured = panel.getBoundingClientRect().height;
  body.style.display = prevDisplay;
  panel.style.bottom = prevBottom;
  panel.style.height = prevHeight;
  return measured;
}
