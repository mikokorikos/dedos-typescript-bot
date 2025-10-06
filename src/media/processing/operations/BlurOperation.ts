import type { SKRSContext2D } from '@napi-rs/canvas';

import type { FrameProcessorOperation, FrameWithImageData } from '../../gif/types.js';

export class BlurOperation implements FrameProcessorOperation {
  public readonly name = 'blur';

  public constructor(private readonly radius: number) {}

  public async apply(context: SKRSContext2D, frame: FrameWithImageData): Promise<void> {
    if (this.radius <= 0) {
      return;
    }

    context.filter = `blur(${this.radius}px)`;
    context.drawImage(context.canvas, 0, 0);
    context.filter = 'none';
    void frame;
  }
}
