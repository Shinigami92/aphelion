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

export const MOBILE_QUERY = '(max-width: 880px)'

export interface MobileTab {
  id: string
  label: string
  panel: HTMLElement
  /** Called when the sheet becomes visible, e.g. to resize a canvas. */
  onShow?: () => void
}

export interface MobileShell {
  readonly active: boolean
  /** Close whatever sheet is open. */
  closeSheet(): void
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
  const bar = document.createElement('nav')
  bar.className = 'tabbar'
  bar.setAttribute('aria-label', 'Panels')

  let openId: string | null = null
  const buttons = new Map<string, HTMLButtonElement>()

  const setOpen = (id: string | null): void => {
    openId = id
    for (const tab of tabs) {
      const on = tab.id === id
      tab.panel.classList.toggle('is-sheet-open', on)
      const button = buttons.get(tab.id)
      button?.classList.toggle('is-active', on)
      button?.setAttribute('aria-expanded', String(on))
      // A closed sheet is off the layout entirely, so its contents cannot be
      // reached by tabbing behind the scene.
      tab.panel.inert = !on
      if (on) tab.onShow?.()
    }
  }

  for (const tab of tabs) {
    const button = document.createElement('button')
    button.className = 'tabbar__btn'
    button.type = 'button'
    button.textContent = tab.label
    button.setAttribute('aria-expanded', 'false')
    // Tapping the open tab again closes it, so the scene can be seen whole
    // without hunting for a dismiss control.
    button.addEventListener('click', () => setOpen(openId === tab.id ? null : tab.id))
    buttons.set(tab.id, button)
    bar.append(button)
  }

  const media = window.matchMedia(MOBILE_QUERY)
  let mobile = false

  const applyMode = (next: boolean): void => {
    if (next === mobile) return
    mobile = next
    document.body.classList.toggle('is-mobile', mobile)
    if (mobile) {
      app.append(bar)
      setOpen(null)
    } else {
      bar.remove()
      // Hand every panel back to the desktop layout: no sheet state, nothing
      // inert, and no leftover open sheet.
      for (const tab of tabs) {
        tab.panel.classList.remove('is-sheet-open')
        tab.panel.inert = false
      }
      openId = null
      for (const button of buttons.values()) {
        button.classList.remove('is-active')
        button.setAttribute('aria-expanded', 'false')
      }
    }
    onModeChange(mobile)
  }

  applyMode(media.matches)
  media.addEventListener('change', (ev) => applyMode(ev.matches))

  return {
    get active() {
      return mobile
    },
    closeSheet: () => setOpen(null),
  }
}
