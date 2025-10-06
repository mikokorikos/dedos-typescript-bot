import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from 'pino';

import type { GifMetadata, GifToVideoResult, ProcessedFrame, VideoEncodingConfig } from '../gif/types.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface VideoEncoderOptions {
  encoding: VideoEncodingConfig;
  metadata: GifMetadata;
  frames: ProcessedFrame[];
  outputDirectory?: string;
  logger: Logger;
}

export class VideoEncoder {
  private readonly options: VideoEncoderOptions;

  public constructor(options: VideoEncoderOptions) {
    this.options = options;
  }

  public async encode(): Promise<GifToVideoResult> {
    const { frames } = this.options;
    if (frames.length === 0) {
      throw new Error('No frames to encode');
    }

    const concatDir = await mkdtemp(join(this.options.outputDirectory ?? tmpdir(), 'gif-concat-'));
    const concatFilePath = join(concatDir, 'frames.ffconcat');
    await writeFile(concatFilePath, this.buildConcatFile(frames));

    const outputPath = join(
      concatDir,
      `output.${this.options.encoding.format === 'mp4' ? 'mp4' : this.options.encoding.format}`
    );

    const command = ffmpeg()
      .input(concatFilePath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .videoCodec(this.resolveCodec())
      .outputOptions(this.buildOutputOptions());

    if (this.options.encoding.hardwareAcceleration && this.options.encoding.hardwareAcceleration !== 'none') {
      command.inputOptions(['-hwaccel', this.options.encoding.hardwareAcceleration]);
    }

    command.output(outputPath);

    const { logger } = this.options;

    await new Promise<void>((resolve, reject) => {
      command
        .on('start', (cmd) => {
          logger.debug({ cmd }, 'FFmpeg started');
        })
        .on('progress', (progress) => {
          logger.debug({ progress }, 'FFmpeg progress');
        })
        .on('error', (err, stdout, stderr) => {
          logger.error({ err, stdout, stderr }, 'FFmpeg failed');
          reject(err);
        })
        .on('end', () => {
          logger.debug('FFmpeg completed');
          resolve();
        })
        .run();
    });

    const stats = await stat(outputPath);

    if (this.options.encoding.maxFileSizeBytes && stats.size > this.options.encoding.maxFileSizeBytes) {
      throw new Error(
        `Encoded file exceeds limit (${stats.size} > ${this.options.encoding.maxFileSizeBytes} bytes)`
      );
    }

    return {
      outputPath,
      durationMs: this.options.metadata.durationMs,
      frameCount: frames.length,
      format: this.options.encoding.format,
      fileSizeBytes: stats.size
    };
  }

  private buildConcatFile(frames: ProcessedFrame[]): string {
    const lines: string[] = ['ffconcat version 1.0'];

    for (const frame of frames) {
      lines.push(`file '${frame.path.replaceAll("'", "'\\''")}'`);
      lines.push(`duration ${(frame.durationMs / 1000).toFixed(6)}`);
    }

    const lastFrame = frames.at(-1);
    if (lastFrame) {
      lines.push(`file '${lastFrame.path.replaceAll("'", "'\\''")}'`);
    }

    return lines.join('\n');
  }

  private resolveCodec(): string {
    switch (this.options.encoding.codec) {
      case 'h264':
        return 'libx264';
      case 'vp9':
        return 'libvpx-vp9';
      case 'av1':
        return 'libaom-av1';
      default:
        throw new Error(`Unsupported codec: ${this.options.encoding.codec}`);
    }
  }

  private buildOutputOptions(): string[] {
    const options: string[] = ['-pix_fmt', this.options.encoding.pixelFormat ?? 'yuv420p'];
    const { format, codec, crf, bitrate, preset, extraFlags } = this.options.encoding;

    if (codec === 'h264') {
      options.push('-profile:v', 'high', '-bf', '2', '-g', '120', '-movflags', '+faststart');
      options.push('-preset', preset ?? 'slow');
      options.push('-crf', (crf ?? 18).toString());
      if (bitrate) {
        options.push('-b:v', bitrate);
      }
    }

    if (codec === 'vp9') {
      options.push('-b:v', bitrate ?? '0');
      options.push('-crf', (crf ?? 32).toString());
      options.push('-deadline', preset ?? 'good');
      options.push('-row-mt', '1');
    }

    if (codec === 'av1') {
      options.push('-b:v', bitrate ?? '0');
      options.push('-crf', (crf ?? 30).toString());
      options.push('-cpu-used', preset ? this.mapPresetToCpuUsed(preset) : '4');
      options.push('-tile-columns', '2', '-tile-rows', '1');
    }

    if (format === 'webm') {
      options.push('-f', 'webm');
    }

    options.push('-vsync', 'vfr');

    if (extraFlags?.length) {
      options.push(...extraFlags);
    }

    return options;
  }

  private mapPresetToCpuUsed(preset: NonNullable<VideoEncodingConfig['preset']>): string {
    const mapping: Record<NonNullable<VideoEncodingConfig['preset']>, string> = {
      ultrafast: '8',
      superfast: '7',
      veryfast: '6',
      faster: '5',
      fast: '4',
      medium: '3',
      slow: '2',
      slower: '1',
      veryslow: '0'
    };

    return mapping[preset] ?? '4';
  }
}
