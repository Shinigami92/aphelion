/** The clock and the transport bar: date entry, play, reverse, step, rate. */

import type { TimeController } from '../../core/time.ts';
import { formatUtcDate, formatUtcTime } from '../../astro/timescales.ts';
import { RATE_PRESETS } from '../../core/time.ts';
import { el } from './dom.ts';

export class TimePanel {
  private clock = el('div', 'clock');
  private dateSpan = el('span', 'clock__date');
  private timeSpan = el('span', 'clock__time');
  private input = el('input', 'clock-input');
  private hint = el('div', 'clock__hint');
  private playBtn = el('button', 'btn btn--icon btn--play');
  private reverseBtn = el('button', 'btn btn--icon', '◀');
  private forwardBtn = el('button', 'btn btn--icon', '▶');
  private stepBackBtn = el('button', 'btn btn--icon', '⏮');
  private stepFwdBtn = el('button', 'btn btn--icon', '⏭');
  private nowBtn = el('button', 'btn', 'now');
  private rateLabel = el('div', 'rate__label');
  private rateSlider = el('input', '');
  private note = el('div', 'note');

  /** The row that survives collapsing, and everything that does not. */
  head!: HTMLElement;
  body!: HTMLElement;

  private editing = false;
  private lastDate = '';
  private lastTime = '';
  private lastRate = '';
  private lastNote = '';

  constructor(
    private host: HTMLElement,
    private time: TimeController,
    private onHelp: () => void,
  ) {
    this.build();
  }

