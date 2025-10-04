// ============================================================================
// RUTA: src/infrastructure/external/MiddlemanCardGenerator.ts
// ============================================================================

import { createHash } from 'node:crypto';

import type { SKRSContext2D } from '@napi-rs/canvas';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';

import type { MiddlemanProfile } from '@/domain/repositories/IMiddlemanRepository';
import { logger } from '@/shared/logger/pino';

const CARD_WIDTH = 1280;
const CARD_HEIGHT = 460;
const AVATAR_SIZE = 180;
const CACHE_TTL_MS = 5 * 60_000;

const palette = {
  backgroundStart: '#161129',
  backgroundEnd: '#221b41',
  highlight: '#7c5cff',
  highlightSoft: 'rgba(124, 92, 255, 0.28)',
  accent: '#11c8b3',
  accentMuted: '#0c9c8e',
  textPrimary: '#f5f7ff',
  textSecondary: '#aeb3c7',
  textMuted: '#7c8094',
  panel: 'rgba(17, 17, 32, 0.72)',
  border: 'rgba(255, 255, 255, 0.08)',
  badgeBackground: 'rgba(255, 255, 255, 0.08)',
};

interface ProfileCardOptions {
  readonly discordTag: string;
  readonly profile: MiddlemanProfile | null;
  readonly highlight?: string | null;
}

interface TradeParticipantCardInfo {
  readonly label: string;
  readonly roblox?: string | null;
  readonly status: 'pending' | 'confirmed' | 'delivered';
  readonly items?: readonly string[] | null;
}

interface TradeSummaryCardOptions {
  readonly ticketCode: string | number;
  readonly middlemanTag: string;
  readonly status: string;
  readonly participants: readonly TradeParticipantCardInfo[];
  readonly notes?: string | null;
}

interface StatsCardMetric {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}

interface StatsCardOptions {
  readonly title: string;
  readonly subtitle?: string | null;
  readonly metrics: readonly StatsCardMetric[];
}

type CanvasImageSource = Parameters<SKRSContext2D['drawImage']>[0];

interface CacheEntry {
  readonly buffer: Buffer;
  readonly expiresAt: number;
}

const createCacheKey = (type: string, payload: unknown): string => {
  const serialized = JSON.stringify(payload, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  return createHash('sha1').update(`${type}:${serialized}`).digest('hex');
};

const drawBackground = (ctx: SKRSContext2D): void => {
  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  gradient.addColorStop(0, palette.backgroundStart);
  gradient.addColorStop(1, palette.backgroundEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const accent = ctx.createLinearGradient(0, 0, CARD_WIDTH, 160);
  accent.addColorStop(0, 'rgba(124, 92, 255, 0.55)');
  accent.addColorStop(1, 'rgba(35, 31, 63, 0)');
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_WIDTH, 180);

  const radial = ctx.createRadialGradient(CARD_WIDTH - 260, 160, 32, CARD_WIDTH - 200, 180, 420);
  radial.addColorStop(0, 'rgba(18, 217, 187, 0.35)');
  radial.addColorStop(1, 'rgba(18, 217, 187, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
};

const drawRoundedRect = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string,
  strokeStyle?: string,
): void => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();

  ctx.fillStyle = fillStyle;
  ctx.fill();

  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
};

const drawAvatar = (ctx: SKRSContext2D, source: CanvasImageSource, x: number, y: number, size: number): void => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.clip();
  ctx.shadowBlur = 0;
  ctx.drawImage(source, x, y, size, size);
  ctx.restore();
};

const drawBadge = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  label: string,
  value: string,
  accentColor: string,
): void => {
  const paddingX = 18;
  ctx.font = '500 18px "Segoe UI", Arial';
  const labelWidth = ctx.measureText(label).width;
  ctx.font = '600 20px "Segoe UI", Arial';
  const valueWidth = ctx.measureText(value).width;
  const width = Math.max(140, paddingX * 2 + labelWidth + 12 + valueWidth);
  const height = 44;

  drawRoundedRect(ctx, x, y, width, height, 18, palette.badgeBackground, 'rgba(255,255,255,0.08)');

  ctx.font = '500 18px "Segoe UI", Arial';
  ctx.fillStyle = palette.textMuted;
  ctx.fillText(label.toUpperCase(), x + paddingX, y + height / 2 + 6);

  ctx.font = '600 20px "Segoe UI", Arial';
  ctx.fillStyle = accentColor;
  ctx.fillText(value, x + paddingX + labelWidth + 12, y + height / 2 + 6);
};

