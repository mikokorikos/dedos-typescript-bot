// ============================================================================
// RUTA: src/infrastructure/external/MiddlemanCardGenerator.ts
// ============================================================================

import { createHash } from 'node:crypto';

import type { SKRSContext2D } from '@napi-rs/canvas';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';

import type { MiddlemanProfile } from '@/domain/repositories/IMiddlemanRepository';
import type { MiddlemanCardConfig } from '@/domain/value-objects/MiddlemanCardConfig';
import { DEFAULT_MIDDLEMAN_CARD_CONFIG } from '@/domain/value-objects/MiddlemanCardConfig';
import { logger } from '@/shared/logger/pino';

const CARD_WIDTH = 1280;
const CARD_HEIGHT = 460;
const AVATAR_SIZE = 180;
const CACHE_TTL_MS = 5 * 60_000;

const LAYOUT_SCALE: Record<MiddlemanCardConfig['layout'], number> = {
  compact: 0.88,
  standard: 1,
  expanded: 1.15,
};

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
  readonly discordDisplayName?: string | null;
  readonly discordAvatarUrl?: string | null;
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

const drawBackground = (
  ctx: SKRSContext2D,
  paletteOverrides: typeof palette = palette,
  pattern: MiddlemanCardConfig['pattern'] = 'grid',
): void => {
  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  gradient.addColorStop(0, paletteOverrides.backgroundStart);
  gradient.addColorStop(1, paletteOverrides.backgroundEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const accentGradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, 160);
  accentGradient.addColorStop(0, withAlpha(paletteOverrides.accent, 0.55));
  accentGradient.addColorStop(1, withAlpha(paletteOverrides.accent, 0));
  ctx.fillStyle = accentGradient;
  ctx.fillRect(0, 0, CARD_WIDTH, 180);

  const radial = ctx.createRadialGradient(CARD_WIDTH - 260, 160, 32, CARD_WIDTH - 200, 180, 420);
  radial.addColorStop(0, paletteOverrides.highlightSoft);
  radial.addColorStop(1, withAlpha(paletteOverrides.highlightSoft, 0));
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  drawPattern(ctx, pattern, paletteOverrides.accent, CARD_WIDTH, CARD_HEIGHT);
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

const withAlpha = (color: string, alpha: number): string => {
  if (color.startsWith('rgba')) {
    return color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/u, (_, r, g, b) => `rgba(${r.trim()}, ${g.trim()}, ${b.trim()}, ${alpha.toFixed(2)})`);
  }

  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
  }

  return color;
};

