/**
 * A key/value list, like the page's fact grids, built from a fixed pool of
 * rows that are rewritten in place. Creating and destroying uikit nodes on
 * every selection change is far dearer than retyping a few labels.
 */

import type { FactRow } from '../panels/info-facts.ts';
import { Container } from '@pmndrs/uikit';
import { LiveText } from './live-text.ts';
import { COLOR } from './theme.ts';

interface Slot {
  node: Container;
  key: LiveText;
  value: LiveText;
  shown: boolean;
}

function slot(): Slot {
  const key = new LiveText('', { fontSize: 12, color: COLOR.textDim });
  // The value wraps rather than pushing the row wider than the panel: a few
  // run long ("ETOPO2v2, ×25 in explore scale").
  const value = new LiveText('', {
    fontSize: 12,
    fontFamily: 'mono',
    shrink: true,
    textAlign: 'right',
  });
  const node = new Container({
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    flexShrink: 0,
    display: 'none',
  });
  node.add(key.node, value.node);
  return { node, key, value, shown: false };
}

export class FactList {
  readonly node = new Container({ flexDirection: 'column', gap: 3, flexShrink: 0 });
  private readonly slots: Slot[] = [];

  constructor(size: number) {
    for (let i = 0; i < size; i++) {
      const s = slot();
      this.slots.push(s);
      this.node.add(s.node);
    }
  }

  /** Show `rows`, skipping empty values as the page does; extra rows are dropped. */
  set(rows: ReadonlyArray<FactRow>): void {
    const filled = rows.filter(([, value]) => value !== '');
    this.slots.forEach((s, i) => {
      const row = filled[i];
      if (row !== undefined) {
        s.key.set(row[0]);
        s.value.set(row[1]);
      }
      const shown = row !== undefined;
      if (shown !== s.shown) {
        s.shown = shown;
        s.node.setProperties({ display: shown ? 'flex' : 'none' });
      }
    });
  }
}
