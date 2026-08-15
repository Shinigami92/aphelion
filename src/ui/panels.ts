/**
 * DOM panels: the clock and transport, the body browser, the info panel, the
 * view toggles, the keyboard overlay and the toast.
 *
 * Plain DOM rather than a framework — the whole UI is a few hundred nodes and
 * the render loop already owns the frame budget, so per-frame updates here are
 * hand-written and touch only the text that actually changed.
 */

import { RATE_PRESETS, type TimeController } from '../core/time.ts'
import { formatUtcDate, formatUtcTime } from '../astro/timescales.ts'
import type { SimBody, SolarSystem } from '../core/system.ts'
import { escapeVelocity } from '../core/system.ts'
import { AU_KM } from '../core/constants.ts'
import { swarmSummary } from '../data/belts.ts'
import { RELIEF_EXAGGERATION } from '../data/bodies.ts'
import { reliefFor } from '../data/generated/relief.ts'

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

const fmt = (value: number, digits = 0): string =>
  value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Distance with a unit that suits its magnitude. */
export function formatDistance(km: number): string {
  const abs = Math.abs(km)
  if (abs < 1) return `${fmt(km * 1000, 0)} m`
  if (abs < 10_000) return `${fmt(km, 1)} km`
  if (abs < 1_000_000) return `${fmt(km, 0)} km`
  if (abs < 0.05 * AU_KM) return `${fmt(km / 1000, 0)} thousand km`
  return `${fmt(km / AU_KM, abs / AU_KM < 10 ? 4 : 3)} AU`
}

function formatMass(kg: number): string {
  if (kg >= 1e27) return `${(kg / 1e27).toFixed(3)} × 10²⁷ kg`
  if (kg >= 1e24) return `${(kg / 1e24).toFixed(3)} × 10²⁴ kg`
  if (kg >= 1e21) return `${(kg / 1e21).toFixed(3)} × 10²¹ kg`
  if (kg >= 1e18) return `${(kg / 1e18).toFixed(3)} × 10¹⁸ kg`
  return `${kg.toExponential(3)} kg`
}

function formatDuration(days: number): string {
  const abs = Math.abs(days)
  const sign = days < 0 ? '−' : ''
  if (abs < 1 / 24) return `${sign}${fmt(abs * 1440, 1)} min`
  if (abs < 2) return `${sign}${fmt(abs * 24, 2)} hours`
  if (abs < 800) return `${sign}${fmt(abs, abs < 30 ? 3 : 2)} days`
  return `${sign}${fmt(abs / 365.25, 2)} years`
}

function formatHours(hours: number): string {
  const abs = Math.abs(hours)
  const retro = hours < 0 ? ' (retrograde)' : ''
  if (abs < 48) return `${fmt(abs, 3)} h${retro}`
  return `${fmt(abs / 24, 2)} days${retro}`
}

// ---------------------------------------------------------------------------
// Time panel
// ---------------------------------------------------------------------------

export class TimePanel {
  private clock = el('div', 'clock')
  private dateSpan = el('span', 'clock__date')
  private timeSpan = el('span', 'clock__time')
  private input = el('input', 'clock-input') as HTMLInputElement
  private hint = el('div', 'clock__hint')
  private playBtn = el('button', 'btn btn--icon btn--play')
  private reverseBtn = el('button', 'btn btn--icon', '◀')
  private forwardBtn = el('button', 'btn btn--icon', '▶')
  private stepBackBtn = el('button', 'btn btn--icon', '⏮')
  private stepFwdBtn = el('button', 'btn btn--icon', '⏭')
  private nowBtn = el('button', 'btn', 'now')
  private rateLabel = el('div', 'rate__label')
  private rateSlider = el('input', '') as HTMLInputElement
  private note = el('div', 'note')

  /** The row that survives collapsing, and everything that does not. */
  head!: HTMLElement
  body!: HTMLElement

  private editing = false
  private lastDate = ''
  private lastTime = ''
  private lastRate = ''
  private lastNote = ''

  constructor(
    private host: HTMLElement,
    private time: TimeController,
    private onHelp: () => void,
  ) {
    this.build()
  }

