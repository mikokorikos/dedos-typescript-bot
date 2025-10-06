import { performance } from 'node:perf_hooks';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

import type { Logger } from 'pino';

import { GifFrameDecoder } from '../gif/GifFrameDecoder.js';
import { GifRemoteFetcher } from '../gif/GifRemoteFetcher.js';
import type { GifToVideoOptions, GifToVideoResult } from '../gif/types.js';
import { FrameProcessorPipeline } from '../processing/FrameProcessorPipeline.js';
import { VideoEncoder } from '../encoding/VideoEncoder.js';

export interface GifToVideoPipelineConfig {
  logger: Logger;
  fetcher: GifRemoteFetcher;
  decoder: GifFrameDecoder;
}

export class GifToVideoPipeline {
  private readonly logger: Logger;
  private readonly fetcher: GifRemoteFetcher;
  private readonly decoder: GifFrameDecoder;

  public constructor(config: GifToVideoPipelineConfig) {
    this.logger = config.logger;
    this.fetcher = config.fetcher;
    this.decoder = config.decoder;
  }

  public async execute(options: GifToVideoOptions): Promise<GifToVideoResult> {
    const start = performance.now();
    const download = await this.fetcher.fetch(options.source);
    const downloadedMs = performance.now();

    const decodeResult = this.decoder.decode(download.buffer);
    const decodedMs = performance.now();

    const frameProcessor = new FrameProcessorPipeline({
      operations: options.operations,
      logger: this.logger
    });
    const processedFrames = await frameProcessor.process(decodeResult.frames, decodeResult.metadata, options.tmpDir);
    const processedMs = performance.now();

    const encoder = new VideoEncoder({
      encoding: options.encoding,
      frames: processedFrames,
      metadata: decodeResult.metadata,
      outputDirectory: options.tmpDir,
      logger: this.logger
    });

    try {
      const result = await encoder.encode();
      const end = performance.now();
      const totalMs = end - start;
      this.logger.info(
        {
          totalMs,
          downloadMs: downloadedMs - start,
          decodeMs: decodedMs - downloadedMs,
          processMs: processedMs - decodedMs,
          encodeMs: end - processedMs
        },
        'gif-to-video pipeline completed'
      );
      return result;
    } catch (error) {
      this.logger.error({ err: error }, 'gif-to-video pipeline failed');
      if (!options.stillFallback) {
        throw error;
      }

      return this.buildFallback(decodeResult, options);
    }
  }

  private async buildFallback(
    decodeResult: ReturnType<GifFrameDecoder['decode']>,
    options: GifToVideoOptions
  ): Promise<GifToVideoResult> {
    const firstFrame = decodeResult.frames[0];
    if (!firstFrame) {
      throw new Error('Cannot build fallback without frames');
    }

    const stillFormat = options.stillFallbackFormat ?? 'png';
    const tempDirectory = await mkdtemp(join(options.tmpDir ?? tmpdir(), 'gif-fallback-'));
    const fallbackPath = join(tempDirectory, `fallback.${stillFormat}`);

    const image = sharp(firstFrame.bitmap, {
      raw: {
        width: firstFrame.width,
        height: firstFrame.height,
        channels: 4
      }
    });

    const buffer = stillFormat === 'png' ? await image.png().toBuffer() : await image.jpeg({ quality: 90 }).toBuffer();
    await writeFile(fallbackPath, buffer);

    return {
      outputPath: fallbackPath,
      durationMs: decodeResult.metadata.durationMs,
      frameCount: decodeResult.metadata.frameCount,
      format: stillFormat,
      fileSizeBytes: buffer.byteLength,
      fallbackStillPath: fallbackPath
    };
  }
}
