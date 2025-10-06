import type { SKRSContext2D } from '@napi-rs/canvas';

import type { FrameProcessorOperation, FrameWithImageData } from '../../gif/types.js';

export class SaturationOperation implements FrameProcessorOperation {
  public readonly name = 'saturation';

  public constructor(private readonly factor: number) {}

  public async apply(context: SKRSContext2D, frame: FrameWithImageData): Promise<void> {
    if (this.factor === 1) {
      return;
    }

    context.filter = `saturate(${this.factor})`;
    context.drawImage(context.canvas, 0, 0);
    context.filter = 'none';
    void frame;
  }
}