  private build(): void {
    const title = el('div', 'panel__title')
    title.append(el('span', undefined, 'Coordinated Universal Time'))

    // The keyboard map was reachable only by pressing H, which nobody discovers
    // on their own — this is the affordance for everyone who reaches for a mouse.
    const helpChip = el('button', 'chip', '?')
    helpChip.title = 'Keyboard map and credits (H)'
    helpChip.setAttribute('aria-label', 'Show the keyboard map')
    helpChip.addEventListener('click', () => this.onHelp())
    title.append(helpChip)

    this.host.append(title)
    this.head = title
    const body = el('div', 'panel__body')
    this.host.append(body)
    this.body = body

    this.clock.append(this.dateSpan, document.createTextNode('  '), this.timeSpan)
    const zone = el('span', 'clock__zone', 'UTC')
    this.clock.append(zone)
    this.clock.title = 'Click to type a date and time'
    this.clock.addEventListener('click', () => this.beginEdit())
    body.append(this.clock)

    this.input.style.display = 'none'
    this.input.spellcheck = false
    this.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this.commitEdit()
      else if (ev.key === 'Escape') this.cancelEdit()
      ev.stopPropagation()
    })
    this.input.addEventListener('blur', () => this.cancelEdit())
    // Escape is not on a phone's keyboard, but the blur handler above means
    // tapping away already cancels — so the touch wording describes what is
    // actually there rather than a key that is not.
    this.hint.append(
      el('span', 'help__close--keys', 'YYYY-MM-DD HH:MM:SS — Enter to set, Esc to cancel'),
      el('span', 'help__close--touch', 'YYYY-MM-DD HH:MM:SS — Return to set, tap away to cancel'),
    )
    this.hint.style.display = 'none'
    body.append(this.input, this.hint)

    const transport = el('div', 'transport')
    this.stepBackBtn.title = 'Step back one rate unit (,)'
    this.reverseBtn.title = 'Run time backwards (J)'
    this.playBtn.title = 'Pause / resume (Space)'
    this.forwardBtn.title = 'Run time forwards (L)'
    this.stepFwdBtn.title = 'Step forward one rate unit (.)'

    this.stepBackBtn.addEventListener('click', () => this.time.stepOnePreset(-1))
    this.reverseBtn.addEventListener('click', () => {
      this.time.setDirection(-1)
      this.time.setPaused(false)
    })
    this.playBtn.addEventListener('click', () => this.time.togglePause())
    this.forwardBtn.addEventListener('click', () => {
      this.time.setDirection(1)
      this.time.setPaused(false)
    })
    this.stepFwdBtn.addEventListener('click', () => this.time.stepOnePreset(1))

    transport.append(
      this.stepBackBtn,
      this.reverseBtn,
      this.playBtn,
      this.forwardBtn,
      this.stepFwdBtn,
    )
    const spacer = el('div')
    spacer.style.flex = '1'
    transport.append(spacer, this.nowBtn)
    this.nowBtn.title = 'Jump to the current moment (N)'
    this.nowBtn.addEventListener('click', () => {
      this.time.setNow()
      this.time.resetRate()
    })
    body.append(transport)

    const rate = el('div', 'rate')
    this.rateSlider.type = 'range'
    this.rateSlider.min = '0'
    this.rateSlider.max = String(RATE_PRESETS.length - 1)
    this.rateSlider.step = '1'
    this.rateSlider.value = '0'
    this.rateSlider.title = 'Time rate ([ and ])'
    this.rateSlider.addEventListener('input', () => {
      this.time.setRateIndex(Number(this.rateSlider.value))
    })
    rate.append(this.rateLabel, this.rateSlider)
    body.append(rate)
    body.append(this.note)
  }

  private beginEdit(): void {
    if (this.editing) return
    this.editing = true
    this.input.value = `${formatUtcDate(this.time.jdUtc)} ${formatUtcTime(this.time.jdUtc)}`
    this.clock.style.display = 'none'
    this.input.style.display = 'block'
    this.hint.style.display = 'block'
    this.input.focus()
    this.input.select()
  }

  private commitEdit(): void {
    if (this.time.setFromText(this.input.value)) {
      this.endEdit()
    } else {
      this.input.classList.add('clock-input--invalid')
      setTimeout(() => this.input.classList.remove('clock-input--invalid'), 900)
    }
  }

  private cancelEdit(): void {
    if (this.editing) this.endEdit()
  }

  private endEdit(): void {
    this.editing = false
    this.input.style.display = 'none'
    this.hint.style.display = 'none'
    this.clock.style.display = 'block'
    this.input.blur()
  }

  /** Called every frame; only writes to the DOM when a value actually changes. */
  update(): void {
    if (!this.editing) {
      const date = formatUtcDate(this.time.jdUtc)
      const clock = formatUtcTime(this.time.jdUtc)
      if (date !== this.lastDate) {
        this.dateSpan.textContent = date
        this.lastDate = date
      }
      if (clock !== this.lastTime) {
        this.timeSpan.textContent = clock
        this.lastTime = clock
      }
    }

    const label = this.time.rateLabel
    if (label !== this.lastRate) {
      this.rateLabel.textContent = label
      this.rateLabel.className =
        this.time.direction < 0 ? 'rate__label rate__label--reverse' : 'rate__label'
      this.playBtn.textContent = this.time.paused ? '▶' : '❚❚'
      this.playBtn.classList.toggle('btn--active', this.time.paused)
      this.reverseBtn.classList.toggle(
        'btn--active',
        this.time.direction < 0 && !this.time.paused,
      )
      this.forwardBtn.classList.toggle(
        'btn--active',
        this.time.direction > 0 && !this.time.paused,
      )
      this.lastRate = label
    }
    if (this.rateSlider.value !== String(this.time.rateIndex)) {
      this.rateSlider.value = String(this.time.rateIndex)
    }

    const note = this.time.precisionNote ?? ''
    if (note !== this.lastNote) {
      this.note.textContent = note
      this.note.style.display = note ? 'block' : 'none'
      this.lastNote = note
    }
  }
}

// ---------------------------------------------------------------------------
// Body browser
// ---------------------------------------------------------------------------

/** How the moon list under a planet is ordered. */
type MoonSort = 'size' | 'name' | 'distance'

const MOON_SORTS: { mode: MoonSort; label: string; title: string }[] = [
  { mode: 'distance', label: 'distance', title: 'Innermost first, by semi-major axis about its planet' },
  { mode: 'size', label: 'size', title: 'Largest first, by mean radius' },
  { mode: 'name', label: 'name', title: 'Alphabetical, with provisional designations in numeric order' },
]

/** Semi-major axis about the parent, km. Unknown orbits sort to the end. */
const orbitRadius = (moon: SimBody): number => moon.elements?.a ?? Infinity

/** Live distance from the parent, km. */
const localDistance = (body: SimBody): number =>
  Math.hypot(body.localKm.x, body.localKm.y, body.localKm.z)

export class BodyBrowser {
  private search = el('input', 'search') as HTMLInputElement
  private list = el('div', 'browser__list')
  private expanded = new Set<string>()
  private query = ''
  private rows = new Map<string, HTMLElement>()
  private selectedKey: string | null = null
  private sortRow = el('div', 'browser__sort')
  private moonSort: MoonSort = 'distance'
  private sortButtons: { mode: MoonSort; node: HTMLElement }[] = []
  /** What `showLagrange()` read at the last render, so `refresh` can skip. */
  private lagrangeShown = true

