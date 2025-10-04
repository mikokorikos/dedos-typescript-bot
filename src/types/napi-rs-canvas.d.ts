declare module '@napi-rs/canvas' {
  export type CanvasImageSource = unknown;

  export interface CanvasGradient {
    addColorStop(offset: number, color: string): void;
  }

  export interface SKRSContext2D {
    canvas: { width: number; height: number };
    fillStyle: unknown;
    strokeStyle: unknown;
    font: string;
    shadowColor: string;
    shadowBlur: number;
    textAlign: string;
    textBaseline: string;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
    closePath(): void;
    fill(): void;
    stroke(): void;
    fillRect(x: number, y: number, width: number, height: number): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
    save(): void;
    restore(): void;
    clip(): void;
    drawImage(
      image: CanvasImageSource,
      dx: number,
      dy: number,
      dWidth?: number,
      dHeight?: number,
    ): void;
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient;
    createPattern(image: CanvasImageSource, repetition: string | null): unknown;
    measureText(text: string): { width: number };
    fillText(text: string, x: number, y: number): void;
    strokeText(text: string, x: number, y: number): void;
  }

  export interface SKRSCanvas {
    width: number;
    height: number;
    getContext(type: '2d'): SKRSContext2D;
    toBuffer(mimeType?: string): Buffer;
  }

  export interface SKRSImage {
    width: number;
    height: number;
  }

  export function createCanvas(width: number, height: number): SKRSCanvas;
  export function loadImage(source: string | Buffer): Promise<SKRSImage>;
}
