import { loadImage } from '@napi-rs/canvas';
import type { Image, SKRSContext2D } from '@napi-rs/canvas';

import type { FrameProcessorOperation, FrameWithImageData } from '../../gif/types.js';

export interface OverlayImageOptions {
  sourceUrl: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  opacity?: number;
}

export class OverlayImageOperation implements FrameProcessorOperation {
  public readonly name = 'overlay-image';
  private readonly options: OverlayImageOptions;
  private loadedImagePromise?: Promise<Image>;

  public constructor(options: OverlayImageOptions) {
    this.options = options;
  }

  public async apply(context: SKRSContext2D, frame: FrameWithImageData): Promise<void> {
    const image = await this.getImage();
    const { x, y, width, height, opacity = 1 } = this.options;

    context.save();
    context.globalAlpha = opacity;
    context.drawImage(image, x, y, width ?? image.width, height ?? image.height);
    context.restore();
    void frame;
  }

  private getImage(): Promise<Image> {
    if (!this.loadedImagePromise) {
      this.loadedImagePromise = loadImage(this.options.sourceUrl);
    }

    return this.loadedImagePromise;
  }
}
