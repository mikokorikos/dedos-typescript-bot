// ============================================================================
// RUTA: src/infrastructure/db/prisma.ts
// ============================================================================

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { PrismaClient } from '@prisma/client';

import { env } from '@/shared/config/env';
import { logger } from '@/shared/logger/pino';

const execFileAsync = promisify(execFile);

const createPrismaClient = () =>
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
    errorFormat: env.NODE_ENV === 'development' ? 'pretty' : 'minimal',
  });

type GlobalWithPrisma = typeof globalThis & { prisma?: PrismaClient };

const globalForPrisma = globalThis as GlobalWithPrisma;

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

const prismaCli = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let schemaSynced = false;
let schemaSyncPromise: Promise<void> | null = null;

const detectMigrations = async (): Promise<boolean> => {
  try {
    const migrationsDir = resolve(process.cwd(), 'prisma', 'migrations');
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory());
  } catch (error) {
    const knownError = error as NodeJS.ErrnoException;
    if (knownError?.code !== 'ENOENT') {
      logger.debug({ err: error }, 'Error inspeccionando directorio de migraciones.');
    }

    return false;
  }
};

const runPrismaCli = async (args: string[]): Promise<void> => {
  const command = `prisma ${args.join(' ')}`;
  logger.info({ command }, 'Sincronizando esquema de base de datos.');

  const { stdout, stderr } = await execFileAsync(prismaCli, ['prisma', ...args], {
    cwd: process.cwd(),
    env: process.env,
  });

  if (stdout.trim().length > 0) {
    logger.debug({ command, stdout: stdout.trim() }, 'Salida de Prisma CLI.');
  }

  if (stderr.trim().length > 0) {
    logger.warn({ command, stderr: stderr.trim() }, 'Prisma CLI reportó advertencias.');
  }
};

const synchronizeSchemaInternal = async (): Promise<void> => {
  if (!env.DB_AUTO_APPLY_SCHEMA) {
    logger.info('Sincronización automática del esquema deshabilitada por configuración.');
    return;
  }

  const hasMigrations = await detectMigrations();
  const args = hasMigrations ? ['migrate', 'deploy'] : ['db', 'push', '--skip-generate'];

  try {
    await runPrismaCli(args);
  } catch (error) {
    logger.error({ err: error, command: `prisma ${args.join(' ')}` }, 'No fue posible sincronizar el esquema de Prisma.');
    throw error;
  }
};

export const synchronizeDatabaseSchema = async (): Promise<void> => {
  if (schemaSynced) {
    return;
  }

  if (!schemaSyncPromise) {
    schemaSyncPromise = synchronizeSchemaInternal()
      .then(() => {
        schemaSynced = true;
        logger.info('Esquema de base de datos sincronizado correctamente.');
      })
      .catch((error) => {
        schemaSyncPromise = null;
        throw error;
      });
  }

  await schemaSyncPromise;
};

export const ensureDatabaseConnection = async (): Promise<void> => {
  try {
    await synchronizeDatabaseSchema();
    await prisma.$connect();
    logger.debug('Conexión con Prisma establecida.');
  } catch (error) {
    logger.error({ err: error }, 'No fue posible conectar con la base de datos.');
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
