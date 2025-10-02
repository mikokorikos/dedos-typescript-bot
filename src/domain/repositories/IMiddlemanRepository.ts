// ============================================================================
// RUTA: src/domain/repositories/IMiddlemanRepository.ts
// ============================================================================

import type { Transactional } from '@/domain/repositories/transaction';

export interface MiddlemanClaim {
  readonly ticketId: number;
  readonly middlemanId: bigint;
  readonly claimedAt: Date;
  readonly reviewRequestedAt?: Date | null;
  readonly closedAt?: Date | null;
  readonly forcedClose?: boolean;
}

export interface MiddlemanProfile {
  readonly userId: bigint;
  readonly robloxUsername: string;
  readonly robloxUserId: bigint | null;
  readonly vouches: number;
  readonly ratingSum: number;
  readonly ratingCount: number;
}

export interface IMiddlemanRepository extends Transactional<IMiddlemanRepository> {
  isMiddleman(userId: bigint): Promise<boolean>;
  getClaimByTicket(ticketId: number): Promise<MiddlemanClaim | null>;
  createClaim(ticketId: number, middlemanId: bigint): Promise<void>;
  markClosed(ticketId: number, payload: { closedAt: Date; forcedClose?: boolean }): Promise<void>;
  markReviewRequested(ticketId: number, requestedAt: Date): Promise<void>;
  upsertProfile(data: { userId: bigint; robloxUsername: string; robloxUserId?: bigint | null }): Promise<void>;
  updateProfile(data: { userId: bigint; robloxUsername?: string | null; robloxUserId?: bigint | null }): Promise<void>;
  getProfile(userId: bigint): Promise<MiddlemanProfile | null>;
  listTopProfiles(limit?: number): Promise<readonly MiddlemanProfile[]>;
}
