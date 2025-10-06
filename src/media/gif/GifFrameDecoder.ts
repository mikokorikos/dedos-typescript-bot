import { createCanvas } from '@napi-rs/canvas';
import type { ImageData, SKRSContext2D } from '@napi-rs/canvas';
import { decompressFrames, parseGIF } from 'gifuct-js';
import type { DecompressedFrame } from 'gifuct-js';
import { Logger } from 'pino';

import type { DecodedFrame, GifMetadata } from './types.js';

export interface GifFrameDecoderResult {
  frames: DecodedFrame[];
  metadata: GifMetadata;
}

export class GifFrameDecoder {
  public constructor(private readonly logger: Logger) {}

  public decode(buffer: Buffer): GifFrameDecoderResult {
    const gif = parseGIF(buffer);
    const frames = decompressFrames(gif, true) as DecompressedFrame[];
    const { width, height } = gif;

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d') as SKRSContext2D;
    context.clearRect(0, 0, width, height);

    const decodedFrames: DecodedFrame[] = [];
    let durationMs = 0;

    frames.forEach((frame, index) => {
      const delayCentiseconds = frame.delay || 1;
      const delayMs = Math.max(10, delayCentiseconds * 10);

      let previousState: ImageData | undefined;
      if (frame.disposalType === 3) {
        previousState = context.getImageData(0, 0, width, height);
      }

      const patch = context.createImageData(frame.dims.width, frame.dims.height);
      patch.data.set(frame.patch);
      context.putImageData(patch, frame.dims.left, frame.dims.top);

      const rendered = context.getImageData(0, 0, width, height);
      decodedFrames.push({
        index,
        delayCentiseconds,
        width,
        height,
        disposalType: frame.disposalType,
        bitmap: new Uint8ClampedArray(rendered.data)
      });
      durationMs += delayMs;

      switch (frame.disposalType) {
        case 2: {
          context.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
          break;
        }
        case 3: {
          if (previousState) {
            context.putImageData(previousState, 0, 0);
          }
          break;
        }
        default:
          break;
      }
    });

    const loopCount = this.extractLoopCount(gif);

    this.logger.debug({ frameCount: decodedFrames.length, width, height }, 'Decoded GIF frames');

    return {
      frames: decodedFrames,
      metadata: {
        width,
        height,
        frameCount: decodedFrames.length,
        loopCount,
        durationMs
      }
    };
  }

  private extractLoopCount(gif: unknown): number | null {
    const parsed = gif as { frames?: Array<Record<string, unknown>> };
    if (!parsed.frames) {
      return null;
    }

    for (const frame of parsed.frames) {
      const maybeExt = (frame as { type?: string; ext?: Record<string, unknown> }).ext;
      const type = (frame as { type?: string })['type'];
      if (type === 'ext' && maybeExt?.['type'] === 'netscape') {
        const iterations = maybeExt['iterations'] as number | undefined;
        if (typeof iterations === 'number') {
          return iterations === 0 ? Infinity : iterations;
        }
      }
    }

    return null;
  }
}
