/**
 * The slice of msdf-bmfont-xml's programmatic API the font stage uses. The
 * package ships no types of its own.
 */
declare module 'msdf-bmfont-xml' {
  interface GenerateOptions {
    filename?: string;
    outputType?: 'json' | 'xml' | 'txt';
    fieldType?: 'msdf' | 'sdf' | 'psdf';
    fontSize?: number;
    distanceRange?: number;
    textureSize?: [number, number];
    texturePadding?: number;
    smartSize?: boolean;
    pot?: boolean;
    charset?: string | string[];
  }

  interface GeneratedTexture {
    filename: string;
    texture: Buffer;
  }

  interface GeneratedFont {
    filename: string;
    data: string;
  }

  type Callback = (error: Error | null, textures: GeneratedTexture[], font: GeneratedFont) => void;

  function generateBMFont(
    font: string | Buffer,
    options: GenerateOptions,
    callback: Callback,
  ): void;

  export default generateBMFont;
}
