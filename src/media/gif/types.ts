import type { ImageData, SKRSContext2D } from '@napi-rs/canvas';

export interface GifSource {
  url: string;
  headers?: Record<string, string>;
  integrity?: string;
}

export interface GifDownloadResult {
  buffer: Buffer;
  contentLength?: number;
  etag?: string;
  lastModified?: string;
}

export interface DecodedFrame {
  index: number;
  delayCentiseconds: number;
  width: number;
  height: number;
  bitmap: Uint8ClampedArray;
  disposalType: number;
}

export interface GifMetadata {
  width: number;
  height: number;
  frameCount: number;
  loopCount: number | null;
  durationMs: number;
}

export interface FrameWithImageData extends DecodedFrame {
  imageData: ImageData;
}

export interface FrameProcessorOperation {
  readonly name: string;
  apply(context: SKRSContext2D, frame: FrameWithImageData): Promise<void>;
}

export interface ProcessedFrame {
  index: number;
  presentationTimestampMs: number;
  durationMs: number;
  path: string;
}

export interface VideoEncodingConfig {
  format: 'mp4' | 'webm' | 'avif';
  codec: 'h264' | 'vp9' | 'av1';
  crf?: number;
  bitrate?: string;
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
  maxFileSizeBytes?: number;
  pixelFormat?: string;
  hardwareAcceleration?: 'auto' | 'cuda' | 'vaapi' | 'qsv' | 'vulkan' | 'none';
  extraFlags?: string[];
}

export interface GifToVideoOptions {
  source: GifSource;
  operations?: FrameProcessorOperation[];
  encoding: VideoEncodingConfig;
  tmpDir?: string;
  concurrency?: number;
  stillFallback?: boolean;
  stillFallbackFormat?: 'png' | 'jpeg';
}

export interface GifToVideoResult {
  outputPath: string;
  durationMs: number;
  frameCount: number;
  format: string;
  fileSizeBytes: number;
  fallbackStillPath?: string;
}