  private build(): void {
    const title = el('div', 'panel__title');
    title.append(el('span', undefined, 'Coordinated Universal Time'));

    // The keyboard map was reachable only by pressing H, which nobody discovers
    // on their own — this is the affordance for everyone who reaches for a mouse.
    const helpChip = el('button', 'chip', '?');
    helpChip.title = 'Keyboard map and credits (H)';
    helpChip.setAttribute('aria-label', 'Show the keyboard map');
    helpChip.addEventListener('click', () => {
      this.onHelp();
    });
    title.append(helpChip);

    this.host.append(title);
    this.head = title;
    const body = el('div', 'panel__body');
    this.host.append(body);
    this.body = body;

    this.clock.append(this.dateSpan, document.createTextNode('  '), this.timeSpan);
    const zone = el('span', 'clock__zone', 'UTC');
    this.clock.append(zone);
    this.clock.title = 'Click to type a date and time';
    this.clock.addEventListener('click', () => {
      this.beginEdit();
    });
    body.append(this.clock);

    this.input.style.display = 'none';
    this.input.spellcheck = false;
    this.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        this.commitEdit();
      } else if (ev.key === 'Escape') {
        this.cancelEdit();
      }
      ev.stopPropagation();
    });
    this.input.addEventListener('blur', () => {
      this.cancelEdit();
    });
    // Escape is not on a phone's keyboard, but the blur handler above means
    // tapping away already cancels — so the touch wording describes what is
    // actually there rather than a key that is not.
    this.hint.append(
      el('span', 'help__close--keys', 'YYYY-MM-DD HH:MM:SS — Enter to set, Esc to cancel'),
      el('span', 'help__close--touch', 'YYYY-MM-DD HH:MM:SS — Return to set, tap away to cancel'),
    );
    this.hint.style.display = 'none';
    body.append(this.input, this.hint);

    const transport = el('div', 'transport');
    this.stepBackBtn.title = 'Step back one rate unit (,)';
    this.reverseBtn.title = 'Run time backwards (J)';
    this.playBtn.title = 'Pause / resume (Space)';
    this.forwardBtn.title = 'Run time forwards (L)';
    this.stepFwdBtn.title = 'Step forward one rate unit (.)';

    this.stepBackBtn.addEventListener('click', () => {
      this.time.stepOnePreset(-1);
    });
    this.reverseBtn.addEventListener('click', () => {
      this.time.setDirection(-1);
      this.time.setPaused(false);
    });
    this.playBtn.addEventListener('click', () => {
      this.time.togglePause();
    });
    this.forwardBtn.addEventListener('click', () => {
      this.time.setDirection(1);
      this.time.setPaused(false);
    });
    this.stepFwdBtn.addEventListener('click', () => {
      this.time.stepOnePreset(1);
    });

    transport.append(
      this.stepBackBtn,
      this.reverseBtn,
      this.playBtn,
      this.forwardBtn,
      this.stepFwdBtn,
    );
    const spacer = el('div');
    spacer.style.flex = '1';
    transport.append(spacer, this.nowBtn);
    this.nowBtn.title = 'Jump to the current moment (N)';
    this.nowBtn.addEventListener('click', () => {
      this.time.setNow();
      this.time.resetRate();
    });
    body.append(transport);

    const rate = el('div', 'rate');
    this.rateSlider.type = 'range';
    this.rateSlider.min = '0';
    this.rateSlider.max = String(RATE_PRESETS.length - 1);
    this.rateSlider.step = '1';
    this.rateSlider.value = '0';
    this.rateSlider.title = 'Time rate ([ and ])';
    this.rateSlider.addEventListener('input', () => {
      this.time.setRateIndex(Number(this.rateSlider.value));
    });
    rate.append(this.rateLabel, this.rateSlider);
    body.append(rate);
    body.append(this.note);
  }

  private beginEdit(): void {
    if (this.editing) {
      return;
    }
    this.editing = true;
    this.input.value = `${formatUtcDate(this.time.jdUtc)} ${formatUtcTime(this.time.jdUtc)}`;
    this.clock.style.display = 'none';
    this.input.style.display = 'block';
    this.hint.style.display = 'block';
    this.input.focus();
    this.input.select();
  }

  private commitEdit(): void {
    if (this.time.setFromText(this.input.value)) {
      this.endEdit();
    } else {
      this.input.classList.add('clock-input--invalid');
      setTimeout(() => {
        this.input.classList.remove('clock-input--invalid');
      }, 900);
    }
  }

  private cancelEdit(): void {
    if (this.editing) {
      this.endEdit();
    }
  }

  private endEdit(): void {
    this.editing = false;
    this.input.style.display = 'none';
    this.hint.style.display = 'none';
    this.clock.style.display = 'block';
    this.input.blur();
  }

  /** Called every frame; only writes to the DOM when a value actually changes. */
  update(): void {
    if (!this.editing) {
      const date = formatUtcDate(this.time.jdUtc);
      const clock = formatUtcTime(this.time.jdUtc);
      if (date !== this.lastDate) {
        this.dateSpan.textContent = date;
        this.lastDate = date;
      }
      if (clock !== this.lastTime) {
        this.timeSpan.textContent = clock;
        this.lastTime = clock;
      }
    }

    const label = this.time.rateLabel;
    if (label !== this.lastRate) {
      this.rateLabel.textContent = label;
      this.rateLabel.className =
        this.time.direction < 0 ? 'rate__label rate__label--reverse' : 'rate__label';
      this.playBtn.textContent = this.time.paused ? '▶' : '❚❚';
      this.playBtn.classList.toggle('btn--active', this.time.paused);
      this.reverseBtn.classList.toggle('btn--active', this.time.direction < 0 && !this.time.paused);
      this.forwardBtn.classList.toggle('btn--active', this.time.direction > 0 && !this.time.paused);
      this.lastRate = label;
    }
    if (this.rateSlider.value !== String(this.time.rateIndex)) {
      this.rateSlider.value = String(this.time.rateIndex);
    }

    const note = this.time.precisionNote ?? '';
    if (note !== this.lastNote) {
      this.note.textContent = note;
      this.note.style.display = note ? 'block' : 'none';
      this.lastNote = note;
    }
  }
}
