// ============================================================================
// RUTA: src/infrastructure/repositories/PrismaMemberStatsRepository.ts
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client';

import type { IMemberStatsRepository } from '@/domain/repositories/IMemberStatsRepository';
import type { TransactionContext } from '@/domain/repositories/transaction';
import { ensureUsersExist } from '@/infrastructure/repositories/utils/ensureUsersExist';

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

export class PrismaMemberStatsRepository implements IMemberStatsRepository {
  public constructor(private readonly prisma: PrismaClientLike) {}

  public withTransaction(context: TransactionContext): IMemberStatsRepository {
    if (!PrismaMemberStatsRepository.isTransactionClient(context)) {
      throw new Error('Invalid Prisma transaction context provided to member stats repository.');
    }

    return new PrismaMemberStatsRepository(context);
  }

  public async recordCompletedTrade(userId: bigint, completedAt: Date): Promise<void> {
    await ensureUsersExist(this.prisma, [userId]);

    await this.prisma.memberTradeStats.upsert({
      where: { userId },
      create: {
        userId,
        tradesCompleted: 1,
        lastTradeAt: completedAt,
      },
      update: {
        tradesCompleted: { increment: 1 },
        lastTradeAt: completedAt,
      },
    });
  }

  private static isTransactionClient(value: TransactionContext): value is Prisma.TransactionClient {
    return typeof value === 'object' && value !== null && 'memberTradeStats' in value;
  }
}
