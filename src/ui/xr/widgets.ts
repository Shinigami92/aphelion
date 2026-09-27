/**
 * The in-headset UI's building blocks, made from plain uikit containers and
 * text rather than a component kit, so they carry Aphelion's look instead of
 * someone else's.
 */

import { Container, Text } from '@pmndrs/uikit';
import { LiveText } from './live-text.ts';
import { COLOR, TITLE } from './theme.ts';

/** A section title: small, letter-spaced capitals. */
export function title(text: string): Text {
  return new Text({ text: text.toUpperCase(), flexShrink: 0, ...TITLE });
}

/** Options for a button. */
export interface ButtonOptions {
  /** When it returns true, the button shows itself as the current choice. */
  active?: () => boolean;
  fontSize?: number;
  /** Grow to share a row with its siblings. */
  grow?: boolean;
  fontFamily?: string;
}

/**
 * A pressable surface with a label, lit in the accent colour while it is the
 * active choice — the same states as `.btn` and `.btn--active` on the page.
 */
export class Button {
  readonly node: Container;
  private readonly label: LiveText;
  private active = false;

  constructor(
    text: string,
    onClick: () => void,
    private readonly options: ButtonOptions = {},
  ) {
    this.label = new LiveText(text, {
      fontSize: options.fontSize ?? 13,
      color: COLOR.textDim,
      fontFamily: options.fontFamily,
    });
    this.node = new Container({
      flexGrow: options.grow === true ? 1 : 0,
      paddingX: 10,
      paddingY: 7,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: COLOR.border,
      backgroundColor: COLOR.surface,
      alignItems: 'center',
      justifyContent: 'center',
      hover: { backgroundColor: COLOR.surfaceHover, borderColor: COLOR.borderStrong },
      onClick: (): void => {
        onClick();
      },
    });
    this.node.add(this.label.node);
  }

  setText(text: string): void {
    this.label.set(text);
  }

  /** Re-read the active state; restyles only on a change. */
  refresh(): void {
    const active = this.options.active?.() ?? false;
    if (active === this.active) {
      return;
    }
    this.active = active;
    this.node.setProperties({
      backgroundColor: active ? COLOR.accentDim : COLOR.surface,
      borderColor: active ? COLOR.accent : COLOR.border,
    });
    this.label.node.setProperties({ color: active ? COLOR.accent : COLOR.textDim });
  }
}

/** A row of buttons that share its width, like `.segmented` on the page. */
export function row(buttons: ReadonlyArray<Button>, gap = 4): Container {
  const node = new Container({ flexDirection: 'row', gap, flexShrink: 0 });
  for (const button of buttons) {
    node.add(button.node);
  }
  return node;
}
