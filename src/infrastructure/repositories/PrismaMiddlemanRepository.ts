// ============================================================================
// RUTA: src/infrastructure/repositories/PrismaMiddlemanRepository.ts
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client';

import type {
  IMiddlemanRepository,
  MiddlemanClaim,
  MiddlemanProfile,
} from '@/domain/repositories/IMiddlemanRepository';
import type { TransactionContext } from '@/domain/repositories/transaction';

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

type PrismaClaim = Prisma.MiddlemanClaimGetPayload<Record<string, never>>;

export class PrismaMiddlemanRepository implements IMiddlemanRepository {
  public constructor(private readonly prisma: PrismaClientLike) {}

  public withTransaction(context: TransactionContext): IMiddlemanRepository {
    if (!PrismaMiddlemanRepository.isTransactionClient(context)) {
      throw new Error('Invalid Prisma transaction context provided to middleman repository.');
    }

    return new PrismaMiddlemanRepository(context);
  }

  public async isMiddleman(userId: bigint): Promise<boolean> {
    const middleman = await this.prisma.middleman.findUnique({ where: { userId } });
    return middleman !== null;
  }

  public async getClaimByTicket(ticketId: number): Promise<MiddlemanClaim | null> {
    const claim = await this.prisma.middlemanClaim.findUnique({ where: { ticketId } });
    return claim ? this.toDomain(claim) : null;
  }

  public async createClaim(ticketId: number, middlemanId: bigint): Promise<void> {
    await this.prisma.middlemanClaim.create({
      data: {
        ticketId,
        middlemanId,
      },
    });
  }

  public async markClosed(ticketId: number, payload: { closedAt: Date; forcedClose?: boolean }): Promise<void> {
    await this.prisma.middlemanClaim.update({
      where: { ticketId },
      data: {
        closedAt: payload.closedAt,
        forcedClose: payload.forcedClose ?? false,
      },
    });
  }

  public async markReviewRequested(ticketId: number, requestedAt: Date): Promise<void> {
    await this.prisma.middlemanClaim.update({
      where: { ticketId },
      data: { reviewRequestedAt: requestedAt },
    });
  }

  public async upsertProfile(data: { userId: bigint; robloxUsername: string; robloxUserId?: bigint | null }): Promise<void> {
    await this.prisma.middleman.upsert({
      where: { userId: data.userId },
      update: {
        robloxUsername: data.robloxUsername,
        robloxUserId: data.robloxUserId ?? null,
      },
      create: {
        userId: data.userId,
        robloxUsername: data.robloxUsername,
        robloxUserId: data.robloxUserId ?? null,
      },
    });
  }

  public async updateProfile(data: {
    userId: bigint;
    robloxUsername?: string | null;
    robloxUserId?: bigint | null;
  }): Promise<void> {
    try {
      await this.prisma.middleman.update({
        where: { userId: data.userId },
        data: {
          robloxUsername: data.robloxUsername ?? undefined,
          robloxUserId: data.robloxUserId ?? undefined,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        await this.upsertProfile({
          userId: data.userId,
          robloxUsername: data.robloxUsername ?? 'Sin registrar',
          robloxUserId: data.robloxUserId ?? null,
        });
        return;
      }

      throw error;
    }
  }

  public async getProfile(userId: bigint): Promise<MiddlemanProfile | null> {
    const rows = await this.prisma.$queryRaw<Array<{
      user_id: bigint;
      roblox_username: string;
      roblox_user_id: bigint | null;
      vouches_count: bigint | number | null;
      rating_sum: bigint | number | null;
      rating_count: bigint | number | null;
    }>>`
      SELECT m.user_id, m.roblox_username, m.roblox_user_id,
        COALESCE(vc.vouches_count, 0) AS vouches_count,
        COALESCE(rr.rating_sum, 0) AS rating_sum,
        COALESCE(rr.rating_count, 0) AS rating_count
      FROM middlemen m
      LEFT JOIN (
        SELECT middleman_id, COUNT(*) AS vouches_count
        FROM mm_claims
        WHERE vouched = TRUE
        GROUP BY middleman_id
      ) vc ON vc.middleman_id = m.user_id
      LEFT JOIN (
        SELECT middleman_id, SUM(stars) AS rating_sum, COUNT(*) AS rating_count
        FROM mm_reviews
        GROUP BY middleman_id
      ) rr ON rr.middleman_id = m.user_id
      WHERE m.user_id = ${userId}
      LIMIT 1;
    `;

    const row = rows[0];
    return row ? PrismaMiddlemanRepository.mapProfile(row) : null;
  }

  public async listTopProfiles(limit = 10): Promise<readonly MiddlemanProfile[]> {
    const safeLimit = Math.max(1, Math.min(50, Number.isFinite(limit) ? Number(limit) : 10));

    const rows = await this.prisma.$queryRaw<Array<{
      user_id: bigint;
      roblox_username: string;
      roblox_user_id: bigint | null;
      vouches_count: bigint | number | null;
      rating_sum: bigint | number | null;
      rating_count: bigint | number | null;
    }>>`
      SELECT stats.user_id, stats.roblox_username, stats.roblox_user_id,
        stats.vouches_count, stats.rating_sum, stats.rating_count
      FROM (
        SELECT m.user_id, m.roblox_username, m.roblox_user_id,
          COALESCE(vc.vouches_count, 0) AS vouches_count,
          COALESCE(rr.rating_sum, 0) AS rating_sum,
          COALESCE(rr.rating_count, 0) AS rating_count,
          m.updated_at
        FROM middlemen m
        LEFT JOIN (
          SELECT middleman_id, COUNT(*) AS vouches_count
          FROM mm_claims
          WHERE vouched = TRUE
          GROUP BY middleman_id
        ) vc ON vc.middleman_id = m.user_id
        LEFT JOIN (
          SELECT middleman_id, SUM(stars) AS rating_sum, COUNT(*) AS rating_count
          FROM mm_reviews
          GROUP BY middleman_id
        ) rr ON rr.middleman_id = m.user_id
      ) stats
      ORDER BY stats.vouches_count DESC,
        CASE WHEN stats.rating_count > 0 THEN stats.rating_sum / stats.rating_count ELSE NULL END DESC,
        stats.rating_count DESC,
        stats.updated_at DESC
      LIMIT ${safeLimit};
    `;

    return rows.map((row) => PrismaMiddlemanRepository.mapProfile(row));
  }

  private toDomain(claim: PrismaClaim): MiddlemanClaim {
    return {
      ticketId: claim.ticketId,
      middlemanId: claim.middlemanId,
      claimedAt: claim.claimedAt,
      reviewRequestedAt: claim.reviewRequestedAt ?? undefined,
      closedAt: claim.closedAt ?? undefined,
      forcedClose: claim.forcedClose ?? undefined,
    };
  }

  private static isTransactionClient(value: TransactionContext): value is Prisma.TransactionClient {
    return typeof value === 'object' && value !== null && 'middlemanClaim' in value;
  }

  private static mapProfile(row: {
    user_id: bigint;
    roblox_username: string;
    roblox_user_id: bigint | null;
    vouches_count: bigint | number | null;
    rating_sum: bigint | number | null;
    rating_count: bigint | number | null;
  }): MiddlemanProfile {
    return {
      userId: row.user_id,
      robloxUsername: row.roblox_username,
      robloxUserId: row.roblox_user_id,
      vouches: Number(row.vouches_count ?? 0),
      ratingSum: Number(row.rating_sum ?? 0),
      ratingCount: Number(row.rating_count ?? 0),
    };
  }
}