  head!: HTMLElement
  body!: HTMLElement

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
    const head = el('div', 'browser__head')
    const title = el('div', 'panel__title')
    title.append(el('span', undefined, 'Bodies'))
    const count = el('span', undefined, String(system.bodies.length))
    count.style.color = 'var(--text-faint)'
    count.style.fontFamily = 'var(--mono)'
    title.append(count)
    head.append(title)

    this.search.placeholder = `Search ${system.bodies.length} bodies…`
    this.search.spellcheck = false
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase()
      this.render()
    })
    this.search.addEventListener('keydown', (ev) => {
      ev.stopPropagation()
      if (ev.key === 'Enter') {
        const first = this.matches()[0]
        if (first) this.onSelect(first)
      } else if (ev.key === 'Escape') {
        this.search.value = ''
        this.query = ''
        this.search.blur()
        this.render()
      }
    })
    // The search box collapses with the list: a hidden panel should not still
    // have a focusable input inside it.
    const body = el('div', 'panel__body')
    body.append(this.search, this.buildSortRow(), this.list)
    this.host.append(head, body)
    // The title row, not its padded wrapper: `.panel__title` is already a flex
    // row with space-between, so the collapse control lands beside the count
    // instead of stacking under it.
    this.head = title
    this.body = body

    this.expanded.add('earth')
    this.lagrangeShown = showLagrange()
    this.render()
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
    const shown = this.showLagrange()
    if (shown === this.lagrangeShown) return
    this.lagrangeShown = shown
    this.render()
  }

  /**
   * The Lagrange points of one planet, or none while the layer is hidden.
   *
   * Every read of `system.lagrange` in this panel goes through here, so the
   * rows, the search results and the "5 Lagrange points" a planet row promises
   * cannot disagree about whether the points exist.
   */
  private lagrangeOf(key: string): SimBody[] {
    return this.lagrangeShown ? this.system.lagrangeOf(key) : []
  }

  /**
   * The moon ordering control.
   *
   * Labelled "Moons" because that is all it touches: the planet and dwarf
   * planet groups are in ephemeris order and search results are ranked by how
   * well they match, so neither has an ordering to offer.
   */
  private buildSortRow(): HTMLElement {
    const row = this.sortRow
    row.append(el('span', 'browser__sort-label', 'Moons'))
    const segmented = el('div', 'segmented')
    for (const option of MOON_SORTS) {
      const btn = el('button', 'btn', option.label)
      btn.title = option.title
      btn.addEventListener('click', () => {
        if (this.moonSort === option.mode) return
        this.moonSort = option.mode
        this.refreshSortRow()
        this.render()
      })
      segmented.append(btn)
      this.sortButtons.push({ mode: option.mode, node: btn })
    }
    row.append(segmented)
    this.refreshSortRow()
    return row
  }

  private refreshSortRow(): void {
    for (const { mode, node } of this.sortButtons) {
      node.classList.toggle('btn--active', mode === this.moonSort)
    }
  }

  focusSearch(): void {
    this.search.focus()
    this.search.select()
  }

  setSelected(body: SimBody): void {
    if (this.selectedKey === body.key) return
    if (this.selectedKey) this.rows.get(this.selectedKey)?.classList.remove('row--selected')
    this.selectedKey = body.key
    const row = this.rows.get(body.key)
    if (row) {
      row.classList.add('row--selected')
      row.scrollIntoView({ block: 'nearest' })
    } else {
      // Reveal it by expanding its parent.
      if (body.parent) {
        this.expanded.add(body.parent.key)
        this.render()
        this.rows.get(body.key)?.classList.add('row--selected')
        this.rows.get(body.key)?.scrollIntoView({ block: 'nearest' })
      }
    }
  }

  private matches(): SimBody[] {
    if (!this.query) return []
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
      .sort((a, b) => {
        // Prefer prefix matches, then bigger bodies.
        const ap = a.name.toLowerCase().startsWith(this.query) ? 0 : 1
        const bp = b.name.toLowerCase().startsWith(this.query) ? 0 : 1
        if (ap !== bp) return ap - bp
        return b.radiusKm - a.radiusKm
      })
      .slice(0, 90)
  }

  private render(): void {
    this.list.textContent = ''
    this.rows.clear()
    this.sortRow.style.display = this.query ? 'none' : 'flex'

    if (this.query) {
      const results = this.matches()
      const group = el('div', 'group')
      group.append(el('div', 'group__head', `${results.length} match${results.length === 1 ? '' : 'es'}`))
      for (const body of results) group.append(this.makeRow(body, 0, body.subtitle))
      this.list.append(group)
      if (results.length === 0) {
        const empty = el('div', 'group__head', 'nothing found')
        this.list.append(empty)
      }
      return
    }

    // Sun
    const sunGroup = el('div', 'group')
    sunGroup.append(this.makeRow(this.system.sun, 0))
    this.list.append(sunGroup)

    // Planets, each expandable to its moons.
    const planets = this.system.sun.children.filter((b) => b.type === 'planet')
    const planetGroup = el('div', 'group')
    planetGroup.append(el('div', 'group__head', 'Planets'))
    for (const planet of planets) {
      planetGroup.append(this.makeRow(planet, 0, this.childCount(planet)))
      if (this.expanded.has(planet.key)) {
        // Lagrange points first: there are always five, and burying them under
        // Saturn's 291 moons would put them past the end of the list.
        for (const point of this.lagrangeOf(planet.key)) {
          planetGroup.append(this.makeRow(point, 1, formatDistance(localDistance(point))))
        }
        for (const moon of this.sortedMoons(planet.key).slice(0, 400)) {
          planetGroup.append(this.makeRow(moon, 1, this.moonMeta(moon)))
        }
      }
    }
    this.list.append(planetGroup)

    // Dwarf planets (Pluto included, with its moons).
    const dwarfs = this.system.sun.children.filter((b) => b.type === 'dwarf')
    const dwarfGroup = el('div', 'group')
    dwarfGroup.append(el('div', 'group__head', 'Dwarf planets'))
    for (const dwarf of dwarfs) {
      dwarfGroup.append(this.makeRow(dwarf, 0, this.moonCount(dwarf)))
      if (this.expanded.has(dwarf.key)) {
        for (const moon of this.sortedMoons(dwarf.key)) {
          dwarfGroup.append(this.makeRow(moon, 1, this.moonMeta(moon)))
        }
      }
    }
    this.list.append(dwarfGroup)

    // Minor planets, grouped by dynamical family.
    const minor = this.system.sun.children.filter((b) => b.type === 'asteroid')
    const families = new Map<string, SimBody[]>()
    for (const body of minor) {
      const list = families.get(body.subtitle)
      if (list) list.push(body)
      else families.set(body.subtitle, [body])
    }
    const minorGroup = el('div', 'group')
    minorGroup.append(el('div', 'group__head', `Minor planets (${minor.length})`))
    for (const [family, bodies] of families) {
      const key = `family:${family}`
      const header = el('div', 'row')
      header.append(el('span', 'row__toggle', this.expanded.has(key) ? '▾' : '▸'))
      const name = el('span', 'row__name', family)
      name.style.color = 'var(--text-dim)'
      header.append(name, el('span', 'row__meta', String(bodies.length)))
      header.addEventListener('click', () => {
        if (this.expanded.has(key)) this.expanded.delete(key)
        else this.expanded.add(key)
        this.render()
      })
      minorGroup.append(header)
      if (this.expanded.has(key)) {
        for (const body of bodies.sort((a, b) => b.radiusKm - a.radiusKm)) {
          minorGroup.append(this.makeRow(body, 1, `${fmt(body.radiusKm * 2, 0)} km`))
        }
      }
    }
    this.list.append(minorGroup)

    if (this.selectedKey) this.rows.get(this.selectedKey)?.classList.add('row--selected')
  }

  /**
   * The moons of one body in the chosen order.
   *
   * `moonsOf` hands back a fresh array already sorted largest first, so sorting
   * in place is safe and the size case needs no work at all.
   */
  private sortedMoons(key: string): SimBody[] {
    const moons = this.system.moonsOf(key)
    if (this.moonSort === 'name') {
      // Numeric collation so that S/2004 S 9 precedes S/2004 S 24 rather than
      // following it — half of Saturn's family is still provisional.
      return moons.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
    }
    if (this.moonSort === 'distance') {
      // Semi-major axis rather than where the moon happens to be right now: a
      // live distance would reshuffle the list under the cursor every frame.
      return moons.sort((a, b) => orbitRadius(a) - orbitRadius(b))
    }
    return moons
  }

  /** The figure on the right of a moon row is whatever the list is ordered by. */
  private moonMeta(moon: SimBody): string {
    if (this.moonSort !== 'distance') return `${fmt(moon.radiusKm, 0)} km`
    const a = moon.elements?.a
    return a === undefined ? '' : formatDistance(a)
  }

  private moonCount(body: SimBody): string {
    const n = body.children.filter((c) => c.type === 'moon').length
    return n ? `${n} moon${n === 1 ? '' : 's'}` : ''
  }

  /**
   * What a planet row promises when you open it.
   *
   * Moons if it has any, otherwise its Lagrange points — Mercury and Venus have
   * no moons at all, and before the points existed their rows had nothing to
   * expand and so carried no chevron.
   */
  private childCount(body: SimBody): string {
    const moons = this.moonCount(body)
    if (moons) return moons
    const points = this.lagrangeOf(body.key).length
    return points ? `${points} Lagrange points` : ''
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
    if (body.children.some((c) => c.type === 'moon')) return true
    return body.type === 'planet' && this.lagrangeOf(body.key).length > 0
  }

  private makeRow(body: SimBody, depth: number, meta?: string): HTMLElement {
    const row = el('div', `row${depth === 1 ? ' row--child' : depth === 2 ? ' row--grandchild' : ''}`)

    if (this.expandable(body) && depth === 0) {
      const toggle = el('span', 'row__toggle', this.expanded.has(body.key) ? '▾' : '▸')
      toggle.addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (this.expanded.has(body.key)) this.expanded.delete(body.key)
        else this.expanded.add(body.key)
        this.render()
      })
      row.append(toggle)
    } else if (depth === 0) {
      row.append(el('span', 'row__toggle', ''))
    }

    const swatch = el('span', 'row__swatch')
    swatch.style.background = `#${body.color.toString(16).padStart(6, '0')}`
    swatch.style.color = `#${body.color.toString(16).padStart(6, '0')}`
    row.append(swatch, el('span', 'row__name', body.name))
    if (meta) row.append(el('span', 'row__meta', meta))

    row.addEventListener('click', () => this.onSelect(body))
    this.rows.set(body.key, row)
    return row
  }
}

