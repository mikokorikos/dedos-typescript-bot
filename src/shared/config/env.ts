// ============================================================================
// RUTA: src/shared/config/env.ts
// ============================================================================

import { z } from 'zod';

const booleanLike = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'n', ''].includes(normalized)) {
      return false;
    }

    throw new Error(`Valor booleano inválido: ${value}`);
  });

const optionalUrl = z
  .string()
  .url()
  .or(z.literal(''))
  .transform((value) => (value === '' ? undefined : value));

export const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN es obligatorio'),
  DISCORD_CLIENT_ID: z
    .string()
    .regex(/^\d{17,20}$/u, 'DISCORD_CLIENT_ID debe ser un snowflake de Discord'),
  DISCORD_GUILD_ID: z
    .string()
    .regex(/^\d{17,20}$/u, 'DISCORD_GUILD_ID debe ser un snowflake de Discord')
    .optional(),
  COMMAND_PREFIX: z
    .string()
    .min(1, 'COMMAND_PREFIX es obligatorio')
    .max(5, 'COMMAND_PREFIX debe tener máximo 5 caracteres')
    .optional()
    .default(';'),
  DATABASE_URL: z.string().url('DATABASE_URL debe ser una URL válida'),
  MIDDLEMAN_CATEGORY_ID: z
    .string()
    .regex(/^\d{17,20}$/u, 'MIDDLEMAN_CATEGORY_ID debe ser un snowflake de Discord')
    .optional(),
  REVIEW_CHANNEL_ID: z
    .string()
    .regex(/^\d{17,20}$/u, 'REVIEW_CHANNEL_ID debe ser un snowflake de Discord')
    .optional(),
  REDIS_URL: optionalUrl.optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ENABLE_CACHE: booleanLike.default(false),
  ENABLE_SHARDING: booleanLike.default(false),
  SENTRY_DSN: optionalUrl.optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl.optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
