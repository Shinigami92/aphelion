/**
 * The Time tab: the clock and its transport, doing exactly what the page's
 * time panel does with the same `TimeController` calls.
 *
 * The transport glyphs are built from characters the generated fonts carry;
 * the page's ⏮, ❚❚ and ⏭ are not among them.
 */

import type { TimeController } from '../../core/time.ts';
import type { Tab } from './panel.ts';
import { Container } from '@pmndrs/uikit';
import { formatUtcDate, formatUtcTime } from '../../astro/calendar.ts';
import { LiveText } from './live-text.ts';
import { COLOR } from './theme.ts';
import { Button, row, title } from './widgets.ts';

function transport(time: TimeController): Button[] {
  const running = (direction: 1 | -1): boolean => !time.paused && time.direction === direction;
  return [
    new Button('|◀', () => {
      time.stepOnePreset(-1);
    }),
    new Button(
      '◀',
      () => {
        time.setDirection(-1);
        time.setPaused(false);
      },
      { grow: true, active: () => running(-1) },
    ),
    new Button(
      'II',
      () => {
        time.togglePause();
      },
      { grow: true, active: () => time.paused },
    ),
    new Button(
      '▶',
      () => {
        time.setDirection(1);
        time.setPaused(false);
      },
      { grow: true, active: () => running(1) },
    ),
    new Button('▶|', () => {
      time.stepOnePreset(1);
    }),
  ];
}

function rateButtons(time: TimeController): Button[] {
  return [
    new Button('slower', () => {
      time.slower();
    }),
    new Button('faster', () => {
      time.faster();
    }),
    new Button('now', () => {
      time.setNow();
      time.resetRate();
    }),
  ];
}

export function createTimeTab(time: TimeController): Tab {
  const date = new LiveText('', { fontFamily: 'mono', fontSize: 26 });
  const clock = new LiveText('', { fontFamily: 'mono', fontSize: 26, color: COLOR.accent });
  const rate = new LiveText('', { fontFamily: 'mono', fontSize: 14, color: COLOR.textDim });
  const note = new LiveText('', { fontSize: 12, color: COLOR.warn });

  const readout = new Container({ flexDirection: 'row', gap: 14, alignItems: 'flex-end' });
  readout.add(
    date.node,
    clock.node,
    new LiveText('UTC', { fontSize: 11, color: COLOR.textFaint }).node,
  );

  const buttons = transport(time);
  const rates = rateButtons(time);
  const node = new Container({ flexDirection: 'column', gap: 12 });
  node.add(
    title('Coordinated universal time'),
    readout,
    row(buttons),
    rate.node,
    row(rates),
    note.node,
  );

  return {
    name: 'Time',
    node,
    refresh: () => {
      date.set(formatUtcDate(time.jdUtc));
      clock.set(formatUtcTime(time.jdUtc));
      rate.set(time.rateLabel);
      note.set(time.precisionNote ?? '');
      for (const button of buttons) {
        button.refresh();
      }
    },
  };
}
