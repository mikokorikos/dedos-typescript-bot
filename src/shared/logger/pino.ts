// ============================================================================
// RUTA: src/shared/logger/pino.ts
// ============================================================================

import pinoLogger, { type Bindings, type Logger, type LoggerOptions } from 'pino';

import { env } from '@/shared/config/env';
import { stripDiacriticsDeep } from '@/shared/utils/text';

const isDevelopment = env.NODE_ENV === 'development';

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: {
    env: env.NODE_ENV,
  },
  redact: {
    paths: ['req.headers.authorization', 'interaction.token'],
    remove: true,
  },
};

if (isDevelopment) {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  };
}

const sanitizeArgs = (args: unknown[]): unknown[] => args.map((value) => stripDiacriticsDeep(value));

options.hooks = {
  logMethod(args, method) {
    const sanitizedArgs = sanitizeArgs(args);
    return Reflect.apply(method, this, sanitizedArgs);
  },
};

export const logger = pinoLogger(options);

export const createChildLogger = (bindings: Bindings): Logger => logger.child(bindings);
