import { createCanvas } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from 'pino';

import type {
  DecodedFrame,
  FrameProcessorOperation,
  FrameWithImageData,
  GifMetadata,
  ProcessedFrame
} from '../gif/types.js';

export interface FrameProcessorOptions {
  operations?: FrameProcessorOperation[];
  logger: Logger;
}

export class FrameProcessorPipeline {
  private readonly operations: FrameProcessorOperation[];
  private readonly logger: Logger;

  public constructor(options: FrameProcessorOptions) {
    this.operations = options.operations ?? [];
    this.logger = options.logger;
  }

  public async process(frames: DecodedFrame[], metadata: GifMetadata, baseTmpDir?: string): Promise<ProcessedFrame[]> {
    const tmpDirectory = await mkdtemp(join(baseTmpDir ?? tmpdir(), 'gif-frames-'));
    const canvas = createCanvas(metadata.width, metadata.height);
    const context = canvas.getContext('2d') as SKRSContext2D;

    const processed: ProcessedFrame[] = [];
    let presentationTimestampMs = 0;

    for (const frame of frames) {
      context.clearRect(0, 0, metadata.width, metadata.height);
      const imageData = context.createImageData(metadata.width, metadata.height);
      imageData.data.set(frame.bitmap);
      context.putImageData(imageData, 0, 0);

      const frameWithImageData: FrameWithImageData = { ...frame, imageData };

      for (const operation of this.operations) {
        await operation.apply(context, frameWithImageData);
      }

      const fileName = `frame-${frame.index.toString().padStart(5, '0')}.png`;
      const framePath = join(tmpDirectory, fileName);
      const pngBuffer = await canvas.encode('png');
      await writeFile(framePath, pngBuffer);

      const durationMs = frame.delayCentiseconds * 10;
      processed.push({
        index: frame.index,
        presentationTimestampMs,
        durationMs,
        path: framePath
      });

      presentationTimestampMs += durationMs;
    }

    this.logger.debug({ frameCount: processed.length, tmpDirectory }, 'Processed GIF frames');

    return processed;
  }
}