// ---------------------------------------------------------------------------
// Info panel
// ---------------------------------------------------------------------------

export class InfoPanel {
  private nameEl = el('h2', 'info__name')
  private subEl = el('div', 'info__sub')
  private badgeEl = el('div', 'badge')
  private blurbEl = el('p', 'info__blurb')
  private noteEl = el('div', 'info__note')
  private liveFacts = el('div', 'facts')
  private physFacts = el('div', 'facts')
  private orbitFacts = el('div', 'facts')
  private compositionEl = el('div', 'facts')
  private ringsEl = el('div', 'rings')

  private current: SimBody | null = null

  head = el('div', 'info__head')
  body = el('div', 'panel__body')

  constructor(private host: HTMLElement) {
    // This panel has no title row of its own; the body's name and subtitle are
    // its heading, so they are what stays visible when it collapses. Reading
    // "Mimas — Saturn I" off a shut panel is more use than the word "Body".
    this.head.append(this.nameEl, this.subEl)
    this.host.append(this.head, this.body)
    this.body.append(
      this.badgeEl,
      this.noteEl,
      this.blurbEl,
      el('div', 'section', 'Right now'),
      this.liveFacts,
      el('div', 'section', 'Physical'),
      this.physFacts,
      el('div', 'section', 'Orbit'),
      this.orbitFacts,
      el('div', 'section', 'Composition'),
      this.compositionEl,
      this.ringsEl,
    )
  }

