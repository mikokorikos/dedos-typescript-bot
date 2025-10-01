// ============================================================================
// RUTA: src/presentation/commands/middleman/middleman.ts
// ============================================================================

import {
  ChannelType,
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';

import { reviewInviteStore } from '@/application/services/ReviewInviteStore';
import { ClaimTradeUseCase } from '@/application/usecases/middleman/ClaimTradeUseCase';
import { CloseTradeUseCase } from '@/application/usecases/middleman/CloseTradeUseCase';
import { OpenMiddlemanChannelUseCase } from '@/application/usecases/middleman/OpenMiddlemanChannelUseCase';
import { SubmitReviewUseCase } from '@/application/usecases/middleman/SubmitReviewUseCase';
import { prisma } from '@/infrastructure/db/prisma';
import { PrismaMemberStatsRepository } from '@/infrastructure/repositories/PrismaMemberStatsRepository';
import { PrismaMiddlemanRepository } from '@/infrastructure/repositories/PrismaMiddlemanRepository';
import { PrismaReviewRepository } from '@/infrastructure/repositories/PrismaReviewRepository';
import { PrismaTicketRepository } from '@/infrastructure/repositories/PrismaTicketRepository';
import { PrismaTradeRepository } from '@/infrastructure/repositories/PrismaTradeRepository';
import type { Command } from '@/presentation/commands/types';
import { buildReviewButtonRow,REVIEW_BUTTON_CUSTOM_ID } from '@/presentation/components/buttons/ReviewButtons';
import { MiddlemanModal } from '@/presentation/components/modals/MiddlemanModal';
import { ReviewModal } from '@/presentation/components/modals/ReviewModal';
import { modalHandlers, registerButtonHandler, registerModalHandler } from '@/presentation/components/registry';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import { env } from '@/shared/config/env';
import { mapErrorToDiscordResponse } from '@/shared/errors/discord-error-mapper';
import { TicketNotFoundError, UnauthorizedActionError } from '@/shared/errors/domain.errors';
import { logger } from '@/shared/logger/pino';

const ticketRepo = new PrismaTicketRepository(prisma);
const tradeRepo = new PrismaTradeRepository(prisma);
const statsRepo = new PrismaMemberStatsRepository(prisma);
const middlemanRepo = new PrismaMiddlemanRepository(prisma);
const reviewRepo = new PrismaReviewRepository(prisma);

const openUseCase = new OpenMiddlemanChannelUseCase(ticketRepo, prisma, logger, embedFactory);
const claimUseCase = new ClaimTradeUseCase(ticketRepo, middlemanRepo, logger, embedFactory);
const closeUseCase = new CloseTradeUseCase(ticketRepo, tradeRepo, statsRepo, middlemanRepo, prisma, logger, embedFactory);
const submitReviewUseCase = new SubmitReviewUseCase(reviewRepo, ticketRepo, embedFactory, logger);

registerModalHandler('middleman-open', async (interaction) => {
  await MiddlemanModal.handleSubmit(interaction, openUseCase);
});

registerButtonHandler(REVIEW_BUTTON_CUSTOM_ID, async (interaction) => {
  const invite = reviewInviteStore.get(interaction.message.id);

  if (!invite) {
    await interaction.reply({
      embeds: [
        embedFactory.warning({
          title: 'Formulario no disponible',
          description: 'Esta invitación de reseña ha expirado. Solicita al staff que envíe una nueva.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  const isParticipant = await ticketRepo.isParticipant(invite.ticketId, BigInt(interaction.user.id));
  if (!isParticipant) {
    await interaction.reply({
      embeds: [
        embedFactory.error({
          title: 'No puedes reseñar este ticket',
          description: 'Solo los participantes del ticket pueden enviar una reseña.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  const modalCustomId = `review:${invite.ticketId}:${invite.middlemanId}:${interaction.user.id}`;

  if (modalHandlers.has(modalCustomId)) {
    modalHandlers.delete(modalCustomId);
  }

  registerModalHandler(modalCustomId, async (modalInteraction) => {
    try {
      const { rating, comment } = ReviewModal.parseFields(modalInteraction);

      if (!env.REVIEW_CHANNEL_ID) {
        await modalInteraction.reply({
          embeds: [
            embedFactory.error({
              title: 'Configuración incompleta',
              description:
                'No se pudo encontrar el canal de reseñas. Un administrador debe establecer `REVIEW_CHANNEL_ID` en el .env.',
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      const channel = await modalInteraction.client.channels.fetch(env.REVIEW_CHANNEL_ID);

      if (!channel || !channel.isTextBased()) {
        await modalInteraction.reply({
          embeds: [
            embedFactory.error({
              title: 'Canal inválido',
              description: 'El canal de reseñas configurado no es un canal de texto válido.',
            }),
          ],
          ephemeral: true,
        });
        return;
      }

      await submitReviewUseCase.execute(
        {
          ticketId: invite.ticketId,
          reviewerId: modalInteraction.user.id,
          middlemanId: invite.middlemanId,
          rating,
          comment: comment ?? undefined,
        },
        channel as TextChannel,
      );

      await modalInteraction.reply({
        embeds: [
          embedFactory.success({
            title: '¡Gracias por tu reseña!',
            description: 'Tu valoración se ha publicado correctamente en el canal de reseñas.',
          }),
        ],
        ephemeral: true,
      });
    } catch (error) {
      const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);

      if (shouldLogStack) {
        logger.error({ err: error, referenceId }, 'Error inesperado al registrar reseña de middleman.');
      } else {
        logger.warn({ err: error, referenceId }, 'Error controlado al registrar reseña de middleman.');
      }

      await modalInteraction.reply({
        ...payload,
        embeds:
          embeds ?? [
            embedFactory.error({
              title: 'No se pudo registrar la reseña',
              description: 'Ocurrió un error al procesar tu reseña. Inténtalo nuevamente en unos minutos.',
            }),
          ],
        ephemeral: true,
      });
    } finally {
      modalHandlers.delete(modalCustomId);
    }
  });

  await interaction.showModal(ReviewModal.build(modalCustomId));
});

const ensureTextChannel = (interaction: ChatInputCommandInteraction): TextChannel => {
  if (!interaction.guild) {
    throw new UnauthorizedActionError('middleman:command:guild-only');
  }

  const channel = interaction.channel;

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new UnauthorizedActionError('middleman:command:channel');
  }

  return channel;
};

const handleOpen = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        embedFactory.error({
          title: 'Acción no disponible',
          description: 'Este comando solo puede utilizarse dentro de un servidor.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(MiddlemanModal.build());
};

const handleClaim = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const channel = ensureTextChannel(interaction);
  const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

  if (!ticket) {
    throw new TicketNotFoundError(channel.id);
  }

  await interaction.deferReply({ ephemeral: true });
  await claimUseCase.execute({ ticketId: ticket.id, middlemanId: interaction.user.id }, channel);

  await interaction.editReply({
    embeds: [
      embedFactory.success({
        title: 'Ticket reclamado',
        description: 'Ahora tienes control del ticket. Continúa con el flujo de validación en el canal.',
      }),
    ],
  });
};

const handleClose = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const channel = ensureTextChannel(interaction);
  const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

  if (!ticket) {
    throw new TicketNotFoundError(channel.id);
  }

  await interaction.deferReply({ ephemeral: true });
  await closeUseCase.execute(ticket.id, BigInt(interaction.user.id), channel);

  const participants = await ticketRepo.listParticipants(ticket.id);
  const reviewerIds = new Set(
    participants
      .map((participant) => participant.userId.toString())
      .filter((participantId) => participantId !== interaction.user.id),
  );

  const mentions = Array.from(reviewerIds)
    .map((participantId) => `<@${participantId}>`)
    .join(' ');

  const inviteMessage = await channel.send({
    content:
      mentions.length > 0
        ? `${mentions}\nEl middleman ha marcado el ticket como completado. Comparte tu experiencia con una reseña.`
        : 'Comparte tu experiencia con una reseña usando el botón a continuación.',
    embeds: [
      embedFactory.reviewRequest({
        middlemanTag: `<@${interaction.user.id}>`,
        tradeSummary: 'Haz clic en el botón para calificar al middleman que gestionó tu transacción.',
      }),
    ],
    components: [buildReviewButtonRow()],
  });

  reviewInviteStore.set(inviteMessage.id, { ticketId: ticket.id, middlemanId: interaction.user.id });

  await interaction.editReply({
    embeds: [
      embedFactory.success({
        title: 'Ticket cerrado',
        description:
          'El ticket se ha cerrado correctamente. Se solicitó a los participantes que envíen una reseña del middleman.',
      }),
    ],
  });
};

export const middlemanCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('middleman')
    .setDescription('Sistema de middleman del servidor')
    .addSubcommand((sub) => sub.setName('open').setDescription('Abrir ticket de middleman'))
    .addSubcommand((sub) => sub.setName('claim').setDescription('Reclamar ticket (solo middlemen)'))
    .addSubcommand((sub) => sub.setName('close').setDescription('Cerrar ticket (solo middleman asignado)')),
  category: 'Middleman',
  examples: ['/middleman open', '/middleman claim', '/middleman close'],
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'open':
        await handleOpen(interaction);
        break;
      case 'claim':
        await handleClaim(interaction);
        break;
      case 'close':
        await handleClose(interaction);
        break;
      default:
        await interaction.reply({
          embeds: [
            embedFactory.error({
              title: 'Subcomando no disponible',
              description: 'La acción solicitada no está implementada.',
            }),
          ],
          ephemeral: true,
        });
    }
  },
};

export const middlemanReviewUseCase = submitReviewUseCase;
