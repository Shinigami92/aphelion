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

const DURATION_MS = 260
const SVG_NS = 'http://www.w3.org/2000/svg'

export interface Collapsible {
  readonly collapsed: boolean
  toggle(): void
  /** Re-measure while collapsed, after the header itself changes size. */
  remeasure(): void
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** A caret, rather than a text glyph, so it can rotate instead of being swapped. */
function caret(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 10 10')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'M2 3.5 5 6.5 8 3.5')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.4')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
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
  const button = document.createElement('button')
  button.className = 'chip chip--collapse'
  button.type = 'button'
  button.append(caret())
  head.append(button)

  let collapsed = false
  let timer: number | undefined

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
  const collapsedHeight = (): number => {
    const prevHeight = panel.style.height
    const prevBottom = panel.style.bottom
    const prevDisplay = body.style.display
    panel.style.height = ''
    panel.style.bottom = 'auto'
    body.style.display = 'none'
    const measured = panel.getBoundingClientRect().height
    body.style.display = prevDisplay
    panel.style.bottom = prevBottom
    panel.style.height = prevHeight
    return measured
  }

  const settle = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      panel.classList.remove('is-animating')
      // Expanded panels give their height back to the stylesheet; collapsed ones
      // keep theirs pinned, since the header height is the whole point.
      if (!collapsed) panel.style.height = ''
    }, DURATION_MS + 30)
  }

  const apply = (next: boolean, animate: boolean): void => {
    collapsed = next
    const verb = collapsed ? 'Expand' : 'Collapse'
    button.setAttribute('aria-expanded', String(!collapsed))
    button.setAttribute('aria-label', `${verb} ${label}`)
    button.title = `${verb} ${label}`
    // Hidden from assistive tech and from tab order, not merely from view: a
    // collapsed panel's search box must not still be focusable.
    body.inert = collapsed

    if (!animate) {
      panel.classList.toggle('is-collapsed', collapsed)
      panel.style.height = collapsed ? `${collapsedHeight()}px` : ''
      return
    }

    const from = panel.getBoundingClientRect().height

    // Work out the destination first, and with the end-state class applied so
    // the margins that close up are accounted for. Measuring has to come before
    // the pin, not after: each measurement forces a layout, and a forced layout
    // at the destination size is what the transition then treats as its start —
    // which silently produces no animation at all.
    let to: number
    if (collapsed) {
      panel.classList.add('is-collapsed')
      to = collapsedHeight()
      panel.classList.remove('is-collapsed')
    } else {
      panel.classList.remove('is-collapsed')
      panel.style.height = ''
      to = panel.getBoundingClientRect().height
    }

    panel.style.height = `${from}px`
    panel.classList.add('is-animating')
    // Settle the layout at the starting height, so that is where the transition
    // begins.
    void panel.offsetHeight

    panel.classList.toggle('is-collapsed', collapsed)
    panel.style.height = `${to}px`
    settle()
  }

  apply(false, false)
  button.addEventListener('click', () => apply(!collapsed, !prefersReducedMotion()))

  return {
    get collapsed() {
      return collapsed
    },
    toggle: () => apply(!collapsed, !prefersReducedMotion()),
    remeasure: () => {
      if (collapsed) panel.style.height = `${collapsedHeight()}px`
    },
  }
}