  /** Rebuild the static parts when the selection changes. */
  setBody(body: SimBody, system: SolarSystem): void {
    this.current = body
    this.nameEl.textContent = body.name
    this.subEl.textContent = body.subtitle

    const flags: string[] = []
    if (body.radiusEstimated) flags.push('size estimated')
    // "surface synthesised" is a statement about imagery we do not have. A
    // Lagrange point has no surface to have imagery of.
    if (!body.textureFile && body.type !== 'lagrange') flags.push('surface synthesised')
    if (body.type === 'lagrange') flags.push('massless point — nothing is drawn here')
    if (body.sat?.frame === 'laplace') flags.push('Laplace-plane elements')
    this.badgeEl.textContent = flags.join(' · ')
    this.badgeEl.style.display = flags.length ? 'inline-block' : 'none'

    const note = body.note ?? ''
    this.noteEl.textContent = note
    this.noteEl.style.display = note ? 'block' : 'none'

    const blurb = body.spec?.facts.blurb ?? ''
    this.blurbEl.textContent = blurb
    this.blurbEl.style.display = blurb ? 'block' : 'none'

    this.buildPhysical(body)
    this.buildOrbit(body, system)
    this.buildComposition(body)
  }

  private rowsInto(target: HTMLElement, rows: [string, string, boolean?][]): void {
    target.textContent = ''
    for (const [key, value, wrap] of rows) {
      if (!value) continue
      target.append(el('div', 'facts__key', key))
      target.append(el('div', `facts__val${wrap ? ' facts__val--wrap' : ''}`, value))
    }
  }

  /**
   * A Lagrange point's own facts.
   *
   * It shares no field with a body: it has no mass, no radius, no surface and
   * no orbit of its own, so the "Physical" and "Orbit" sections are filled from
   * the *pair* instead. The nominal radius the camera frames it by is
   * deliberately not shown — it is a viewing convention, and printing it as a
   * measurement is exactly the kind of convincing-but-wrong number this panel
   * exists to avoid.
   */
  private buildLagrange(body: SimBody): void {
    const info = body.lagrange!
    const planet = info.secondary

    this.rowsInto(this.physFacts, [
      ['Point', `${info.id} of ${info.primary.name}–${planet.name}`],
      ['Family', info.collinear ? 'collinear' : 'triangular (equilateral)'],
      [
        'Stability',
        info.collinear
          ? 'unstable — a spacecraft here must station-keep'
          : 'stable — material collects and stays',
        true,
      ],
      ['Mass ratio', `μ = ${info.massRatio.toExponential(3)}`],
      [`Hill radius of ${planet.name}`, formatDistance(info.hillKm)],
    ])

    this.rowsInto(this.orbitFacts, [
      // Not "orbits": it is carried round by the pair, one turn for one turn of
      // the planet, which is the whole reason the configuration holds together.
      ['Co-orbits with', planet.name],
      ['Period', formatDuration(body.periodDays)],
      [
        'Geometry',
        info.collinear
          ? `on the ${info.primary.name}–${planet.name} line`
          : `60° ${info.id === 'L4' ? 'ahead of' : 'behind'} ${planet.name}, equidistant from both`,
        true,
      ],
      ['Solved for', 'the circular restricted three-body problem', true],
    ])
  }

  private buildPhysical(body: SimBody): void {
    if (body.type === 'lagrange') {
      this.buildLagrange(body)
      return
    }
    const rows: [string, string, boolean?][] = []
    const facts = body.spec?.facts

    const radius = body.radiusKm
    rows.push(['Mean radius', `${fmt(radius, radius < 100 ? 2 : 1)} km`])
    if (body.flattening > 0.001) {
      rows.push(['Polar radius', `${fmt(radius * (1 - body.flattening), 1)} km`])
      rows.push(['Flattening', `1 / ${fmt(1 / body.flattening, 1)}`])
    }
    // Terrain that has been exaggerated has to say so. The surface is real
    // measured topography, but at explore scale its vertical scale is not, and
    // an unlabelled 12x mountain is precisely the kind of convincing-but-wrong
    // this project keeps having to guard against.
    const relief = reliefFor(body.key)
    if (relief) {
      const factor = RELIEF_EXAGGERATION[body.key] ?? 1
      rows.push([
        'Relief',
        factor > 1
          ? `${relief.credit.split('—')[0]!.trim()}, ×${factor} in explore scale`
          : relief.credit.split('—')[0]!.trim(),
        true,
      ])
    }
    if (facts) {
      rows.push(['Mass', formatMass(facts.mass)])
      rows.push(['Surface gravity', `${facts.gravity.toFixed(2)} m/s²`])
      rows.push(['Escape velocity', `${facts.escapeVelocity.toFixed(2)} km/s`])
      rows.push(['Rotation', formatHours(facts.rotationHours)])
      rows.push(['Axial tilt', `${facts.axialTilt.toFixed(2)}°`])
      rows.push(['Mean temperature', `${fmt(facts.temperatureC, 0)} °C`])
      rows.push(['Albedo', facts.albedo.toFixed(3)])
    } else if (body.sat) {
      if (body.sat.gm && body.sat.gm > 0) {
        // Mass from GM, and gravity/escape velocity from GM and radius.
        const massKg = (body.sat.gm * 1e9) / 6.6743e-11
        rows.push(['Mass', formatMass(massKg)])
        rows.push(['Surface gravity', `${((body.sat.gm / (radius * radius)) * 1000).toFixed(3)} m/s²`])
        rows.push(['Escape velocity', `${escapeVelocity(body.sat.gm, radius).toFixed(3)} km/s`])
      }
      if (body.sat.density) rows.push(['Density', `${body.sat.density.toFixed(3)} g/cm³`])
      rows.push(['Rotation', 'tidally locked'])
    } else if (body.small) {
      rows.push(['Absolute magnitude', `H = ${body.small.h.toFixed(2)}`])
      // Only say "from H" when it really is: a body with a measured radius
      // (SMALL_BODY_RADII) is no longer being sized by its brightness.
      rows.push([
        body.radiusEstimated ? 'Diameter (from H)' : 'Diameter',
        `${fmt(radius * 2, 0)} km`,
      ])
    }
    this.rowsInto(this.physFacts, rows)
  }

