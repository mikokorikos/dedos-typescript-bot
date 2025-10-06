import { pino } from 'pino';

import { GifFrameDecoder } from '../../src/media/gif/GifFrameDecoder.js';
import { GifRemoteFetcher } from '../../src/media/gif/GifRemoteFetcher.js';
import type { GifToVideoOptions } from '../../src/media/gif/types.js';
import { GifToVideoPipeline } from '../../src/media/pipeline/GifToVideoPipeline.js';
import { BlurOperation } from '../../src/media/processing/operations/BlurOperation.js';
import { OverlayImageOperation } from '../../src/media/processing/operations/OverlayImageOperation.js';
import { SaturationOperation } from '../../src/media/processing/operations/SaturationOperation.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const discordBannerUrl =
  process.argv[2] ?? 'https://media.discordapp.net/banners/80351110224678912/a_7b2f.gif?size=600';

const avatarOverlayUrl =
  process.env.AVATAR_URL ?? 'https://cdn.discordapp.com/embed/avatars/0.png';

async function main(): Promise<void> {
  const fetcher = new GifRemoteFetcher({ logger, maxBytes: 25 * 1024 * 1024 });
  const decoder = new GifFrameDecoder(logger);
  const pipeline = new GifToVideoPipeline({ logger, fetcher, decoder });

  const operations = [
    new BlurOperation(0),
    new SaturationOperation(1.1),
    new OverlayImageOperation({
      sourceUrl: avatarOverlayUrl,
      x: 24,
      y: 24,
      width: 96,
      height: 96,
      opacity: 0.92
    })
  ];

  const options: GifToVideoOptions = {
    source: { url: discordBannerUrl },
    operations,
    encoding: {
      format: 'mp4',
      codec: 'h264',
      crf: 22,
      preset: 'faster',
      pixelFormat: 'yuv420p',
      extraFlags: ['-colorspace', 'bt709']
    },
    stillFallback: true
  };

  const result = await pipeline.execute(options);

  if (result.outputPath) {
    logger.info({ result }, 'Banner converted successfully');
  } else {
    logger.warn({ result }, 'Fell back to still image');
  }
}

main().catch((error) => {
  logger.error(error, 'Failed to convert banner');
  process.exitCode = 1;
});
