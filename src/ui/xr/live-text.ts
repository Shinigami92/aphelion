/** Text that changes while you watch. */

import { Text } from '@pmndrs/uikit';

/**
 * A text whose content changes while you watch, rewritten only when the
 * string actually differs: every change relayouts the panel it sits in.
 *
 * An empty one is taken out of the layout rather than left as an empty line,
 * and it does not shrink unless asked to: the lists it sits in scroll instead
 * of squeezing it.
 */
export class LiveText {
  readonly node: Text;
  private current: string;

  constructor(
    text: string,
    style: {
      fontSize?: number;
      color?: string;
      fontFamily?: string;
      fontWeight?: 'semi-bold';
      /** Let the text give up width and wrap, for a value beside a label. */
      shrink?: boolean;
      textAlign?: 'left' | 'right';
    } = {},
  ) {
    this.current = text;
    const { shrink = false, ...rest } = style;
    this.node = new Text({
      text,
      fontSize: 13,
      flexShrink: shrink ? 1 : 0,
      display: text === '' ? 'none' : 'flex',
      ...rest,
    });
  }

  set(text: string): void {
    if (text !== this.current) {
      const wasEmpty = this.current === '';
      this.current = text;
      this.node.setProperties({ text });
      if (wasEmpty !== (text === '')) {
        this.node.setProperties({ display: text === '' ? 'none' : 'flex' });
      }
    }
  }
}
