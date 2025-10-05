import { z } from 'zod';

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{6})$/u;

const normalizeHex = (value: string): string => value.toUpperCase();

const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
};

const hexToRgb = (value: string): [number, number, number] => {
  const hex = value.replace('#', '');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
};

const addAlphaToHex = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex);
  const safeAlpha = clamp(alpha, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha.toFixed(2)})`;
};

const HexColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, 'Invalid hex color. Expected format #RRGGBB.')
  .transform(normalizeHex);

const LayoutSchema = z.enum(['compact', 'standard', 'expanded']);
const PatternSchema = z.enum(['none', 'grid', 'waves', 'circuit', 'mesh']);
const StarStyleSchema = z.enum(['sharp', 'rounded']);
const FrameStyleSchema = z.enum(['rounded', 'cut']);
const AvatarStyleSchema = z.enum(['circle', 'rounded', 'hexagon']);
const ScaleSchema = z
  .coerce.number()
  .min(0.85, 'El tamaño mínimo permitido es 0.85.')
  .max(1.35, 'El tamaño máximo permitido es 1.35.')
  .transform((value) => Number(value.toFixed(2)));

const optionalShortText = (max: number) => z.string().trim().min(1).max(max);

const MiddlemanCardConfigBaseSchema = z
  .object({
    layout: LayoutSchema.default('standard'),
    gradientStart: HexColorSchema.default('#161129'),
    gradientEnd: HexColorSchema.default('#221B41'),
    accent: HexColorSchema.default('#7C5CFF'),
    accentSoft: HexColorSchema.optional(),
    pattern: PatternSchema.default('grid'),
    highlight: optionalShortText(80).optional(),
    watermark: optionalShortText(48).optional(),
    starStyle: StarStyleSchema.default('sharp'),
    frameStyle: FrameStyleSchema.default('rounded'),
    customBadgeText: optionalShortText(24).optional(),
    scale: ScaleSchema.default(1),
    avatarStyle: AvatarStyleSchema.default('circle'),
    avatarBorderColor: HexColorSchema.optional(),
    avatarGlow: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export type MiddlemanCardConfig = z.infer<typeof MiddlemanCardConfigBaseSchema> & {
  readonly accentSoft: string;
  readonly avatarBorderColor: string;
  readonly avatarGlow: string;
};

export const MiddlemanCardConfigSchema = MiddlemanCardConfigBaseSchema.transform((config) => {
  const accentSoft = config.accentSoft ? normalizeHex(config.accentSoft) : addAlphaToHex(config.accent, 0.32);
  const avatarBorderColor = config.avatarBorderColor ? normalizeHex(config.avatarBorderColor) : config.accent;
  const avatarGlow = config.avatarGlow ?? addAlphaToHex(config.accent, 0.6);

  return {
    ...config,
    accentSoft,
    avatarBorderColor,
    avatarGlow,
  } satisfies MiddlemanCardConfig;
});

export const parseMiddlemanCardConfig = (input: unknown): MiddlemanCardConfig =>
  MiddlemanCardConfigSchema.parse(input ?? {});

export const serializeMiddlemanCardConfig = (
  config: MiddlemanCardConfig,
): Record<string, string> => ({
  layout: config.layout,
  gradientStart: config.gradientStart,
  gradientEnd: config.gradientEnd,
  accent: config.accent,
  accentSoft: config.accentSoft,
  pattern: config.pattern,
  ...(config.highlight ? { highlight: config.highlight } : {}),
  ...(config.watermark ? { watermark: config.watermark } : {}),
  starStyle: config.starStyle,
  frameStyle: config.frameStyle,
  ...(config.customBadgeText ? { customBadgeText: config.customBadgeText } : {}),
  scale: config.scale.toString(),
  avatarStyle: config.avatarStyle,
  avatarBorderColor: config.avatarBorderColor,
  avatarGlow: config.avatarGlow,
});

export const DEFAULT_MIDDLEMAN_CARD_CONFIG = parseMiddlemanCardConfig({});
