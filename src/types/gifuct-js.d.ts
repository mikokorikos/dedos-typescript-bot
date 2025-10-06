declare module 'gifuct-js' {
  export interface ParsedGif {
    frames: Array<Record<string, unknown>>;
    gct?: number[];
    width: number;
    height: number;
  }

  export interface DecompressedFrame {
    dims: { top: number; left: number; width: number; height: number };
    delay: number;
    patch: Uint8ClampedArray;
    disposalType: number;
  }

  export function parseGIF(buffer: ArrayLike<number> | ArrayBuffer): ParsedGif;
  export function decompressFrames(parsedGif: ParsedGif, buildImagePatches: boolean): DecompressedFrame[];
}
