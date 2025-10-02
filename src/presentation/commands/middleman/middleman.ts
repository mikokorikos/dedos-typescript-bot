// ============================================================================
// RUTA: src/presentation/commands/middleman/middleman.ts
// ============================================================================

import type { ChatInputCommandInteraction, TextBasedChannel, TextChannel } from 'discord.js';
import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { reviewInviteStore } from '@/application/services/ReviewInviteStore';
import { ClaimTradeUseCase } from '@/application/usecases/middleman/ClaimTradeUseCase';
import { CloseTradeUseCase } from '@/application/usecases/middleman/CloseTradeUseCase';
import { ConfirmTradeUseCase } from '@/application/usecases/middleman/ConfirmTradeUseCase';
import { OpenMiddlemanChannelUseCase } from '@/application/usecases/middleman/OpenMiddlemanChannelUseCase';
import { SubmitReviewUseCase } from '@/application/usecases/middleman/SubmitReviewUseCase';
import { SubmitTradeDataUseCase } from '@/application/usecases/middleman/SubmitTradeDataUseCase';
import { prisma } from '@/infrastructure/db/prisma';
import { PrismaMemberStatsRepository } from '@/infrastructure/repositories/PrismaMemberStatsRepository';
import { PrismaMiddlemanRepository } from '@/infrastructure/repositories/PrismaMiddlemanRepository';
import { PrismaReviewRepository } from '@/infrastructure/repositories/PrismaReviewRepository';
import { PrismaTicketRepository } from '@/infrastructure/repositories/PrismaTicketRepository';
import { PrismaTradeRepository } from '@/infrastructure/repositories/PrismaTradeRepository';
import type { Command } from '@/presentation/commands/types';
import { buildReviewButtonRow, REVIEW_BUTTON_CUSTOM_ID } from '@/presentation/components/buttons/ReviewButtons';
import {
  TRADE_CONFIRM_BUTTON_ID,
  TRADE_DATA_BUTTON_ID,
  TRADE_HELP_BUTTON_ID,
} from '@/presentation/components/buttons/TradePanelButtons';
import { MiddlemanModal } from '@/presentation/components/modals/MiddlemanModal';
import { ReviewModal } from '@/presentation/components/modals/ReviewModal';
import { TradeModal } from '@/presentation/components/modals/TradeModal';
import {
  modalHandlers,
  registerButtonHandler,
  registerModalHandler,
  registerSelectMenuHandler,
} from '@/presentation/components/registry';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import {
  buildMiddlemanInfoEmbed,
  buildMiddlemanPanelMessage,
  MIDDLEMAN_PANEL_MENU_ID,
} from '@/presentation/middleman/MiddlemanPanelBuilder';
import { TradePanelRenderer } from '@/presentation/middleman/TradePanelRenderer';
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
const submitTradeDataUseCase = new SubmitTradeDataUseCase(ticketRepo, tradeRepo, logger);
const confirmTradeUseCase = new ConfirmTradeUseCase(ticketRepo, tradeRepo, logger);
const tradePanelRenderer = new TradePanelRenderer(ticketRepo, tradeRepo, logger, embedFactory);

type SendableChannel = TextBasedChannel & { send: (...args: unknown[]) => unknown };

const isSendableChannel = (channel: TextBasedChannel | null): channel is SendableChannel =>
  Boolean(channel && typeof (channel as { send?: unknown }).send === 'function');

registerModalHandler('middleman-open', async (interaction) => {
  await MiddlemanModal.handleSubmit(interaction, openUseCase, {
    async renderPanel(channel, ticketId) {
      await tradePanelRenderer.render(channel, ticketId);
    },
  });
});