  private buildOrbit(body: SimBody, system: SolarSystem): void {
    // Both sections of a Lagrange point are filled together, from the pair.
    if (body.type === 'lagrange') return
    const rows: [string, string, boolean?][] = []
    const elements = body.elements

    if (body.parent) rows.push(['Orbits', body.parent.name])
    if (body.periodDays) rows.push(['Orbital period', formatDuration(body.periodDays)])
    if (elements) {
      rows.push(['Semi-major axis', formatDistance(elements.a)])
      rows.push(['Eccentricity', elements.e.toFixed(5)])
      rows.push(['Inclination', `${((elements.i * 180) / Math.PI).toFixed(3)}°`])
      rows.push(['Periapsis', formatDistance(elements.a * (1 - elements.e))])
      rows.push(['Apoapsis', formatDistance(elements.a * (1 + elements.e))])
      if (body.sat?.frame) {
        rows.push([
          'Reference plane',
          body.sat.frame === 'laplace'
            ? 'local Laplace plane'
            : body.sat.frame === 'equatorial'
              ? 'ICRF equator'
              : 'ecliptic J2000',
        ])
      }
    }
    if (body.spec?.facts.discovered && body.spec.facts.discovered !== 'n/a') {
      rows.push(['Discovered', body.spec.facts.discovered, true])
    }
    const moons = body.children.filter((c) => c.type === 'moon').length
    if (moons) rows.push(['Known moons', String(moons)])
    void system
    this.rowsInto(this.orbitFacts, rows)
  }

  private buildComposition(body: SimBody): void {
    const rows: [string, string, boolean?][] = []
    if (body.spec?.facts.composition) rows.push(['Makeup', body.spec.facts.composition, true])
    if (body.small) rows.push(['Family', body.subtitle, true])
    this.rowsInto(this.compositionEl, rows)

    // Ring names run long ("Main rings (C, B, Cassini division, A, F)"), so they
    // get stacked blocks rather than a key/value grid that would squeeze the
    // numbers into a one-word-per-line column.
    this.ringsEl.textContent = ''
    const rings = body.spec?.rings ?? []
    for (const ring of rings) {
      const block = el('div', 'ring')
      block.append(el('div', 'ring__name', ring.name))
      block.append(
        el('div', 'ring__span', `${fmt(ring.innerKm, 0)} – ${fmt(ring.outerKm, 0)} km`),
      )
      if (ring.note) block.append(el('div', 'ring__note', ring.note))
      this.ringsEl.append(block)
    }

    const hasAny = rows.length > 0 || rings.length > 0
    for (const section of this.host.querySelectorAll('.section')) {
      if (section.textContent === 'Composition') {
        ;(section as HTMLElement).style.display = hasAny ? 'block' : 'none'
      }
    }
  }

  /**
   * Live values that change every frame.
   *
   * `cameraDistanceKm` is a true distance in both scale modes and
   * `cameraRadii` the same figure in radii of the focused body — see
   * updateCameraDistance() in main.ts for why the raw scene distance will not do.
   */
  update(
    system: SolarSystem,
    focus: SimBody,
    cameraDistanceKm: number,
    cameraRadii: number,
  ): void {
    const body = this.current
    if (!body) return

    const rows: [string, string, boolean?][] = []
    const sunKm = system.distanceToSun(body)
    if (body.type !== 'star') {
      rows.push(['Distance from Sun', formatDistance(sunKm)])
      rows.push(['Light travel from Sun', formatLightTime(sunKm)])
    }
    if (body.parent && body.parent.type !== 'star') {
      const localKm = Math.hypot(body.localKm.x, body.localKm.y, body.localKm.z)
      rows.push([`Distance from ${body.parent.name}`, formatDistance(localKm)])
    }
    const earth = system.byKey.get('earth')
    if (earth && body !== earth) {
      const dx = body.helioKm.x - earth.helioKm.x
      const dy = body.helioKm.y - earth.helioKm.y
      const dz = body.helioKm.z - earth.helioKm.z
      const d = Math.hypot(dx, dy, dz)
      // The parent row above has already given this distance for anything that
      // belongs to Earth — the Moon, and all five Lagrange points — so only the
      // light time, which it does not carry, is added on top. Printing the same
      // figure twice under two headings reads as a bug even when both are right.
      if (body.parent !== earth) rows.push(['Distance from Earth', formatDistance(d)])
      rows.push(['Light travel from Earth', formatLightTime(d)])
    }
    if (body.parent) {
      const speed = system.speedKmS(body)
      if (speed > 0) rows.push(['Orbital speed', `${speed.toFixed(3)} km/s`])
    }
    // The camera orbits the focused body, which is not always the selected one:
    // select Titan while orbiting Saturn and a "camera distance" on Titan's
    // panel would be quietly wrong.
    if (body === focus) {
      rows.push(['Camera distance', formatDistance(cameraDistanceKm)])
      // A Lagrange point has no surface to be above and no radius to be
      // measured in, so it gets the distance and nothing else. Its `radiusKm`
      // is only the scale the camera frames it by.
      if (body.type !== 'lagrange') {
        const altitude = cameraDistanceKm - body.radiusKm
        if (altitude > 0) rows.push(['Camera altitude', formatDistance(altitude)])
        rows.push(['Camera range', `${cameraRadii.toFixed(2)} × radius`])
      }
    }

    this.rowsInto(this.liveFacts, rows)
  }
}

