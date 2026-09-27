/**
 * One row of the Bodies list, reused for whichever row of the model scrolls
 * into it. Every kind of row — a heading, a body, a family, the "and N
 * smaller" line — is the same few nodes restyled, so scrolling and opening
 * rows only rewrites text instead of building nodes, which in a headset is the
 * difference between a smooth list and a stalled frame.
 */

import type { SimBody } from '../../core/system.ts';
import type { ListRow } from './body-list.ts';
import { Container } from '@pmndrs/uikit';
import { LiveText } from './live-text.ts';
import { COLOR, TITLE } from './theme.ts';

const INDENT = 18;

/**
 * Every slot's height, in layout pixels. Uniform so the list can scroll by
 * pixels with plain arithmetic, and generous (about 2.9 cm on a following
 * panel) so a ray can land on a row, or on its arrow, without hunting.
 */
export const ROW_HEIGHT = 38;

/** What a slot needs from its list. */
export interface SlotHost {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  choose: (body: SimBody) => void;
  isSelected: (body: SimBody) => boolean;
}

/** The name text's two looks: a section heading, or a row's name. */
const HEADING_STYLE = { ...TITLE, fontWeight: 'semi-bold' } as const;
const NAME_STYLE = { fontSize: 15, letterSpacing: 0, fontWeight: 'normal' } as const;

export class BodySlot {
  readonly node = new Container({
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    height: ROW_HEIGHT,
  });
  private readonly arrow = new LiveText('', { fontSize: 12, color: COLOR.textDim });
  private readonly toggleCell = new Container({
    width: 34,
    height: 34,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  });
  private readonly dot = new Container({ width: 10, height: 10, borderRadius: 5, flexShrink: 0 });
  private readonly name = new LiveText('', { fontSize: 15 });
  private readonly meta = new LiveText('', {
    fontSize: 12,
    fontFamily: 'mono',
    color: COLOR.textFaint,
  });
  private row: ListRow | null = null;
  private heading = false;

  constructor(private readonly host: SlotHost) {
    this.toggleCell.add(this.arrow.node);
    this.toggleCell.setProperties({
      hover: { backgroundColor: COLOR.surfaceHover },
      onClick: (): void => {
        this.onToggle();
      },
    });
    const main = new Container({
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexGrow: 1,
      alignSelf: 'stretch',
      paddingX: 8,
      borderRadius: 7,
      hover: { backgroundColor: COLOR.surfaceHover },
      onClick: (): void => {
        this.onChoose();
      },
    });
    main.add(this.dot, this.name.node, new Container({ flexGrow: 1 }), this.meta.node);
    this.node.add(this.toggleCell, main);
  }

  /** Show `row`, or nothing past the end of the list. */
  show(row: ListRow | undefined): void {
    this.row = row ?? null;
    this.node.setProperties({ display: row ? 'flex' : 'none' });
    if (!row) {
      return;
    }
    this.setHeading(row.kind === 'heading');
    const depth = row.kind === 'body' ? row.depth : row.kind === 'more' ? 1 : 0;
    // A heading sits low in its row, closer to what it heads; a margin would
    // break the uniform height the list scrolls by.
    this.node.setProperties({
      paddingLeft: depth * INDENT,
      alignItems: row.kind === 'heading' ? 'flex-end' : 'center',
      paddingBottom: row.kind === 'heading' ? 4 : 0,
    });
    const key = row.kind === 'body' || row.kind === 'family' ? row.expandKey : null;
    this.arrow.set(key === null ? '' : this.host.isOpen(key) ? '▼' : '▶');
    const body = row.kind === 'body' ? row.body : null;
    this.dot.setProperties({ display: body ? 'flex' : 'none', backgroundColor: body?.color ?? 0 });
    this.name.set(
      row.kind === 'heading'
        ? row.label.toUpperCase()
        : row.kind === 'body'
          ? row.body.name
          : row.label,
    );
    this.meta.set(row.kind === 'body' || row.kind === 'family' ? row.meta : '');
    this.paint();
  }

  /** Colour the name for the row's kind and whether it is the selection. */
  paint(): void {
    const row = this.row;
    if (!row || row.kind === 'heading') {
      return;
    }
    const colour =
      row.kind === 'body'
        ? this.host.isSelected(row.body)
          ? COLOR.accent
          : COLOR.text
        : row.kind === 'family'
          ? COLOR.textDim
          : COLOR.textFaint;
    this.name.node.setProperties({ color: colour });
  }

  private setHeading(heading: boolean): void {
    if (heading === this.heading) {
      return;
    }
    this.heading = heading;
    this.name.node.setProperties(heading ? HEADING_STYLE : { ...NAME_STYLE, color: COLOR.text });
  }

  private onToggle(): void {
    const row = this.row;
    const key = row?.kind === 'body' || row?.kind === 'family' ? row.expandKey : null;
    if (key !== null) {
      this.host.toggle(key);
    }
  }

  private onChoose(): void {
    const row = this.row;
    if (row?.kind === 'body') {
      this.host.choose(row.body);
    } else if (row?.kind === 'family') {
      this.host.toggle(row.expandKey);
    }
  }
}
