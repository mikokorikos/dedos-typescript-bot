import type { Guild, TextChannel } from 'discord.js';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenMiddlemanChannelUseCase } from '@/application/usecases/middleman/OpenMiddlemanChannelUseCase';
import { Ticket } from '@/domain/entities/Ticket';
import { TicketStatus } from '@/domain/entities/types';
import type {
  CreateTicketData,
  ITicketRepository,
} from '@/domain/repositories/ITicketRepository';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import { TooManyOpenTicketsError } from '@/shared/errors/domain.errors';

class MockTicketRepository implements ITicketRepository {
  public createCalled = false;
  private openTickets = 0;
  private failOnCreate: Error | null = null;
  private idCounter = 1;

  public withTransaction(): ITicketRepository {
    return this;
  }

  public setOpenTickets(count: number): void {
    this.openTickets = count;
  }

  public failNextCreate(error: Error): void {
    this.failOnCreate = error;
  }

  public async create(data: CreateTicketData): Promise<Ticket> {
    if (this.failOnCreate) {
      throw this.failOnCreate;
    }

    this.createCalled = true;
    return new Ticket(
      this.idCounter++,
      data.guildId,
      data.channelId,
      data.ownerId,
      data.type,
      data.status ?? TicketStatus.OPEN,
      new Date(),
    );
  }

  public async findById(): Promise<Ticket | null> {
    return null;
  }

  public async findByChannelId(): Promise<Ticket | null> {
    return null;
  }

  public async findOpenByOwner(): Promise<readonly Ticket[]> {
    return [];
  }

  public async update(): Promise<void> {}

  public async delete(): Promise<void> {}

  public async countOpenByOwner(): Promise<number> {
    return this.openTickets;
  }

  public async isParticipant(): Promise<boolean> {
    return true;
  }
}

const createMockLogger = (): Logger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'silent',
  } as unknown as Logger);

const createMockGuild = (channel: TextChannel): Guild =>
  ({
    id: '456',
    roles: { everyone: { id: 'everyone' } },
    members: { me: { id: 'bot-id' } },
    channels: {
      create: vi.fn().mockResolvedValue(channel),
    },
  } as unknown as Guild);

describe('OpenMiddlemanChannelUseCase', () => {
  let repo: MockTicketRepository;
  let useCase: OpenMiddlemanChannelUseCase;
  let logger: Logger;
  let guild: Guild;
  let channel: TextChannel & { delete: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
  let transactions: { $transaction: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    repo = new MockTicketRepository();
    logger = createMockLogger();
    channel = {
      id: '999',
      send: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      toString: vi.fn().mockReturnValue('<#999>'),
    } as unknown as TextChannel & { delete: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
    guild = createMockGuild(channel);
    transactions = {
      $transaction: vi.fn(async (fn: (context: unknown) => Promise<unknown>) => fn({})),
    };
    useCase = new OpenMiddlemanChannelUseCase(repo, transactions, logger, embedFactory);
  });

  it('should create ticket and channel successfully', async () => {
    const result = await useCase.execute(
      {
        userId: '123',
        guildId: '456',
        type: 'MM',
        context: 'Un contexto suficientemente largo para crear ticket.',
        partnerTag: '<@123456789012345678>',
        categoryId: '999999999999999999',
      },
      guild,
    );

    expect(result.ticket).toBeDefined();
    expect(result.channel).toBe(channel);
    expect(repo.createCalled).toBe(true);
    expect(channel.send).toHaveBeenCalled();
    expect(transactions.$transaction).toHaveBeenCalled();
    const createArgs = (guild.channels.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArgs.permissionOverwrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: '123' }),
        expect.objectContaining({ id: '123456789012345678' }),
      ]),
    );
  });

  it('should throw error if user has too many open tickets', async () => {
    repo.setOpenTickets(3);

    await expect(
      useCase.execute(
        {
          userId: '123',
          guildId: '456',
          type: 'MM',
          context: 'Un contexto suficientemente largo para crear ticket.',
          partnerTag: '<@123456789012345678>',
          categoryId: '999999999999999999',
        },
        guild,
      ),
    ).rejects.toBeInstanceOf(TooManyOpenTicketsError);
  });

  it('should rollback channel if DB creation fails', async () => {
    repo.failNextCreate(new Error('DB Error'));

    await expect(
      useCase.execute(
        {
          userId: '123',
          guildId: '456',
          type: 'MM',
          context: 'Un contexto suficientemente largo para crear ticket.',
          partnerTag: '<@123456789012345678>',
          categoryId: '999999999999999999',
        },
        guild,
      ),
    ).rejects.toThrow('DB Error');

    expect(channel.delete).toHaveBeenCalled();
  });
});