registerModalHandler(TradeModal.CUSTOM_ID, async (interaction) => {
  const channel = interaction.channel;

  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [
        embedFactory.error({
          title: 'Canal incompatible',
          description: 'Este formulario solo puede utilizarse dentro de un canal de texto.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

    if (!ticket) {
      throw new TicketNotFoundError(channel.id);
    }

    const { robloxUsername, offerDescription } = TradeModal.parseFields(interaction);

    await submitTradeDataUseCase.execute({
      ticketId: ticket.id,
      userId: interaction.user.id,
      robloxUsername,
      offerDescription,
    });

    await tradePanelRenderer.render(channel, ticket.id);

    await interaction.reply({
      embeds: [
        embedFactory.success({
          title: 'Datos registrados',
          description: 'Tu información del trade se actualizó correctamente.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);

    if (shouldLogStack) {
      logger.error({ err: error, referenceId }, 'Error inesperado al registrar datos de trade.');
    } else {
      logger.warn({ err: error, referenceId }, 'Error controlado al registrar datos de trade.');
    }

    if (interaction.deferred || interaction.replied) {
      const { flags, ...editPayload } = payload;
      await interaction.editReply({
        ...editPayload,
        embeds:
          embeds ?? [
            embedFactory.error({
              title: 'No se pudo guardar tus datos',
              description: 'Inténtalo nuevamente más tarde o contacta al staff.',
            }),
          ],
      });
      return;
    }

    await interaction.reply({
      ...payload,
      embeds:
        embeds ?? [
          embedFactory.error({
            title: 'No se pudo guardar tus datos',
            description: 'Inténtalo nuevamente más tarde o contacta al staff.',
          }),
        ],
      flags: MessageFlags.Ephemeral,
    });
  }
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
      flags: MessageFlags.Ephemeral,
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
      flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const channel = await modalInteraction.client.channels.fetch(env.REVIEW_CHANNEL_ID);

      if (!channel || channel.type !== ChannelType.GuildText) {
        await modalInteraction.reply({
          embeds: [
            embedFactory.error({
              title: 'Canal inválido',
              description: 'El canal de reseñas configurado no es un canal de texto válido.',
            }),
          ],
          flags: MessageFlags.Ephemeral,
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
        channel,
      );

      await modalInteraction.reply({
        embeds: [
          embedFactory.success({
            title: '¡Gracias por tu reseña!',
            description: 'Tu valoración se ha publicado correctamente en el canal de reseñas.',
          }),
        ],
        flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
      });
    } finally {
      modalHandlers.delete(modalCustomId);
    }
  });

  await interaction.showModal(ReviewModal.build(modalCustomId));
});

registerButtonHandler(TRADE_DATA_BUTTON_ID, async (interaction) => {
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [
        embedFactory.warning({
          title: 'Acción no disponible',
          description: 'Este botón solo funciona dentro de un canal de trade.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(TradeModal.build());
});

registerButtonHandler(TRADE_CONFIRM_BUTTON_ID, async (interaction) => {
  const channel = interaction.channel;

  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [
        embedFactory.warning({
          title: 'Acción no disponible',
          description: 'Este botón solo funciona dentro de un canal de trade.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

    if (!ticket) {
      throw new TicketNotFoundError(channel.id);
    }

    const result = await confirmTradeUseCase.execute({
      ticketId: ticket.id,
      userId: interaction.user.id,
    });

    await tradePanelRenderer.render(channel, ticket.id);

    await interaction.reply({
      embeds: [
        embedFactory.success({
          title: 'Confirmación registrada',
          description: 'Tu confirmación quedó registrada correctamente.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });

    if (result.ticketConfirmed) {
      const mention = env.MIDDLEMAN_ROLE_ID ? `<@&${env.MIDDLEMAN_ROLE_ID}>` : 'Equipo middleman';
      const notificationChannel = interaction.channel;

      if (isSendableChannel(notificationChannel)) {
        await notificationChannel.send({
          content: `${mention}, el trade está listo para asistencia.`,
          allowedMentions: env.MIDDLEMAN_ROLE_ID ? { roles: [env.MIDDLEMAN_ROLE_ID] } : { parse: [] },
        });
      } else {
        logger.warn(
          { channelId: notificationChannel?.id, interactionId: interaction.id },
          'No se pudo notificar al equipo middleman: canal no soporta envíos.',
        );
      }
    }
  } catch (error) {
    const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);

    if (shouldLogStack) {
      logger.error({ err: error, referenceId }, 'Error inesperado al confirmar trade.');
    } else {
      logger.warn({ err: error, referenceId }, 'Error controlado al confirmar trade.');
    }

    if (interaction.deferred || interaction.replied) {
      const { flags, ...editPayload } = payload;
      await interaction.editReply({
        ...editPayload,
        embeds:
          embeds ?? [
            embedFactory.error({
              title: 'No se pudo confirmar el trade',
              description: 'Inténtalo nuevamente o contacta al staff.',
            }),
          ],
      });
      return;
    }

    await interaction.reply({
      ...payload,
      embeds:
        embeds ?? [
          embedFactory.error({
            title: 'No se pudo confirmar el trade',
            description: 'Inténtalo nuevamente o contacta al staff.',
          }),
        ],
      flags: MessageFlags.Ephemeral,
    });
  }
});

registerButtonHandler(TRADE_HELP_BUTTON_ID, async (interaction) => {
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [
        embedFactory.warning({
          title: 'Acción no disponible',
          description: 'Este botón solo funciona dentro de un canal de trade.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      embedFactory.info({
        title: 'Asistencia solicitada',
        description: 'Se notificó al equipo middleman. Por favor, espera en el canal.',
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });

  const mention = env.MIDDLEMAN_ROLE_ID ? `<@&${env.MIDDLEMAN_ROLE_ID}>` : 'Equipo middleman';
  const channel = interaction.channel;

  if (!isSendableChannel(channel)) {
    logger.warn(
      { channelId: channel?.id, interactionId: interaction.id },
      'No se pudo enviar la solicitud de asistencia: canal no soporta envíos.',
    );
    return;
  }

  await channel.send({
    content: `${mention}, <@${interaction.user.id}> solicitó asistencia en este trade.`,
    allowedMentions: env.MIDDLEMAN_ROLE_ID ? { roles: [env.MIDDLEMAN_ROLE_ID] } : { users: [interaction.user.id] },
  });
});

registerSelectMenuHandler(MIDDLEMAN_PANEL_MENU_ID, async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        embedFactory.error({
          title: 'Acción no disponible',
          description: 'Este menú solo puede utilizarse dentro de un servidor.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const value = interaction.values.at(0);

  if (value === 'info') {
    await interaction.reply({
      embeds: [buildMiddlemanInfoEmbed()],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (value === 'open') {
    await interaction.showModal(MiddlemanModal.build());
    return;
  }

  await interaction.reply({
    embeds: [
      embedFactory.warning({
        title: 'Opción no reconocida',
        description: 'Selecciona una opción válida del menú para continuar.',
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
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
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(MiddlemanModal.build());
};

const handlePanel = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const panel = buildMiddlemanPanelMessage();

  await interaction.reply({
    ...panel,
    allowedMentions: { parse: [] },
  });
};

const handleClaim = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const channel = ensureTextChannel(interaction);
  const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

  if (!ticket) {
    throw new TicketNotFoundError(channel.id);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    .addSubcommand((sub) => sub.setName('close').setDescription('Cerrar ticket (solo middleman asignado)'))
    .addSubcommand((sub) => sub.setName('panel').setDescription('Publicar el panel informativo de middleman')),
  category: 'Middleman',
  examples: ['/middleman open', '/middleman claim', '/middleman close', '/middleman panel'],
  prefix: {
    name: 'middleman',
    aliases: ['mm'],
    async execute(message, args) {
      const [subcommand] = args;

      if (!subcommand || subcommand.toLowerCase() === 'panel') {
        const panel = buildMiddlemanPanelMessage();
        if (!isSendableChannel(message.channel)) {
          logger.warn(
            { channelId: message.channel?.id ?? null, messageId: message.id },
            'No se pudo enviar el panel de middleman desde comando con prefijo: canal no soporta envíos.',
          );
          return;
        }

        await message.channel.send({
          ...panel,
          allowedMentions: { parse: [] },
        });
        return;
      }

      await message.reply({
        embeds: [
          embedFactory.info({
            title: 'Comando disponible como slash',
            description: 'Usa `/middleman` para acceder al flujo completo de middleman dentro del servidor.',
          }),
        ],
        allowedMentions: { repliedUser: false },
      });
    },
  },
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
      case 'panel':
        await handlePanel(interaction);
        break;
      default:
        await interaction.reply({
          embeds: [
            embedFactory.error({
              title: 'Subcomando no disponible',
              description: 'La acción solicitada no está implementada.',
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
    }
  },
};

export const middlemanReviewUseCase = submitReviewUseCase;
