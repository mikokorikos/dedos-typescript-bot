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
import { ensureUsersExist } from '@/infrastructure/repositories/utils/ensureUsersExist';

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

  public async upsertProfile(data: {
    userId: bigint;
    robloxUsername: string;
    robloxUserId?: bigint | null;
    verified?: boolean;
  }): Promise<void> {
    await ensureUsersExist(this.prisma, [data.userId]);

    const identity = await this.prisma.userRobloxIdentity.upsert({
      where: { userId_robloxUsername: { userId: data.userId, robloxUsername: data.robloxUsername } },
      update: {
        robloxUserId: data.robloxUserId === undefined ? undefined : data.robloxUserId ?? null,
        verified: data.verified ?? undefined,
        lastUsedAt: new Date(),
      },
      create: {
        userId: data.userId,
        robloxUsername: data.robloxUsername,
        robloxUserId: data.robloxUserId ?? null,
        verified: data.verified ?? false,
        lastUsedAt: new Date(),
      },
    });

    await this.prisma.middleman.upsert({
      where: { userId: data.userId },
      update: { primaryRobloxIdentityId: identity.id },
      create: { userId: data.userId, primaryRobloxIdentityId: identity.id },
    });
  }

  public async updateProfile(data: {
    userId: bigint;
    robloxUsername?: string | null;
    robloxUserId?: bigint | null;
    verified?: boolean;
  }): Promise<void> {
    await ensureUsersExist(this.prisma, [data.userId]);

    const middleman = await this.prisma.middleman.findUnique({
      where: { userId: data.userId },
      select: { primaryRobloxIdentityId: true },
    });

    if (!middleman) {
      await this.upsertProfile({
        userId: data.userId,
        robloxUsername: data.robloxUsername ?? 'Sin registrar',
        robloxUserId: data.robloxUserId ?? null,
        verified: data.verified,
      });
      return;
    }

    if (data.robloxUsername === null) {
      await this.prisma.middleman.update({
        where: { userId: data.userId },
        data: { primaryRobloxIdentityId: null },
      });
      return;
    }

    if (data.robloxUsername !== undefined) {
      const identity = await this.prisma.userRobloxIdentity.upsert({
        where: {
          userId_robloxUsername: {
            userId: data.userId,
            robloxUsername: data.robloxUsername,
          },
        },
        update: {
          robloxUserId: data.robloxUserId === undefined ? undefined : data.robloxUserId ?? null,
          verified: data.verified ?? undefined,
          lastUsedAt: new Date(),
        },
        create: {
          userId: data.userId,
          robloxUsername: data.robloxUsername,
          robloxUserId: data.robloxUserId ?? null,
          verified: data.verified ?? false,
          lastUsedAt: new Date(),
        },
      });

      await this.prisma.middleman.update({
        where: { userId: data.userId },
        data: { primaryRobloxIdentityId: identity.id },
      });

      return;
    }

    if (middleman.primaryRobloxIdentityId === null) {
      return;
    }

    await this.prisma.userRobloxIdentity.update({
      where: { id: middleman.primaryRobloxIdentityId },
      data: {
        robloxUserId: data.robloxUserId === undefined ? undefined : data.robloxUserId ?? null,
        verified: data.verified ?? undefined,
        lastUsedAt: new Date(),
      },
    });
  }

  public async getProfile(userId: bigint): Promise<MiddlemanProfile | null> {
    const rows = await this.prisma.$queryRaw<Array<{
      user_id: bigint;
      identity_id: number | null;
      identity_username: string | null;
      identity_user_id: bigint | null;
      identity_verified: boolean | null;
      identity_last_used_at: Date | null;
      vouches_count: bigint | number | null;
      rating_sum: bigint | number | null;
      rating_count: bigint | number | null;
    }>>`
      SELECT m.user_id,
        pri.id AS identity_id,
        pri.roblox_username AS identity_username,
        pri.roblox_user_id AS identity_user_id,
        pri.verified AS identity_verified,
        pri.last_used_at AS identity_last_used_at,
        COALESCE(vc.vouches_count, 0) AS vouches_count,
        COALESCE(rr.rating_sum, 0) AS rating_sum,
        COALESCE(rr.rating_count, 0) AS rating_count
      FROM middlemen m
      LEFT JOIN user_roblox_identities pri ON pri.id = m.primary_roblox_identity_id
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
      identity_id: number | null;
      identity_username: string | null;
      identity_user_id: bigint | null;
      identity_verified: boolean | null;
      identity_last_used_at: Date | null;
      vouches_count: bigint | number | null;
      rating_sum: bigint | number | null;
      rating_count: bigint | number | null;
      updated_at: Date;
    }>>`
      SELECT stats.user_id,
        stats.identity_id,
        stats.identity_username,
        stats.identity_user_id,
        stats.identity_verified,
        stats.identity_last_used_at,
        stats.vouches_count,
        stats.rating_sum,
        stats.rating_count,
        stats.updated_at
      FROM (
        SELECT m.user_id,
          pri.id AS identity_id,
          pri.roblox_username AS identity_username,
          pri.roblox_user_id AS identity_user_id,
          pri.verified AS identity_verified,
          pri.last_used_at AS identity_last_used_at,
          COALESCE(vc.vouches_count, 0) AS vouches_count,
          COALESCE(rr.rating_sum, 0) AS rating_sum,
          COALESCE(rr.rating_count, 0) AS rating_count,
          m.updated_at
        FROM middlemen m
        LEFT JOIN user_roblox_identities pri ON pri.id = m.primary_roblox_identity_id
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
    identity_id: number | null;
    identity_username: string | null;
    identity_user_id: bigint | null;
    identity_verified: boolean | null;
    identity_last_used_at: Date | null;
    vouches_count: bigint | number | null;
    rating_sum: bigint | number | null;
    rating_count: bigint | number | null;
  }): MiddlemanProfile {
    const primaryIdentity =
      row.identity_id === null || row.identity_username === null
        ? null
        : {
            id: row.identity_id,
            username: row.identity_username,
            robloxUserId: row.identity_user_id,
            verified: Boolean(row.identity_verified),
            lastUsedAt: row.identity_last_used_at ?? null,
          };

    return {
      userId: row.user_id,
      primaryIdentity,
      vouches: Number(row.vouches_count ?? 0),
      ratingSum: Number(row.rating_sum ?? 0),
      ratingCount: Number(row.rating_count ?? 0),
    };
  }
}