function formatLightTime(km: number): string {
  const seconds = km / 299_792.458
  if (seconds < 90) return `${seconds.toFixed(1)} s`
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} min`
  if (seconds < 172_800) return `${(seconds / 3600).toFixed(2)} h`
  return `${(seconds / 86_400).toFixed(2)} days`
}

// ---------------------------------------------------------------------------
// View toggles
// ---------------------------------------------------------------------------

export interface ToggleConfig {
  label: string
  get: () => boolean
  set: (value: boolean) => void
}

export class TogglePanel {
  private items: { config: ToggleConfig; node: HTMLElement }[] = []
  private orbitButtons: HTMLElement[] = []
  private scaleButtons: HTMLElement[] = []

  head!: HTMLElement
  body!: HTMLElement

  constructor(
    private host: HTMLElement,
    toggles: ToggleConfig[],
    private orbits: { get: () => string; set: (mode: 'none' | 'planets' | 'all') => void },
    private scale: { get: () => string; set: (mode: 'true' | 'explore') => void },
    repoUrl?: string,
  ) {
    const title = el('div', 'panel__title')
    title.append(el('span', undefined, 'View'))

    if (repoUrl) {
      const link = document.createElement('a')
      link.className = 'title-link'
      link.href = repoUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = 'GitHub ↗'
      link.title = 'Source, data provenance and licences'
      title.append(link)
    }

    this.host.append(title)
    this.head = title
    const body = el('div', 'panel__body')
    this.host.append(body)
    this.body = body

    const grid = el('div', 'toggles__grid')
    for (const config of toggles) {
      const node = el('div', 'toggle')
      node.append(el('span', 'toggle__box'), el('span', undefined, config.label))
      node.addEventListener('click', () => {
        config.set(!config.get())
        this.refresh()
      })
      grid.append(node)
      this.items.push({ config, node })
    }
    body.append(grid)

    const orbitRow = el('div', 'segmented')
    for (const mode of ['none', 'planets', 'all'] as const) {
      const btn = el('button', 'btn', mode === 'none' ? 'no orbits' : mode)
      btn.addEventListener('click', () => {
        this.orbits.set(mode)
        this.refresh()
      })
      orbitRow.append(btn)
      this.orbitButtons.push(btn)
    }
    body.append(orbitRow)

    const scaleRow = el('div', 'segmented')
    for (const mode of ['explore', 'true'] as const) {
      const btn = el('button', 'btn', mode === 'true' ? 'true scale' : 'explore scale')
      btn.title = mode === 'true' ? 'Everything 1:1 (T)' : 'Bodies enlarged, distances compressed (T)'
      btn.addEventListener('click', () => {
        this.scale.set(mode)
        this.refresh()
      })
      scaleRow.append(btn)
      this.scaleButtons.push(btn)
    }
    body.append(scaleRow)

    this.refresh()
  }

  refresh(): void {
    for (const { config, node } of this.items) {
      node.classList.toggle('toggle--on', config.get())
    }
    const orbitMode = this.orbits.get()
    const modes = ['none', 'planets', 'all']
    this.orbitButtons.forEach((btn, i) => btn.classList.toggle('btn--active', modes[i] === orbitMode))
    const scaleMode = this.scale.get()
    const scaleModes = ['explore', 'true']
    this.scaleButtons.forEach((btn, i) => btn.classList.toggle('btn--active', scaleModes[i] === scaleMode))
  }
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export class Toast {
  private timer: number | null = null

  constructor(private host: HTMLElement) {}

  show(message: string, ms = 1900): void {
    this.host.textContent = message
    this.host.classList.add('toast--show')
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.host.classList.remove('toast--show'), ms) as unknown as number
  }
}

// ---------------------------------------------------------------------------
// Keyboard help
// ---------------------------------------------------------------------------

const KEY_HELP: [string, [string, string][]][] = [
  [
    'Time',
    [
      ['Space', 'pause / resume'],
      ['J / L', 'run backwards / forwards'],
      ['[ / ]', 'slower / faster'],
      [', / .', 'step one unit back / forward'],
      ['N', 'jump to now, real-time'],
      ['click clock', 'type an exact UTC date and time'],
    ],
  ],
  [
    'Moving around',
    [
      ['drag', 'orbit the focused body'],
      ['scroll / pinch', 'zoom in and out'],
      ['shift-drag, right-drag', 'pan'],
      ['W A S D', 'orbit and zoom (or fly, in free mode)'],
      ['arrows', 'orbit'],
      ['+ / −', 'zoom'],
      ['Q / E', 'roll'],
      ['R / F', 'up / down (free mode)'],
      ['Shift', 'move faster'],
      ['Alt', 'move slower, for fine framing'],
      ['V', 'toggle orbit / free flight'],
      ['C', 'point the free camera at the focus'],
    ],
  ],
  [
    'Selection',
    [
      ['click a body', 'select and show its data'],
      ['double-click', 'select and fly to it'],
      ['G', 'go to the selected body'],
      ['Tab / shift-Tab', 'next / previous planet'],
      ['1 – 9', 'Mercury through Pluto'],
      ['0', 'the Sun'],
      ['/', 'search'],
      ['Home', 'frame the whole system'],
    ],
  ],
  [
    'Display',
    [
      ['T', 'toggle true / explore scale'],
      ['O', 'cycle orbit lines'],
      ['B', 'toggle the belts'],
      ['M', 'cycle labels'],
      ['I', 'toggle the atmospheres'],
      ['K', 'toggle the rings'],
      ['X', 'toggle the Lagrange points'],
      ['P', 'cycle render quality'],
      ['H or ?', 'this list'],
    ],
  ],
]

/**
 * The same reference for a touch screen, where the key map is no use at all.
 *
 * Not a translation of the keyboard list: a phone genuinely cannot reach some of
 * it (free flight, render quality), and other entries collapse into one gesture,
 * so this describes what a finger can actually do rather than pretending the two
 * are equivalent.
 */
const TOUCH_HELP: [string, [string, string][]][] = [
  [
    'Moving around',
    [
      ['drag', 'orbit the focused body'],
      ['pinch', 'zoom in and out'],
      ['two-finger drag', 'pan'],
      ['double-tap a body', 'fly to it'],
    ],
  ],
  [
    'Selection',
    [
      ['tap a body', 'select and show its data'],
      ['Bodies tab', 'search and browse all 687'],
      ['Orrery tab', 'tap the map to jump somewhere'],
    ],
  ],
  [
    'Time',
    [
      ['tap the clock', 'type an exact UTC date and time'],
      ['transport row', 'reverse, pause, step and run'],
      ['rate slider', 'from 1 second to 100 years per second'],
    ],
  ],
  [
    'Display',
    [
      ['View tab', 'orbits, labels, belts, rings, atmospheres, Lagrange points'],
      ['explore / true', 'switch the scale model'],
      ['panel headers', 'a chevron folds the clock away'],
    ],
  ],
]

export class HelpOverlay {
  constructor(
    private host: HTMLElement,
    repoUrl?: string,
  ) {
    const panel = el('div', 'help__panel')
    panel.append(el('div', 'help__title', 'Aphelion'))
    panel.append(
      el(
        'div',
        'help__lede',
        'A live model of the solar system: real ephemerides for the Sun, eight planets, 459 satellites, five dwarf planets and 221 catalogued minor planets, plus statistically generated asteroid and Kuiper belts. Everything runs offline.',
      ),
    )
    // Both references are built and the stylesheet shows one, so switching
    // layout — or just turning the phone — never leaves the wrong list up.
    const build = (
      table: [string, [string, string][]][],
      className: string,
    ): HTMLElement => {
      const cols = el('div', `help__cols ${className}`)
      for (const [group, rows] of table) {
        cols.append(el('div', 'help__group', group))
        for (const [key, desc] of rows) {
          const row = el('div', 'help__row')
          const kbd = document.createElement('kbd')
          kbd.textContent = key
          row.append(kbd, el('span', 'help__desc', desc))
          cols.append(row)
        }
      }
      return cols
    }
    panel.append(build(KEY_HELP, 'help__cols--keys'))
    panel.append(build(TOUCH_HELP, 'help__cols--touch'))

    // Attribution lives in the running app, not only in the repository's
    // ATTRIBUTION.md: the Solar System Scope maps are CC BY 4.0, and someone
    // using a deployed build never sees the source tree.
    const credits = el('div', 'help__credits')
    credits.append(el('div', 'help__group', 'Data and imagery'))

    const line = (text: string, link?: { label: string; href: string }): HTMLElement => {
      const row = el('div', 'help__credit', text)
      if (link) {
        const a = document.createElement('a')
        a.href = link.href
        a.textContent = link.label
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        row.append(' ', a)
      }
      return row
    }

    credits.append(
      line('Planetary and dwarf planet maps by Solar System Scope, used under CC BY 4.0 —', {
        label: 'solarsystemscope.com/textures',
        href: 'https://www.solarsystemscope.com/textures/',
      }),
      line(
        'Io, Europa, Ganymede, Callisto and Enceladus mosaics courtesy NASA / JPL-Caltech / USGS Astrogeology.',
      ),
      line(
        'Planetary and satellite ephemerides from JPL Solar System Dynamics; minor planet orbits from the IAU Minor Planet Center; lunar theory after Meeus.',
      ),
      line(
        'The four dwarf planet maps are artistic, and ~450 small bodies have synthesised surfaces — no resolved imagery of them exists.',
      ),
    )
    if (repoUrl) {
      credits.append(line('Source, full provenance and licences —', { label: repoUrl.replace(/^https?:\/\//, ''), href: repoUrl }))
    }
    panel.append(credits)

    // Same treatment as the two reference lists: both hints exist and the
    // stylesheet picks one, so the overlay never tells a phone to press Esc.
    // Tapping anywhere does close it — the handler below is on the backdrop and
    // clicks from the panel bubble up to it — so the touch wording is accurate
    // rather than merely a softer lie.
    const close = el('div', 'help__close')
    close.append(el('span', 'help__close--keys', 'press H, ? or Esc to close'))
    close.append(el('span', 'help__close--touch', 'tap anywhere to close'))
    panel.append(close)
    this.host.append(panel)
    this.host.addEventListener('click', () => this.hide())
  }

  get visible(): boolean {
    return !this.host.hidden
  }

  show(): void {
    this.host.hidden = false
  }

  hide(): void {
    this.host.hidden = true
  }

  toggle(): void {
    this.host.hidden = !this.host.hidden
  }
}

/** Belt composition summary, used in the boot status line. */
export function beltSummaryText(): string {
  const groups = swarmSummary()
  const total = groups.reduce((sum, g) => sum + g.count, 0)
  return `${fmt(total, 0)} belt particles across ${groups.length} populations`
}