const drawMetricPill = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  title: string,
  value: string,
  highlight = false,
): void => {
  const width = 220;
  const height = 86;
  drawRoundedRect(
    ctx,
    x,
    y,
    width,
    height,
    22,
    highlight ? 'rgba(17, 200, 179, 0.16)' : palette.panel,
    highlight ? 'rgba(17, 200, 179, 0.45)' : palette.border,
  );

  ctx.font = '500 18px "Segoe UI", Arial';
  ctx.fillStyle = palette.textMuted;
  ctx.fillText(title.toUpperCase(), x + 24, y + 32);

  ctx.font = '700 32px "Segoe UI", Arial';
  ctx.fillStyle = palette.textPrimary;
  ctx.fillText(value, x + 24, y + 64);
};

const createAvatarFallback = (initials: string): CanvasImageSource => {
  const canvas = createCanvas(AVATAR_SIZE, AVATAR_SIZE);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  gradient.addColorStop(0, '#3d2a7f');
  gradient.addColorStop(1, '#291f55');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);

  ctx.font = 'bold 72px "Segoe UI", Arial';
  ctx.fillStyle = '#f5f7ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, AVATAR_SIZE / 2, AVATAR_SIZE / 2);

  return canvas;
};

const resolveInitials = (tag: string | null | undefined): string => {
  if (!tag) {
    return 'MM';
  }

  const parts = tag
    .replace(/[#@<>]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? '');

  return parts.join('') || 'MM';
};

const fetchAvatarBuffer = async (url: string): Promise<Buffer> => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DedosShopBot/1.0; +https://discord.gg/dedos)',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
};

const loadRobloxAvatar = async (robloxUserId: bigint): Promise<CanvasImageSource | null> => {
  const url = `https://www.roblox.com/headshot-thumbnail/image?userId=${robloxUserId.toString()}&width=352&height=352&format=png`;

  try {
    const buffer = await fetchAvatarBuffer(url);
    return await loadImage(buffer);
  } catch (error) {
    logger.warn({ err: error, robloxUserId: robloxUserId.toString() }, 'No se pudo descargar avatar de Roblox.');
    return null;
  }
};

const renderStars = (rating: number): string => {
  const clamped = Math.max(0, Math.min(5, Math.round(rating)));
  const filled = '★'.repeat(clamped);
  const empty = '☆'.repeat(5 - clamped);
  return `${filled}${empty}`;
};

const formatNumber = (value: number): string =>
  value >= 1000 ? `${Math.round((value / 1000) * 10) / 10}k` : `${value}`;

class MiddlemanCardGenerator {
  private readonly cache = new Map<string, CacheEntry>();

  public async renderProfileCard(options: ProfileCardOptions): Promise<AttachmentBuilder | null> {
    const cacheKey = createCacheKey('profile', {
      tag: options.discordTag,
      username: options.profile?.primaryIdentity?.username ?? null,
      robloxId: options.profile?.primaryIdentity?.robloxUserId?.toString() ?? null,
      vouches: options.profile?.vouches ?? 0,
      ratingSum: options.profile?.ratingSum ?? 0,
      ratingCount: options.profile?.ratingCount ?? 0,
      highlight: options.highlight ?? null,
    });

    const cached = this.getFromCache(cacheKey, 'middleman-profile-card.png');
    if (cached) {
      return cached;
    }

    try {
      const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
      const ctx = canvas.getContext('2d');

      drawBackground(ctx);
      drawRoundedRect(ctx, 48, 88, CARD_WIDTH - 96, CARD_HEIGHT - 136, 32, palette.panel, palette.border);

      const initials = resolveInitials(options.profile?.primaryIdentity?.username ?? options.discordTag);
      const robloxId = options.profile?.primaryIdentity?.robloxUserId ?? null;
      const avatarSource =
        robloxId !== null && robloxId !== undefined
          ? await loadRobloxAvatar(robloxId).catch(() => null)
          : null;
      drawAvatar(ctx, avatarSource ?? createAvatarFallback(initials), 82, 132, AVATAR_SIZE);

      const infoX = 82 + AVATAR_SIZE + 48;
      const infoY = 152;

      ctx.font = '700 48px "Segoe UI", Arial';
      ctx.fillStyle = palette.textPrimary;
      ctx.fillText(options.discordTag, infoX, infoY);

      const robloxUsername = options.profile?.primaryIdentity?.username ?? 'Sin registrar';
      ctx.font = '500 24px "Segoe UI", Arial';
      ctx.fillStyle = palette.textSecondary;
      ctx.fillText(`Roblox: ${robloxUsername}`, infoX, infoY + 42);

      const ratingCount = options.profile?.ratingCount ?? 0;
      const ratingValue = ratingCount > 0 ? (options.profile?.ratingSum ?? 0) / ratingCount : 0;
      const ratingStars = renderStars(ratingValue);
      ctx.font = '600 28px "Segoe UI", Arial';
      ctx.fillStyle = palette.accent;
      ctx.fillText(`${ratingStars}  ${ratingValue.toFixed(2)} / 5 (${ratingCount})`, infoX, infoY + 90);

      const vouches = options.profile?.vouches ?? 0;
      drawBadge(ctx, infoX, infoY + 112, 'Vouches', formatNumber(vouches), palette.accent);
      drawBadge(ctx, infoX + 240, infoY + 112, 'Resenas', `${ratingCount}`, palette.highlight);

      drawMetricPill(
        ctx,
        CARD_WIDTH - 48 - 220,
        infoY,
        'Ultima actualizacion',
        new Date().toISOString().split('T')[0] ?? '',
      );

      if (options.highlight) {
        ctx.font = '500 22px "Segoe UI", Arial';
        ctx.fillStyle = palette.textSecondary;
        ctx.fillText(options.highlight, infoX, infoY + 196);
      }

      const buffer = canvas.toBuffer('image/png');
      this.storeInCache(cacheKey, buffer);
      return new AttachmentBuilder(buffer, { name: 'middleman-profile-card.png' });
    } catch (error) {
      logger.warn({ err: error }, 'No se pudo generar la tarjeta de perfil del middleman.');
      return null;
    }
  }

  public async renderTradeSummaryCard(
    options: TradeSummaryCardOptions,
  ): Promise<AttachmentBuilder | null> {
    const cacheKey = createCacheKey('trade-summary', options);
    const cached = this.getFromCache(cacheKey, 'middleman-trade-card.png');
    if (cached) {
      return cached;
    }

    try {
      const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
      const ctx = canvas.getContext('2d');
      drawBackground(ctx);
      drawRoundedRect(ctx, 48, 96, CARD_WIDTH - 96, CARD_HEIGHT - 144, 28, palette.panel, palette.border);

      ctx.font = '700 44px "Segoe UI", Arial';
      ctx.fillStyle = palette.textPrimary;
      ctx.fillText(`Ticket #${options.ticketCode}`, 82, 154);

      ctx.font = '500 22px "Segoe UI", Arial';
      ctx.fillStyle = palette.textSecondary;
      ctx.fillText(`Middleman asignado: ${options.middlemanTag}`, 82, 190);

      ctx.font = '600 20px "Segoe UI", Arial';
      ctx.fillStyle = palette.accent;
      ctx.fillText(`Estado: ${options.status}`, 82, 222);

      const participantWidth = 360;
      const participantHeight = 150;
      options.participants.forEach((participant, index) => {
        const baseX = 82 + index * (participantWidth + 24);
        const baseY = 260;
        drawRoundedRect(ctx, baseX, baseY, participantWidth, participantHeight, 22, palette.panel, palette.border);

        ctx.font = '600 24px "Segoe UI", Arial';
        ctx.fillStyle = palette.textPrimary;
        ctx.fillText(participant.label, baseX + 24, baseY + 48);

        if (participant.roblox) {
          ctx.font = '500 18px "Segoe UI", Arial';
          ctx.fillStyle = palette.textSecondary;
          ctx.fillText(`Roblox: ${participant.roblox}`, baseX + 24, baseY + 78);
        }

        const statusColors: Record<TradeParticipantCardInfo['status'], string> = {
          pending: '#f6ad55',
          confirmed: '#38bdf8',
          delivered: '#34d399',
        };
        drawBadge(ctx, baseX + 24, baseY + 92, 'Estado', participant.status.toUpperCase(), statusColors[participant.status]);

        if (participant.items && participant.items.length > 0) {
          ctx.font = '500 17px "Segoe UI", Arial';
          ctx.fillStyle = palette.textMuted;
          const items = participant.items.slice(0, 3).map((item) => `• ${item}`);
          ctx.fillText(items.join('  '), baseX + 24, baseY + participantHeight - 20);
        }
      });

      if (options.notes) {
        ctx.font = '500 20px "Segoe UI", Arial';
        ctx.fillStyle = palette.textSecondary;
        drawRoundedRect(ctx, 82, CARD_HEIGHT - 132, CARD_WIDTH - 164, 72, 18, palette.panel, palette.border);
        ctx.fillText(options.notes, 102, CARD_HEIGHT - 92);
      }

      const buffer = canvas.toBuffer('image/png');
      this.storeInCache(cacheKey, buffer);
      return new AttachmentBuilder(buffer, { name: 'middleman-trade-card.png' });
    } catch (error) {
      logger.warn({ err: error }, 'No se pudo generar la tarjeta de resumen de trade.');
      return null;
    }
  }

  public async renderStatsCard(options: StatsCardOptions): Promise<AttachmentBuilder | null> {
    const cacheKey = createCacheKey('stats-card', options);
    const cached = this.getFromCache(cacheKey, 'dedos-stats-card.png');
    if (cached) {
      return cached;
    }

    try {
      const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
      const ctx = canvas.getContext('2d');
      drawBackground(ctx);
      drawRoundedRect(ctx, 64, 104, CARD_WIDTH - 128, CARD_HEIGHT - 168, 26, palette.panel, palette.border);

      ctx.font = '700 46px "Segoe UI", Arial';
      ctx.fillStyle = palette.textPrimary;
      ctx.fillText(options.title, 96, 170);

      if (options.subtitle) {
        ctx.font = '500 22px "Segoe UI", Arial';
        ctx.fillStyle = palette.textSecondary;
        ctx.fillText(options.subtitle, 96, 206);
      }

      const columns = Math.min(3, options.metrics.length);
      const columnWidth = Math.min(260, Math.floor((CARD_WIDTH - 192) / columns) - 24);

      options.metrics.forEach((metric, index) => {
        const colX = 96 + index * (columnWidth + 36);
        drawMetricPill(ctx, colX, 240, metric.label, metric.value, Boolean(metric.emphasis));
      });

      const buffer = canvas.toBuffer('image/png');
      this.storeInCache(cacheKey, buffer);
      return new AttachmentBuilder(buffer, { name: 'dedos-stats-card.png' });
    } catch (error) {
      logger.warn({ err: error }, 'No se pudo generar la tarjeta de estadisticas.');
      return null;
    }
  }

  public async render(options: { discordTag: string; profile: MiddlemanProfile | null }): Promise<AttachmentBuilder | null> {
    return this.renderProfileCard({ discordTag: options.discordTag, profile: options.profile });
  }

  private getFromCache(cacheKey: string, fileName: string): AttachmentBuilder | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt < Date.now()) {
      this.cache.delete(cacheKey);
      return null;
    }

    return new AttachmentBuilder(Buffer.from(entry.buffer), { name: fileName });
  }

  private storeInCache(cacheKey: string, buffer: Buffer): void {
    this.cache.set(cacheKey, { buffer, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}

export const middlemanCardGenerator = new MiddlemanCardGenerator();

export type { ProfileCardOptions, StatsCardOptions, TradeParticipantCardInfo, TradeSummaryCardOptions };
