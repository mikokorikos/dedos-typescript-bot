// ============================================================================
// RUTA: src/application/usecases/middleman/OpenMiddlemanChannelUseCase.ts
// ============================================================================

import type { Guild, TextChannel } from 'discord.js';
import { ChannelType, OverwriteType, PermissionFlagsBits } from 'discord.js';
import type { Logger } from 'pino';

import { type CreateMiddlemanTicketDTO,CreateMiddlemanTicketSchema } from '@/application/dto/ticket.dto';
import { TicketType } from '@/domain/entities/types';
import type { ITicketRepository, TicketParticipantInput } from '@/domain/repositories/ITicketRepository';
import type { EmbedFactory } from '@/presentation/embeds/EmbedFactory';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import {
  ChannelCleanupError,
  ChannelCreationError,
  TooManyOpenTicketsError,
  ValidationFailedError,
} from '@/shared/errors/domain.errors';
import { sanitizeChannelName } from '@/shared/utils/discord.utils';

const MAX_OPEN_TICKETS = 3;
const SNOWFLAKE_EXTRACTOR = /\d{17,20}/u;

interface TransactionProvider {
  $transaction<T>(fn: (context: unknown) => Promise<T>): Promise<T>;
}

const extractSnowflake = (value?: string): bigint | undefined => {
  if (!value) {
    return undefined;
  }

  const match = value.match(SNOWFLAKE_EXTRACTOR);
  if (!match) {
    return undefined;
  }

  return BigInt(match[0]);
};

export class OpenMiddlemanChannelUseCase {
  public constructor(
    private readonly ticketRepo: ITicketRepository,
    private readonly transactions: TransactionProvider,
    private readonly logger: Logger,
    private readonly embeds: EmbedFactory = embedFactory,
  ) {}

  public async execute(
    dto: CreateMiddlemanTicketDTO,
    guild: Guild,
  ): Promise<{ ticket: Awaited<ReturnType<ITicketRepository['create']>>; channel: TextChannel }> {
    const payload = CreateMiddlemanTicketSchema.parse(dto);
    const ownerId = BigInt(payload.userId);
    const guildId = BigInt(payload.guildId);

    this.logger.debug({ ownerId: payload.userId }, 'Validando límite de tickets abiertos.');
    const openTickets = await this.ticketRepo.countOpenByOwner(ownerId);
    if (openTickets >= MAX_OPEN_TICKETS) {
      throw new TooManyOpenTicketsError(MAX_OPEN_TICKETS);
    }

    const channelName = sanitizeChannelName(`mm-${payload.userId}`);
    const botId = guild.members.me?.id;

    if (!botId) {
      throw new ChannelCreationError('El bot no está presente en el gremio.');
    }

    this.logger.debug({ channelName, guildId: payload.guildId }, 'Creando canal de middleman.');

    const partnerId = extractSnowflake(payload.partnerTag);

    if (!partnerId) {
      throw new ValidationFailedError({
        partnerTag: 'Debes mencionar o introducir el ID de la persona con la que haras el trade.',
      });
    }

    let createdChannel: TextChannel;
    try {
      createdChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        topic: payload.context.slice(0, 1000),
        parent: payload.categoryId,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel],
            type: OverwriteType.Role,
          },
          {
            id: payload.userId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
            type: OverwriteType.Member,
          },
          {
            id: partnerId.toString(),
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
            type: OverwriteType.Member,
          },
          {
            id: botId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ReadMessageHistory,
            ],
            type: OverwriteType.Member,
          },
        ],
      });
    } catch (error) {
      this.logger.error({ err: error, channelName }, 'Falló la creación del canal de middleman.');
      throw new ChannelCreationError((error as Error).message);
    }

    const participants: TicketParticipantInput[] = [
      { userId: ownerId, role: 'OWNER' },
      { userId: partnerId, role: 'PARTNER' },
    ];

    try {
      const ticket = await this.transactions.$transaction(async (tx) => {
        const transactionalRepo = this.ticketRepo.withTransaction(tx);

        return transactionalRepo.create({
          guildId,
          channelId: BigInt(createdChannel.id),
          ownerId,
          type: TicketType.MM,
          participants,
        });
      });

      const embed = this.embeds.ticketCreated({
        ticketId: ticket.id,
        type: 'Middleman',
        ownerTag: `<@${payload.userId}>`,
        description: payload.context,
      });

      await createdChannel.send({
        content: `<@${payload.userId}> <@${partnerId}>`,
        embeds: [embed],
      });

      if (payload.robloxUsername) {
        await createdChannel.send({
          embeds: [
            this.embeds.info({
              title: 'Datos Roblox',
              description: `Nombre proporcionado: **${payload.robloxUsername}**`,
            }),
          ],
        });
      }

      this.logger.info(
        { ticketId: ticket.id, channelId: createdChannel.id, ownerId: payload.userId },
        'Ticket de middleman creado exitosamente.',
      );

      return { ticket, channel: createdChannel };
    } catch (error) {
      this.logger.error({ err: error, ownerId: payload.userId }, 'Fallo al persistir ticket de middleman.');

      try {
        await createdChannel.delete('Error al registrar el ticket de middleman.');
      } catch (cleanupError) {
        this.logger.error(
          { err: cleanupError, channelId: createdChannel.id },
          'Fallo al limpiar canal tras error.',
        );
        throw new ChannelCleanupError(createdChannel.id, cleanupError);
      }

      throw error;
    }
  }
}
