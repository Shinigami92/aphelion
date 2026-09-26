/** The keyboard and touch reference, opened with H or the "?" chip. */

import { el } from './dom.ts';

const KEY_HELP: Array<[string, Array<[string, string]>]> = [
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
];

/**
 * The same reference for a touch screen, where the key map is no use at all.
 *
 * Not a translation of the keyboard list: a phone genuinely cannot reach some of
 * it (free flight, render quality), and other entries collapse into one gesture,
 * so this describes what a finger can actually do rather than pretending the two
 * are equivalent.
 */
const TOUCH_HELP: Array<[string, Array<[string, string]>]> = [
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
];

/** One reference table as grouped key/description rows. */
function referenceColumns(
  table: Array<[string, Array<[string, string]>]>,
  className: string,
): HTMLElement {
  const cols = el('div', `help__cols ${className}`);
  for (const [group, rows] of table) {
    cols.append(el('div', 'help__group', group));
    for (const [key, desc] of rows) {
      const row = el('div', 'help__row');
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      row.append(kbd, el('span', 'help__desc', desc));
      cols.append(row);
    }
  }
  return cols;
}

/** One credit, optionally ending in an external link. */
function creditLine(text: string, link?: { label: string; href: string }): HTMLElement {
  const row = el('div', 'help__credit', text);
  if (link) {
    const a = document.createElement('a');
    a.href = link.href;
    a.textContent = link.label;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    row.append(' ', a);
  }
  return row;
}

/** The data and imagery credits, and the repository link when there is one. */
function creditsBlock(repoUrl: string | undefined): HTMLElement {
  const credits = el('div', 'help__credits');
  credits.append(el('div', 'help__group', 'Data and imagery'));

  credits.append(
    creditLine('Planetary and dwarf planet maps by Solar System Scope, used under CC BY 4.0 —', {
      label: 'solarsystemscope.com/textures',
      href: 'https://www.solarsystemscope.com/textures/',
    }),
    creditLine(
      'Io, Europa, Ganymede, Callisto and Enceladus mosaics courtesy NASA / JPL-Caltech / USGS Astrogeology.',
    ),
    creditLine(
      'Planetary and satellite ephemerides from JPL Solar System Dynamics; minor planet orbits from the IAU Minor Planet Center; lunar theory after Meeus.',
    ),
    creditLine(
      'The four dwarf planet maps are artistic, and ~450 small bodies have synthesised surfaces — no resolved imagery of them exists.',
    ),
  );
  if (repoUrl !== undefined && repoUrl !== '') {
    credits.append(
      creditLine('Source, full provenance and licences —', {
        label: repoUrl.replace(/^https?:\/\//u, ''),
        href: repoUrl,
      }),
    );
  }
  return credits;
}

export class HelpOverlay {
  constructor(
    private host: HTMLElement,
    repoUrl?: string,
  ) {
    const panel = el('div', 'help__panel');
    panel.append(el('div', 'help__title', 'Aphelion'));
    panel.append(
      el(
        'div',
        'help__lede',
        'A live model of the solar system: real ephemerides for the Sun, eight planets, 459 satellites, five dwarf planets and 221 catalogued minor planets, plus statistically generated asteroid and Kuiper belts. Everything runs offline.',
      ),
    );
    // Both references are built and the stylesheet shows one, so switching
    // layout — or just turning the phone — never leaves the wrong list up.
    panel.append(referenceColumns(KEY_HELP, 'help__cols--keys'));
    panel.append(referenceColumns(TOUCH_HELP, 'help__cols--touch'));

    // Attribution lives in the running app, not only in the repository's
    // ATTRIBUTION.md: the Solar System Scope maps are CC BY 4.0, and someone
    // using a deployed build never sees the source tree.
    panel.append(creditsBlock(repoUrl));

    // Same treatment as the two reference lists: both hints exist and the
    // stylesheet picks one, so the overlay never tells a phone to press Esc.
    // Tapping anywhere does close it — the handler below is on the backdrop and
    // clicks from the panel bubble up to it — so the touch wording is accurate
    // rather than merely a softer lie.
    const close = el('div', 'help__close');
    close.append(el('span', 'help__close--keys', 'press H, ? or Esc to close'));
    close.append(el('span', 'help__close--touch', 'tap anywhere to close'));
    panel.append(close);
    this.host.append(panel);
    this.host.addEventListener('click', () => {
      this.hide();
    });
  }

  get visible(): boolean {
    // `hidden` can also be 'until-found', which still hides the element.
    return this.host.hidden === false;
  }

  show(): void {
    this.host.hidden = false;
  }

  hide(): void {
    this.host.hidden = true;
  }

  toggle(): void {
    this.host.hidden = this.host.hidden === false;
  }
}