const drawPattern = (
  ctx: SKRSContext2D,
  pattern: MiddlemanCardConfig['pattern'],
  accentColor: string,
  width: number,
  height: number,
): void => {
  if (pattern === 'none') {
    return;
  }

  const stroke = withAlpha(accentColor, 0.08);
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2;
  ctx.globalCompositeOperation = 'lighter';

  switch (pattern) {
    case 'grid': {
      const step = 64;
      for (let x = 0; x <= width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      break;
    }
    case 'waves': {
      const amplitude = 12;
      const wavelength = 140;
      ctx.beginPath();
      for (let x = -wavelength; x <= width + wavelength; x += 6) {
        const y = height * 0.2 + Math.sin(x / wavelength * Math.PI * 2) * amplitude;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let x = -wavelength; x <= width + wavelength; x += 6) {
        const y = height * 0.65 + Math.cos(x / wavelength * Math.PI * 2) * amplitude;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      break;
    }
    case 'circuit': {
      const step = 110;
      for (let x = 0; x <= width; x += step) {
        for (let y = 0; y <= height; y += step) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + step / 2, y + step / 4);
          ctx.lineTo(x + step / 2, y + (step * 3) / 4);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x + step / 2, y + step / 2, 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      break;
    }
    case 'mesh': {
      const step = 80;
      for (let x = -height; x <= width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + height, height);
        ctx.stroke();
      }
      break;
    }
    default:
      break;
  }

  ctx.restore();
};

const drawStar = (
  ctx: SKRSContext2D,
  x: number,
  y: number,
  outerRadius: number,
  color: string,
  style: 'sharp' | 'rounded',
  fillRatio: number,
): void => {
  const spikes = 5;
  const innerRadius = style === 'rounded' ? outerRadius * 0.6 : outerRadius * 0.52;
  const step = Math.PI / spikes;

  ctx.save();
  ctx.beginPath();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.moveTo(0, -outerRadius);
  for (let i = 0; i < spikes; i += 1) {
    ctx.lineTo(Math.cos(i * 2 * step) * outerRadius, Math.sin(i * 2 * step) * outerRadius);
    ctx.lineTo(Math.cos((i * 2 + 1) * step) * innerRadius, Math.sin((i * 2 + 1) * step) * innerRadius);
  }
  ctx.closePath();

  ctx.fillStyle = withAlpha(color, 0.18);
  ctx.fill();
  ctx.clip();

  if (fillRatio > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(-outerRadius, -outerRadius, outerRadius * 2 * Math.min(1, fillRatio), outerRadius * 2);
  }

  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(0, -outerRadius);
  for (let i = 0; i < spikes; i += 1) {
    ctx.lineTo(Math.cos(i * 2 * step) * outerRadius, Math.sin(i * 2 * step) * outerRadius);
    ctx.lineTo(Math.cos((i * 2 + 1) * step) * innerRadius, Math.sin((i * 2 + 1) * step) * innerRadius);
  }
  ctx.closePath();
  ctx.strokeStyle = withAlpha(color, 0.45);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
};

const drawRatingStars = (
  ctx: SKRSContext2D,
  rating: number,
  x: number,
  y: number,
  spacing: number,
  color: string,
  style: 'sharp' | 'rounded',
): void => {
  const clamped = Math.max(0, Math.min(5, rating));
  const full = Math.floor(clamped);
  const fraction = clamped - full;
  const radius = 18;

  for (let index = 0; index < 5; index += 1) {
    const offset = x + index * spacing;
    const fillRatio = index < full ? 1 : index === full ? fraction : 0;
    drawStar(ctx, offset, y, radius, color, style, fillRatio);
  }
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

};

const formatNumber = (value: number): string =>
  value >= 1000 ? `${Math.round((value / 1000) * 10) / 10}k` : `${value}`;

class MiddlemanCardGenerator {
  private readonly cache = new Map<string, CacheEntry>();

  public async renderProfileCard(options: ProfileCardOptions): Promise<AttachmentBuilder | null> {
    const profile = options.profile;
    const config = profile?.cardConfig ?? DEFAULT_MIDDLEMAN_CARD_CONFIG;
    const baseName = (options.discordDisplayName ?? options.discordTag).trim();
    const mentionMatch = baseName.match(/^<@!?(\d+)>$/u);
    const displayLabel = mentionMatch ? "Usuario " + mentionMatch[1] : baseName;
    const displayName = displayLabel.slice(0, 32);

    const cacheKey = createCacheKey('profile', {
      tag: options.discordTag,
      displayName,
      avatar: options.discordAvatarUrl ?? null,
      username: profile?.primaryIdentity?.username ?? null,
      robloxId: profile?.primaryIdentity?.robloxUserId?.toString() ?? null,
      vouches: profile?.vouches ?? 0,
      ratingSum: profile?.ratingSum ?? 0,
      ratingCount: profile?.ratingCount ?? 0,
      highlight: options.highlight ?? config.highlight ?? null,
      cardConfig: config,
    });

    const cached = this.getFromCache(cacheKey, 'middleman-profile-card.png');
    if (cached) {
      return cached;
    }

    try {
      const scale = LAYOUT_SCALE[config.layout] ?? 1;
      const canvas = createCanvas(Math.round(CARD_WIDTH * scale), Math.round(CARD_HEIGHT * scale));
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      const paletteOverrides = {
        ...palette,
        backgroundStart: config.gradientStart,
        backgroundEnd: config.gradientEnd,
        highlight: config.accent,
        highlightSoft: config.accentSoft,
        accent: config.accent,
      };

      drawBackground(ctx, paletteOverrides, config.pattern);
      drawRoundedRect(ctx, 48, 88, CARD_WIDTH - 96, CARD_HEIGHT - 136, 32, palette.panel, palette.border);

      const initialsSource = profile?.primaryIdentity?.username ?? displayName;
      let avatarSource: CanvasImageSource | null = null;
      const robloxId = profile?.primaryIdentity?.robloxUserId ?? null;
      if (robloxId !== null) {
        avatarSource = await loadRobloxAvatar(robloxId).catch(() => null);
      }

      if (!avatarSource && options.discordAvatarUrl) {
        try {
          const buffer = await fetchAvatarBuffer(options.discordAvatarUrl);
          avatarSource = await loadImage(buffer);
        } catch (error) {
          logger.warn({ err: error, avatarUrl: options.discordAvatarUrl }, 'No se pudo cargar avatar de Discord.');
        }
      }

      if (!avatarSource) {
        avatarSource = createAvatarFallback(resolveInitials(initialsSource));
      }

      drawAvatar(ctx, avatarSource, 82, 132, AVATAR_SIZE);

      const infoX = 82 + AVATAR_SIZE + 48;
      const infoY = 152;

      ctx.font = '700 50px "Segoe UI", Arial';
      ctx.fillStyle = palette.textPrimary;
      ctx.fillText(displayName, infoX, infoY);

      const robloxUsername = profile?.primaryIdentity?.username ?? 'Sin registrar';
      ctx.font = '500 24px "Segoe UI", Arial';
      ctx.fillStyle = palette.textSecondary;
      ctx.fillText(Roblox: , infoX, infoY + 50);

      const ratingCount = profile?.ratingCount ?? 0;
      const ratingValue = ratingCount > 0 ? (profile?.ratingSum ?? 0) / ratingCount : 0;

      drawRatingStars(ctx, ratingValue, infoX + 12, infoY + 102, 64, paletteOverrides.accent, config.starStyle);

      ctx.font = '600 22px "Segoe UI", Arial';
      ctx.fillStyle = palette.textPrimary;
      ctx.fillText(${ratingValue.toFixed(2)} / 5 (), infoX, infoY + 150);

      const vouches = profile?.vouches ?? 0;
      drawBadge(ctx, infoX, infoY + 176, 'Vouches', formatNumber(vouches), paletteOverrides.accent);
      drawBadge(ctx, infoX + 220, infoY + 176, 'Reseñas', ${ratingCount}, paletteOverrides.highlight);

      const highlightText = options.highlight ?? config.highlight ?? null;
      if (highlightText) {
        ctx.font = '500 22px "Segoe UI", Arial';
        ctx.fillStyle = palette.textSecondary;
        ctx.fillText(highlightText, infoX, infoY + 220);
      }

      if (config.customBadgeText) {
        drawBadge(ctx, CARD_WIDTH - 300, infoY - 38, 'Rol', config.customBadgeText, paletteOverrides.accent);
      }

      if (config.watermark) {
        ctx.font = '500 18px "Segoe UI", Arial';
        ctx.fillStyle = palette.textMuted;
        ctx.textAlign = 'right';
        ctx.fillText(config.watermark, CARD_WIDTH - 72, CARD_HEIGHT - 52);
        ctx.textAlign = 'left';
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

  public async render(options: {
    discordTag: string;
    profile: MiddlemanProfile | null;
    discordDisplayName?: string;
    discordAvatarUrl?: string | null;
    highlight?: string | null;
  }): Promise<AttachmentBuilder | null> {
    return this.renderProfileCard({
      discordTag: options.discordTag,
      discordDisplayName: options.discordDisplayName,
      discordAvatarUrl: options.discordAvatarUrl,
      profile: options.profile,
      highlight: options.highlight ?? null,
    });
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
