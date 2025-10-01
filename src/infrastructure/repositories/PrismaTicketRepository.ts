// ============================================================================
// RUTA: src/infrastructure/repositories/PrismaTicketRepository.ts
// ============================================================================

import type { Prisma, PrismaClient } from '@prisma/client';

import { Ticket } from '@/domain/entities/Ticket';
import type { TicketType } from '@/domain/entities/types';
import { TicketStatus } from '@/domain/entities/types';
import type {
  CreateTicketData,
  ITicketRepository,
  TicketParticipantInput,
} from '@/domain/repositories/ITicketRepository';
import type { TransactionContext } from '@/domain/repositories/transaction';

const OPEN_STATUSES: TicketStatus[] = [
  TicketStatus.OPEN,
  TicketStatus.CONFIRMED,
  TicketStatus.CLAIMED,
];

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

type PrismaTicketWithRelations = Prisma.TicketGetPayload<{
  include: {
    middlemanClaim: true;
  };
}>;

const mapParticipant = (participant: TicketParticipantInput) => ({
  userId: participant.userId,
  role: participant.role ?? null,
  joinedAt: participant.joinedAt ?? new Date(),
});

export class PrismaTicketRepository implements ITicketRepository {
  public constructor(private readonly prisma: PrismaClientLike) {}

  public withTransaction(context: TransactionContext): ITicketRepository {
    if (!PrismaTicketRepository.isTransactionClient(context)) {
      throw new Error('Invalid Prisma transaction context provided to ticket repository.');
    }

    return new PrismaTicketRepository(context);
  }

  public async create(data: CreateTicketData): Promise<Ticket> {
    const ticket = await this.prisma.ticket.create({
      data: {
        guildId: data.guildId,
        channelId: data.channelId,
        ownerId: data.ownerId,
        type: data.type,
        status: data.status ?? TicketStatus.OPEN,
        participants: data.participants
          ? {
              create: data.participants.map(mapParticipant),
            }
          : undefined,
      },
      include: { middlemanClaim: true },
    });

    return this.toDomain(ticket);
  }

  public async findById(id: number): Promise<Ticket | null> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { middlemanClaim: true },
    });

    return ticket ? this.toDomain(ticket) : null;
  }

  public async findByChannelId(channelId: bigint): Promise<Ticket | null> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { channelId },
      include: { middlemanClaim: true },
    });

    return ticket ? this.toDomain(ticket) : null;
  }

  public async findOpenByOwner(ownerId: bigint): Promise<readonly Ticket[]> {
    const tickets = await this.prisma.ticket.findMany({
      where: {
        ownerId,
        status: { in: OPEN_STATUSES },
      },
      include: { middlemanClaim: true },
    });

    return tickets.map((ticket) => this.toDomain(ticket));
  }

  public async update(ticket: Ticket): Promise<void> {
    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: ticket.status,
        closedAt: ticket.closedAt ?? null,
      },
    });
  }

  public async delete(id: number): Promise<void> {
    await this.prisma.ticket.delete({ where: { id } });
  }

  public async countOpenByOwner(ownerId: bigint): Promise<number> {
    return this.prisma.ticket.count({
      where: {
        ownerId,
        status: { in: OPEN_STATUSES },
      },
    });
  }

  public async isParticipant(ticketId: number, userId: bigint): Promise<boolean> {
    const participant = await this.prisma.ticketParticipant.findFirst({
      where: {
        ticketId,
        userId,
      },
    });

    return participant !== null;
  }

  public async listParticipants(ticketId: number): Promise<readonly TicketParticipantInput[]> {
    const participants = await this.prisma.ticketParticipant.findMany({
      where: { ticketId },
    });

    return participants.map((participant) => ({
      userId: participant.userId,
      role: participant.role,
      joinedAt: participant.joinedAt,
    }));
  }

  private toDomain(ticket: PrismaTicketWithRelations): Ticket {
    return new Ticket(
      ticket.id,
      ticket.guildId,
      ticket.channelId,
      ticket.ownerId,
      ticket.type as TicketType,
      ticket.status as TicketStatus,
      ticket.createdAt,
      ticket.closedAt ?? undefined,
      ticket.middlemanClaim?.middlemanId ?? undefined,
    );
  }

  private static isTransactionClient(value: TransactionContext): value is Prisma.TransactionClient {
    return typeof value === 'object' && value !== null && 'ticket' in value;
  }
}
