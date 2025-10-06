import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';
import { Logger } from 'pino';

import type { GifDownloadResult, GifSource } from './types.js';

export interface GifRemoteFetcherConfig {
  maxBytes: number;
  maxRetries: number;
  timeoutMs: number;
  backoffMs: number;
  userAgent: string;
  logger: Logger;
}

const DEFAULT_CONFIG = {
  maxBytes: 20 * 1024 * 1024,
  maxRetries: 3,
  timeoutMs: 10_000,
  backoffMs: 500,
  userAgent: 'DedosMediaBot/1.0 (+https://example.com)'
} satisfies Omit<GifRemoteFetcherConfig, 'logger'>;

export class GifRemoteFetcher {
  private readonly config: GifRemoteFetcherConfig;

  public constructor(config: Partial<GifRemoteFetcherConfig>) {
    if (!config.logger) {
      throw new Error('GifRemoteFetcher requires a logger instance');
    }

    this.config = { ...DEFAULT_CONFIG, ...config } as GifRemoteFetcherConfig;
  }

  public async fetch(source: GifSource): Promise<GifDownloadResult> {
    const { logger } = this.config;
    const requestUrl = new URL(source.url);
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.config.maxRetries) {
      try {
        attempt += 1;
        logger.debug({ requestUrl: requestUrl.href, attempt }, 'Downloading GIF');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        const response = await fetch(requestUrl, {
          headers: {
            'User-Agent': this.config.userAgent,
            Accept: 'image/gif',
            ...source.headers
          },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok || !response.body) {
          throw new Error(`Failed to fetch GIF: ${response.status} ${response.statusText}`);
        }

        const contentLengthHeader = response.headers.get('content-length');
        const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : undefined;
        if (contentLength && contentLength > this.config.maxBytes) {
          throw new Error(`GIF too large: ${contentLength} bytes`);
        }

        const hash = source.integrity ? createHash('sha256') : null;
        const chunks: Uint8Array[] = [];
        let downloaded = 0;

        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          downloaded += chunk.byteLength;
          if (downloaded > this.config.maxBytes) {
            throw new Error(`GIF exceeded max bytes (${this.config.maxBytes})`);
          }
          chunks.push(chunk);
          hash?.update(chunk);
        }

        const buffer = Buffer.concat(chunks);

        if (source.integrity) {
          const digest = hash!.digest('hex');
          if (digest !== source.integrity) {
            throw new Error(`Integrity check failed. Expected ${source.integrity} but got ${digest}`);
          }
        }

        return {
          buffer,
          contentLength,
          etag: response.headers.get('etag') ?? undefined,
          lastModified: response.headers.get('last-modified') ?? undefined
        };
      } catch (error) {
        lastError = error;
        logger.warn({ err: error, attempt }, 'Failed to download GIF');
        if (attempt > this.config.maxRetries) {
          break;
        }
        await delay(this.config.backoffMs * attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to download GIF');
  }
}
