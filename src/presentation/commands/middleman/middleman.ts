// ============================================================================

// RUTA: src/presentation/commands/middleman/middleman.ts

// ============================================================================

import type {
  ChatInputCommandInteraction,
  InteractionReplyOptions,
  Message,
  TextBasedChannel,
  TextChannel,
} from 'discord.js';
import { ChannelType, DiscordAPIError, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { RESTJSONErrorCodes } from 'discord-api-types/v10';

import { reviewInviteStore } from '@/application/services/ReviewInviteStore';
import { ClaimTradeUseCase } from '@/application/usecases/middleman/ClaimTradeUseCase';
import { CloseTradeUseCase } from '@/application/usecases/middleman/CloseTradeUseCase';
import { ConfirmFinalizationUseCase } from '@/application/usecases/middleman/ConfirmFinalizationUseCase';
import { ConfirmTradeUseCase } from '@/application/usecases/middleman/ConfirmTradeUseCase';
import { OpenMiddlemanChannelUseCase } from '@/application/usecases/middleman/OpenMiddlemanChannelUseCase';
import { RequestTradeClosureUseCase } from '@/application/usecases/middleman/RequestTradeClosureUseCase';
import { RevokeFinalizationUseCase } from '@/application/usecases/middleman/RevokeFinalizationUseCase';
import { SubmitReviewUseCase } from '@/application/usecases/middleman/SubmitReviewUseCase';
import { SubmitTradeDataUseCase } from '@/application/usecases/middleman/SubmitTradeDataUseCase';
import { prisma } from '@/infrastructure/db/prisma';
import { PrismaMemberStatsRepository } from '@/infrastructure/repositories/PrismaMemberStatsRepository';
import { PrismaMiddlemanFinalizationRepository } from '@/infrastructure/repositories/PrismaMiddlemanFinalizationRepository';
import { PrismaMiddlemanRepository } from '@/infrastructure/repositories/PrismaMiddlemanRepository';
import { PrismaReviewRepository } from '@/infrastructure/repositories/PrismaReviewRepository';
import { PrismaTicketRepository } from '@/infrastructure/repositories/PrismaTicketRepository';
import { PrismaTradeRepository } from '@/infrastructure/repositories/PrismaTradeRepository';
import type { Command } from '@/presentation/commands/types';
import { registerFinalizationCancelButton } from '@/presentation/components/buttons/FinalizationCancelButton';
import { registerFinalizationConfirmButton } from '@/presentation/components/buttons/FinalizationConfirmButton';
import {
  buildClaimButtonRow,
  MIDDLEMAN_CLAIM_BUTTON_ID,
} from '@/presentation/components/buttons/MiddlemanClaimButton';
import {
  buildReviewButtonRow,
  REVIEW_BUTTON_CUSTOM_ID,
} from '@/presentation/components/buttons/ReviewButtons';
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
import { buildClaimPromptMessage, buildTradeReadyMessage } from '@/presentation/middleman/messages';
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
import {
  brandEditReplyOptions,
  brandMessageOptions,
  brandReplyOptions,
} from '@/shared/utils/branding';

const ticketRepo = new PrismaTicketRepository(prisma);

const tradeRepo = new PrismaTradeRepository(prisma);

const statsRepo = new PrismaMemberStatsRepository(prisma);

const middlemanRepo = new PrismaMiddlemanRepository(prisma);

const finalizationRepo = new PrismaMiddlemanFinalizationRepository(prisma);

const reviewRepo = new PrismaReviewRepository(prisma);

const openUseCase = new OpenMiddlemanChannelUseCase(ticketRepo, prisma, logger, embedFactory);

const claimUseCase = new ClaimTradeUseCase(ticketRepo, middlemanRepo, logger, embedFactory);

const closeUseCase = new CloseTradeUseCase(
  ticketRepo,
  tradeRepo,
  statsRepo,
  middlemanRepo,
  finalizationRepo,
  prisma,
  logger,
  embedFactory,
);

const submitReviewUseCase = new SubmitReviewUseCase(
  reviewRepo,
  ticketRepo,
  middlemanRepo,
  embedFactory,
  logger,
);

const submitTradeDataUseCase = new SubmitTradeDataUseCase(ticketRepo, tradeRepo, logger);

const confirmTradeUseCase = new ConfirmTradeUseCase(ticketRepo, tradeRepo, logger);

const confirmFinalizationUseCase = new ConfirmFinalizationUseCase(
  ticketRepo,
  finalizationRepo,
  middlemanRepo,
  embedFactory,
  logger,
);

const revokeFinalizationUseCase = new RevokeFinalizationUseCase(
  ticketRepo,
  finalizationRepo,
  middlemanRepo,
  embedFactory,
  logger,
);

const requestClosureUseCase = new RequestTradeClosureUseCase(
  ticketRepo,
  finalizationRepo,
  middlemanRepo,
  embedFactory,
  logger,
);

const tradePanelRenderer = new TradePanelRenderer(ticketRepo, tradeRepo, logger, embedFactory);

type SendableChannel = TextBasedChannel & { send: (...args: unknown[]) => unknown };

const isSendableChannel = (channel: TextBasedChannel | null): channel is SendableChannel =>
  Boolean(channel && typeof (channel as { send?: unknown }).send === 'function');

const HELP_UNLOCK_DURATION_MS = Math.max(5_000, env.MIDDLEMAN_HELP_UNLOCK_MS);
const MENTION_PATTERN = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/u;

const ensureMessageInGuild = async (message: Message, description?: string): Promise<boolean> => {
  if (message.guild) {
    return true;
  }

  await message.reply({
    embeds: [
      embedFactory.error({
        title: 'Accion no disponible',
        description: description ?? 'Este comando solo puede utilizarse dentro de un servidor.',
      }),
    ],
    allowedMentions: { repliedUser: false },
  });

  return false;
};

const ensureTextChannelFromMessage = async (
  message: Message,
  errorDescription: string,
): Promise<TextChannel | null> => {
  const channel = message.channel as TextChannel | null;

  if (!channel || channel.type !== ChannelType.GuildText) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Canal no compatible',
          description: errorDescription,
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return null;
  }

  return channel;
};


const resolvePartnerParticipantId = (
  ownerId: bigint,
  participants: ReadonlyArray<{ userId: bigint; role?: string | null }>,
): bigint | null => {
  const byRole = participants.find((participant) => {
    const role = participant.role ? participant.role.toUpperCase() : null;
    return role === 'PARTNER';
  });

  if (byRole) {
    return byRole.userId;
  }

  const fallback = participants.find((participant) => participant.userId !== ownerId);
  return fallback ? fallback.userId : null;
};

const collectParticipantIds = (
  ownerId: bigint,
  participants: ReadonlyArray<{ userId: bigint; role?: string | null }>,
): readonly bigint[] => {
  const partnerId = resolvePartnerParticipantId(ownerId, participants);
  return [ownerId, partnerId].filter((value): value is bigint => typeof value === 'bigint');
};

const updateSendPermission = async (
  channel: TextChannel,
  userId: bigint,
  allow: boolean,
): Promise<void> => {
  try {
    await channel.permissionOverwrites.edit(userId.toString(), { SendMessages: allow });
  } catch (error) {
    logger.warn(
      { channelId: channel.id, userId: userId.toString(), allow, err: error },
      'No se pudo actualizar los permisos de envo del usuario en el canal middleman.',
    );
  }
};
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
    await interaction.reply(
      brandReplyOptions({
        embeds: [
          embedFactory.error({
            title: 'Canal incompatible',

            description: 'Este formulario solo puede utilizarse dentro de un canal de texto.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  const textChannel = channel;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    await tradePanelRenderer.render(textChannel, ticket.id);

    await interaction.editReply(
      brandEditReplyOptions({
        embeds: [
          embedFactory.success({
            title: 'Datos registrados',

            description: 'Tu informacion del trade se actualizo correctamente.',
          }),
        ],
      }),
    );
  } catch (error) {
    const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);

    if (shouldLogStack) {
      logger.error({ err: error, referenceId }, 'Error inesperado al registrar datos de trade.');
    } else {
      logger.warn({ err: error, referenceId }, 'Error controlado al registrar datos de trade.');
    }

    if (interaction.deferred || interaction.replied) {
      const { flags, ...editPayload } = payload;

      await interaction.editReply(
        brandEditReplyOptions({
          ...editPayload,

          embeds: embeds ?? [
            embedFactory.error({
              title: 'No se pudo guardar tus datos',

              description: 'Intentalo nuevamente ms tarde o contacta al staff.',
            }),
          ],
        }),
      );

      return;
    }

    await interaction.reply(
      brandReplyOptions({
        ...payload,

        embeds: embeds ?? [
          embedFactory.error({
            title: 'No se pudo guardar tus datos',

            description: 'Intentalo nuevamente ms tarde o contacta al staff.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );
  }
});

registerFinalizationConfirmButton(confirmFinalizationUseCase, ticketRepo);
registerFinalizationCancelButton(revokeFinalizationUseCase, ticketRepo);

registerButtonHandler(REVIEW_BUTTON_CUSTOM_ID, async (interaction) => {
  const invite = reviewInviteStore.get(interaction.message.id);

  if (!invite) {
    await interaction.reply(
      brandReplyOptions({
        embeds: [
          embedFactory.warning({
            title: 'Formulario no disponible',

            description:
              'Esta invitacion de resena ha expirado. Solicita al staff que envie una nueva.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  const isParticipant = await ticketRepo.isParticipant(
    invite.ticketId,
    BigInt(interaction.user.id),
  );

  if (!isParticipant) {
    await interaction.reply(
      brandReplyOptions({
        embeds: [
          embedFactory.error({
            title: 'No puedes resenar este ticket',

            description: 'Solo los participantes del ticket pueden enviar una resena.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  const modalCustomId = `review:${invite.ticketId}:${invite.middlemanId}:${interaction.user.id}`;

  if (modalHandlers.has(modalCustomId)) {
    modalHandlers.delete(modalCustomId);
  }

  registerModalHandler(modalCustomId, async (modalInteraction) => {
    try {
      await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const { rating, comment } = ReviewModal.parseFields(modalInteraction);

      if (!env.REVIEW_CHANNEL_ID) {
        await modalInteraction.editReply(
          brandEditReplyOptions({
            embeds: [
              embedFactory.error({
                title: 'Configuracion incompleta',

                description:
                  'No se pudo encontrar el canal de resenas. Un administrador debe establecer `REVIEW_CHANNEL_ID` en el .env.',
              }),
            ],
          }),
        );

        return;
      }

      const channel = await modalInteraction.client.channels.fetch(env.REVIEW_CHANNEL_ID);

      if (!channel || channel.type !== ChannelType.GuildText) {
        await modalInteraction.editReply(
          brandEditReplyOptions({
            embeds: [
              embedFactory.error({
                title: 'Canal invalido',

                description: 'El canal de resenas configurado no es un canal de texto valido.',
              }),
            ],
          }),
        );

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

      await modalInteraction.editReply(
        brandEditReplyOptions({
          embeds: [
            embedFactory.success({
              title: 'Gracias por tu resena!',

              description: 'Tu valoracion se ha publicado correctamente en el canal de resenas.',
            }),
          ],
        }),
      );
    } catch (error) {
      const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);

      if (shouldLogStack) {
        logger.error(
          { err: error, referenceId },
          'Error inesperado al registrar resena de middleman.',
        );
      } else {
        logger.warn(
          { err: error, referenceId },
          'Error controlado al registrar resena de middleman.',
        );
      }

      if (modalInteraction.deferred || modalInteraction.replied) {
        const { flags, ...editPayload } = payload;

        await modalInteraction.editReply(
          brandEditReplyOptions({
            ...editPayload,

            embeds: embeds ?? [
              embedFactory.error({
                title: 'No se pudo registrar la resena',

                description:
                  'Ocurrio un error al procesar tu resena. Intentalo nuevamente en unos minutos.',
              }),
            ],
          }),
        );

        return;
      }

      await modalInteraction.reply(
        brandReplyOptions({
          ...payload,

          embeds: embeds ?? [
            embedFactory.error({
              title: 'No se pudo registrar la resena',

              description:
                'Ocurrio un error al procesar tu resena. Intentalo nuevamente en unos minutos.',
            }),
          ],

          flags: MessageFlags.Ephemeral,
        }),
      );
    } finally {
      modalHandlers.delete(modalCustomId);
    }
  });

  await interaction.showModal(ReviewModal.build(modalCustomId));
});

registerButtonHandler(TRADE_DATA_BUTTON_ID, async (interaction) => {
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply(
      brandReplyOptions({
        embeds: [
          embedFactory.warning({
            title: 'Accion no disponible',

            description: 'Este boton solo funciona dentro de un canal de trade.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  try {
    await interaction.showModal(TradeModal.build());
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      if (error.code === RESTJSONErrorCodes.UnknownInteraction) {
        logger.warn(
          { interactionId: interaction.id, channelId: interaction.channelId, err: error },
          'La interaccion expiro antes de mostrar el modal de trade.',
        );

        return;
      }

      if (error.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged) {
        logger.warn(
          { interactionId: interaction.id, channelId: interaction.channelId, err: error },
          'Se intento reconocer nuevamente la interaccion antes de mostrar el modal de trade.',
        );

        return;
      }
    }

    throw error;
  }
});

registerButtonHandler(TRADE_CONFIRM_BUTTON_ID, async (interaction) => {
  const channel = interaction.channel;

  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply(
      brandReplyOptions({
        embeds: [
          embedFactory.warning({
            title: 'Accion no disponible',

            description: 'Este boton solo funciona dentro de un canal de trade.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  const textChannel = channel;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

    if (!ticket) {
      throw new TicketNotFoundError(channel.id);
    }

    const result = await confirmTradeUseCase.execute({
      ticketId: ticket.id,

      userId: interaction.user.id,
    });

    await tradePanelRenderer.render(textChannel, ticket.id);

    await interaction.editReply(
      brandEditReplyOptions({
        embeds: [
          embedFactory.success({
            title: 'Confirmacion registrada',

            description: 'Tu confirmacion quedo registrada correctamente.',
          }),
        ],
      }),
    );

    if (result.ticketConfirmed) {
      const participants = await ticketRepo.listParticipants(ticket.id);

      const participantIds = collectParticipantIds(ticket.ownerId, participants);

      if (participantIds.length > 0) {
        await Promise.all(
          participantIds.map((participantId) =>
            updateSendPermission(textChannel, participantId, false),
          ),
        );
      }

      await tradePanelRenderer.render(textChannel, ticket.id);

      try {
        await textChannel.send(buildTradeReadyMessage(env.MIDDLEMAN_ROLE_ID));
        await textChannel.send(buildClaimPromptMessage(env.MIDDLEMAN_ROLE_ID));
      } catch (sendError) {
        logger.warn(
          { channelId: textChannel.id, interactionId: interaction.id, err: sendError },
          'No se pudo publicar las notificaciones de trade listo.',
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

      await interaction.editReply(
        brandEditReplyOptions({
          ...editPayload,

          embeds: embeds ?? [
            embedFactory.error({
              title: 'No se pudo confirmar el trade',

              description: 'Int ntalo nuevamente o contacta al staff.',
            }),
          ],
        }),
      );

      return;
    }

    await interaction.reply(
      brandReplyOptions({
        ...payload,

        embeds: embeds ?? [
          embedFactory.error({
            title: 'No se pudo confirmar el trade',

            description: 'Int ntalo nuevamente o contacta al staff.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );
  }
});

registerButtonHandler(TRADE_HELP_BUTTON_ID, async (interaction) => {
  const channel = interaction.channel;

  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply(
      brandReplyOptions({
        embeds: [
          embedFactory.warning({
            title: 'Accion no disponible',

            description: 'Este boton solo funciona dentro de un canal de trade.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  const textChannel = channel;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticket = await ticketRepo.findByChannelId(BigInt(textChannel.id));

    if (!ticket) {
      throw new TicketNotFoundError(textChannel.id);
    }

    const participants = await ticketRepo.listParticipants(ticket.id);
    const participantIds = collectParticipantIds(ticket.ownerId, participants);

    if (participantIds.length === 0) {
      await interaction.editReply(
        brandEditReplyOptions({
          embeds: [
            embedFactory.warning({
              title: 'No se encontraron participantes',

              description: 'No pudimos desbloquear el canal porque no hay participantes registrados.',
            }),
          ],
        }),
      );

      return;
    }

    await Promise.all(
      participantIds.map((participantId) => updateSendPermission(textChannel, participantId, true)),
    );

    await interaction.editReply(
      brandEditReplyOptions({
        embeds: [
          embedFactory.info({
            title: 'Canal desbloqueado temporalmente',

            description: 'Avisamos al staff. El canal se bloquear automticamente en unos instantes.',
          }),
        ],
      }),
    );

    const mention = env.ADMIN_ROLE_ID ? `<@&${env.ADMIN_ROLE_ID}>` : 'Equipo administrativo';
    const assistanceEmbed = embedFactory.info({
      title: 'Ayuda solicitada',

      description: [
        `${mention}, <@${interaction.user.id}> solicito asistencia en este trade.`,
        'El canal quedo desbloqueado temporalmente para coordinar detalles pendientes.',
      ].join('\n\n'),
    });

    await textChannel.send(
      brandMessageOptions({
        embeds: [assistanceEmbed],
        allowedMentions: env.ADMIN_ROLE_ID
          ? { roles: [env.ADMIN_ROLE_ID], users: [interaction.user.id] }
          : { users: [interaction.user.id] },
      }),
    );

    setTimeout(() => {
      void (async () => {
        try {
          const freshTicket = await ticketRepo.findById(ticket.id);
          if (!freshTicket) {
            return;
          }

          const freshParticipants = await ticketRepo.listParticipants(freshTicket.id);
          const freshParticipantIds = collectParticipantIds(freshTicket.ownerId, freshParticipants);

          if (freshParticipantIds.length > 0) {
            await Promise.all(
              freshParticipantIds.map((participantId) =>
                updateSendPermission(textChannel, participantId, false),
              ),
            );
          }

          await tradePanelRenderer.render(textChannel, freshTicket.id);

          await textChannel.send(
            brandMessageOptions({
              embeds: [
                embedFactory.info({
                  title: 'Canal bloqueado nuevamente',

                  description: 'Restauramos los permisos tras la solicitud de ayuda.',
                }),
              ],
              allowedMentions: { parse: [] },
            }),
          );
        } catch (lockError) {
          logger.warn(
            { channelId: textChannel.id, ticketId: ticket.id, err: lockError },
            'No se pudo relockear el canal tras la solicitud de ayuda.',
          );
        }
      })();
    }, HELP_UNLOCK_DURATION_MS).unref?.();
  } catch (error) {
    const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);

    if (shouldLogStack) {
      logger.error({ err: error, referenceId }, 'Error inesperado al solicitar ayuda en trade.');
    } else {
      logger.warn({ err: error, referenceId }, 'Error controlado al solicitar ayuda en trade.');
    }

    if (interaction.deferred || interaction.replied) {
      const { flags, ...editPayload } = payload;

      await interaction.editReply(
        brandEditReplyOptions({
          ...editPayload,

          embeds: embeds ?? [
            embedFactory.error({
              title: 'No se pudo solicitar ayuda',

              description: 'Intentalo nuevamente o contacta al staff.',
            }),
          ],
        }),
      );

      return;
    }

    await interaction.reply(
      brandReplyOptions({
        ...payload,

        embeds: embeds ?? [
          embedFactory.error({
            title: 'No se pudo solicitar ayuda',

            description: 'Intentalo nuevamente o contacta al staff.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );
  }
});

registerButtonHandler(MIDDLEMAN_CLAIM_BUTTON_ID, async (interaction) => {
  const channel = interaction.channel;

  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply(
      brandReplyOptions({
        embeds: [
          embedFactory.warning({
            title: 'Accion no disponible',

            description: 'Este boton solo funciona dentro de un canal de middleman.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  const textChannel = channel;

  try {
    const ticket = await ticketRepo.findByChannelId(BigInt(textChannel.id));

    if (!ticket) {
      throw new TicketNotFoundError(textChannel.id);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await claimUseCase.execute(
      { ticketId: ticket.id, middlemanId: interaction.user.id },
      textChannel,
    );

    await tradePanelRenderer.render(textChannel, ticket.id);

    await interaction.editReply(
      brandEditReplyOptions({
        embeds: [
          embedFactory.success({
            title: 'Ticket reclamado',

            description: 'Ahora tienes control del ticket. Revisa el panel para continuar.',
          }),
        ],
      }),
    );

    try {
      await interaction.message.edit({ components: [buildClaimButtonRow({ disabled: true })] });
    } catch (error) {
      logger.warn(
        { err: error, interactionId: interaction.id },
        'No se pudo deshabilitar el boton de reclamo.',
      );
    }
  } catch (error) {
    const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);

    if (shouldLogStack) {
      logger.error(
        { err: error, referenceId },
        'Error inesperado al reclamar ticket de middleman.',
      );
    } else {
      logger.warn({ err: error, referenceId }, 'Error controlado al reclamar ticket de middleman.');
    }

    if (interaction.deferred || interaction.replied) {
      const { flags, ...editPayload } = payload;

      await interaction.editReply(
        brandEditReplyOptions({
          ...editPayload,

          embeds: embeds ?? [
            embedFactory.error({
              title: 'No se pudo reclamar el ticket',

              description: 'Intentalo de nuevo o contacta a un administrador.',
            }),
          ],
        }),
      );

      return;
    }

    await interaction.reply(
      brandReplyOptions({
        ...payload,

        embeds: embeds ?? [
          embedFactory.error({
            title: 'No se pudo reclamar el ticket',

            description: 'Intentalo de nuevo o contacta a un administrador.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );
  }
});

registerSelectMenuHandler(MIDDLEMAN_PANEL_MENU_ID, async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply(
      brandReplyOptions({
        embeds: [
          embedFactory.error({
            title: 'Accion no disponible',

            description: 'Este meno solo puede utilizarse dentro de un servidor.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  const value = interaction.values.at(0);

  if (value === 'info') {
    await interaction.reply(
      brandReplyOptions({
        embeds: [buildMiddlemanInfoEmbed()],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  if (value === 'open') {
    await interaction.showModal(MiddlemanModal.build());

    return;
  }

  await interaction.reply(
    brandReplyOptions({
      embeds: [
        embedFactory.warning({
          title: 'Opcion no reconocida',

          description: 'Selecciona una opcion vlida del meno para continuar.',
        }),
      ],

      flags: MessageFlags.Ephemeral,
    }),
  );
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
    await interaction.reply(
      brandReplyOptions({
        embeds: [
          embedFactory.error({
            title: 'Accion no disponible',

            description: 'Este comando solo puede utilizarse dentro de un servidor.',
          }),
        ],

        flags: MessageFlags.Ephemeral,
      }),
    );

    return;
  }

  await interaction.showModal(MiddlemanModal.build());
};

const handlePanel = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const panel = buildMiddlemanPanelMessage();

  await interaction.reply(
    brandReplyOptions({
      ...(panel as InteractionReplyOptions),

      allowedMentions: { parse: [] },
    }),
  );
};

const handleClaim = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const channel = ensureTextChannel(interaction);

  const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

  if (!ticket) {
    throw new TicketNotFoundError(channel.id);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await claimUseCase.execute({ ticketId: ticket.id, middlemanId: interaction.user.id }, channel);

  await interaction.editReply(
    brandEditReplyOptions({
      embeds: [
        embedFactory.success({
          title: 'Ticket reclamado',

          description:
            'Ahora tienes control del ticket. Continoa con el flujo de validacion en el canal.',
        }),
      ],
    }),
  );
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

  const reviewerMentions = Array.from(reviewerIds).map((participantId) => `<@${participantId}>`);
  const summaryIntro = reviewerMentions.length > 0
    ? `${reviewerMentions.join(' ')}\nEl middleman ha marcado el ticket como completado. Comparte tu experiencia con una resena.`
    : 'El middleman ha marcado el ticket como completado. Comparte tu experiencia con una resena.';

  const reviewEmbed = embedFactory.reviewRequest({
    middlemanTag: `<@${interaction.user.id}>`,
    tradeSummary: 'Haz clic en el boton para calificar al middleman que gestiono tu transaccion.',
  });

  reviewEmbed.setDescription(
    [summaryIntro, reviewEmbed.data.description ?? '']
      .filter((segment) => segment.length > 0)
      .join('\n\n'),
  );

  const inviteMessage = await channel.send(
    brandMessageOptions({
      embeds: [reviewEmbed],
      components: [buildReviewButtonRow()],
      allowedMentions: reviewerMentions.length > 0 ? { users: Array.from(reviewerIds) } : { parse: [] },
    }),
  );
  reviewInviteStore.set(inviteMessage.id, {
    ticketId: ticket.id,
    middlemanId: interaction.user.id,
  });

  await interaction.editReply(
    brandEditReplyOptions({
      embeds: [
        embedFactory.success({
          title: 'Ticket cerrado',

          description:
            'El ticket se ha cerrado correctamente. Se solicito a los participantes que envien una resena del middleman.',
        }),
      ],
    }),
  );
};

const handleCloseRequest = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const channel = ensureTextChannel(interaction);
  const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

  if (!ticket) {
    throw new TicketNotFoundError(channel.id);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await requestClosureUseCase.execute(
      ticket.id,
      BigInt(interaction.user.id),
      channel,
    );

    const message = result.completed
      ? 'Todos los traders ya confirmaron el cierre. Puedes proceder a finalizar el ticket.'
      : result.alreadyPending
        ? 'Se actualizo el panel de confirmacion para que los traders registren su cierre.'
        : 'Se publico el panel de confirmacion para que los traders registren su cierre.';

    await interaction.editReply(
      brandEditReplyOptions({
        embeds: [
          embedFactory.success({
            title: 'Solicitud de cierre enviada',
            description: message,
          }),
        ],
      }),
    );
  } catch (error) {
    const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);
    const logContext = {
      err: error,
      referenceId,
      ticketId: ticket.id,
      channelId: channel.id,
      userId: interaction.user.id,
      source: 'slash:middleman:close-request',
    };

    if (shouldLogStack) {
      logger.error(logContext, 'Error al solicitar cierre de trade.');
    } else {
      logger.warn(logContext, 'Error controlado al solicitar cierre de trade.');
    }

    const { flags, ...rest } = payload;
    await interaction.editReply(
      brandEditReplyOptions({
        ...rest,
        embeds,
      }),
    );
  }
};


const handlePrefixOpenCommand = async (message: Message, args: ReadonlyArray<string>): Promise<void> => {
  if (!(await ensureMessageInGuild(message))) {
    return;
  }

  if (!env.MIDDLEMAN_CATEGORY_ID) {
    await message.reply({
      embeds: [
        embedFactory.error({
          title: 'Configuracion incompleta',
          description:
            'Define `MIDDLEMAN_CATEGORY_ID` en el archivo .env para abrir tickets de middleman desde texto.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return;
  }

  if (args.length < 2) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Uso del comando',
          description:
            'Sintaxis: `;middleman open @usuario descripcion del trade` (minimo 10 caracteres).',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return;
  }

  const [rawPartnerTag, ...contextParts] = args;
  const partnerTag = rawPartnerTag?.trim();

  if (!partnerTag || !MENTION_PATTERN.test(partnerTag)) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Companero invalido',
          description: 'Menciona al companero (`@usuario`) o escribe su ID numerico de Discord.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return;
  }

  const context = contextParts.join(' ').trim();

  if (context.length < 10) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Descripcion muy corta',
          description: 'Describe el intercambio con al menos 10 caracteres.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return;
  }

  try {
    const { ticket, channel } = await openUseCase.execute(
      {
        userId: message.author.id,
        guildId: message.guild!.id,
        type: 'MM',
        context,
        partnerTag,
        categoryId: env.MIDDLEMAN_CATEGORY_ID,
      },
      message.guild!,
    );

    await tradePanelRenderer.render(channel, ticket.id);

    await message.reply({
      embeds: [
        embedFactory.success({
          title: 'Ticket creado',
          description: `Tu ticket #${ticket.id} se creo en ${channel.toString()}.`,
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    const { shouldLogStack, referenceId, embeds } = mapErrorToDiscordResponse(error);
    const logPayload = {
      err: error,
      referenceId,
      userId: message.author.id,
      guildId: message.guild!.id,
      channelId: message.channel.id,
      source: 'prefix:middleman:open',
    };

    if (shouldLogStack) {
      logger.error(logPayload, 'Error al crear ticket de middleman con prefijo.');
    } else {
      logger.warn(logPayload, 'Error controlado al crear ticket de middleman con prefijo.');
    }

    await message.reply({
      embeds:
        embeds ?? [
          embedFactory.error({
            title: 'No se pudo crear el ticket',
            description: 'Hubo un problema durante la creacion del ticket. Revisa los datos e intenta de nuevo.',
          }),
        ],
      allowedMentions: { repliedUser: false },
    });
  }
};

const handlePrefixClaimCommand = async (message: Message): Promise<void> => {
  if (!(await ensureMessageInGuild(message))) {
    return;
  }

  const channel = await ensureTextChannelFromMessage(
    message,
    'Para reclamar un ticket ejecuta el comando dentro del canal middleman.',
  );

  if (!channel) {
    return;
  }

  const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

  if (!ticket) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Ticket no encontrado',
          description: 'No existe un ticket de middleman asociado a este canal.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return;
  }

  try {
    await claimUseCase.execute({ ticketId: ticket.id, middlemanId: message.author.id }, channel);

    await message.reply({
      embeds: [
        embedFactory.success({
          title: 'Ticket reclamado',
          description: 'Ahora tienes control del ticket. Continua con el flujo dentro de este canal.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    const { shouldLogStack, referenceId, embeds } = mapErrorToDiscordResponse(error);
    const logPayload = {
      err: error,
      referenceId,
      ticketId: ticket.id,
      channelId: channel.id,
      userId: message.author.id,
      source: 'prefix:middleman:claim',
    };

    if (shouldLogStack) {
      logger.error(logPayload, 'Error al reclamar ticket de middleman con prefijo.');
    } else {
      logger.warn(logPayload, 'Error controlado al reclamar ticket de middleman con prefijo.');
    }

    await message.reply({
      embeds:
        embeds ?? [
          embedFactory.error({
            title: 'No se pudo reclamar el ticket',
            description: 'Hubo un problema durante el proceso de reclamo.',
          }),
        ],
      allowedMentions: { repliedUser: false },
    });
  }
};

const handlePrefixCloseCommand = async (message: Message): Promise<void> => {
  if (!(await ensureMessageInGuild(message))) {
    return;
  }

  const channel = await ensureTextChannelFromMessage(
    message,
    'Para cerrar un ticket ejecuta el comando dentro del canal middleman.',
  );

  if (!channel) {
    return;
  }

  const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

  if (!ticket) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Ticket no encontrado',
          description: 'No existe un ticket de middleman asociado a este canal.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return;
  }

  try {
    await closeUseCase.execute(ticket.id, BigInt(message.author.id), channel);

    const participants = await ticketRepo.listParticipants(ticket.id);
    const reviewerIds = new Set(
      participants
        .map((participant) => participant.userId.toString())
        .filter((participantId) => participantId !== message.author.id),
    );

    const reviewerMentions = Array.from(reviewerIds).map((participantId) => `<@${participantId}>`);
    const summaryIntro = reviewerMentions.length > 0
      ? `${reviewerMentions.join(' ')}\nEl middleman ha marcado el ticket como completado. Comparte tu experiencia con una resena.`
      : 'El middleman ha marcado el ticket como completado. Comparte tu experiencia con una resena.';

    const reviewEmbed = embedFactory.reviewRequest({
      middlemanTag: `<@${message.author.id}>`,
      tradeSummary: 'Haz clic en el boton para calificar al middleman que gestiono tu transaccion.',
    });

    reviewEmbed.setDescription(
      [summaryIntro, reviewEmbed.data.description ?? '']
        .filter((segment) => segment.length > 0)
        .join('\n\n'),
    );

    const inviteMessage = await channel.send(
      brandMessageOptions({
        embeds: [reviewEmbed],
        components: [buildReviewButtonRow()],
        allowedMentions: reviewerMentions.length > 0 ? { users: Array.from(reviewerIds) } : { parse: [] },
      }),
    );
    reviewInviteStore.set(inviteMessage.id, {
      ticketId: ticket.id,
      middlemanId: message.author.id,
    });

    await message.reply({
      embeds: [
        embedFactory.success({
          title: 'Ticket cerrado',
          description: 'El ticket se cerro y se pidio a los participantes que envien una resena.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    const { shouldLogStack, referenceId, embeds } = mapErrorToDiscordResponse(error);
    const logPayload = {
      err: error,
      referenceId,
      ticketId: ticket.id,
      channelId: channel.id,
      userId: message.author.id,
      source: 'prefix:middleman:close',
    };

    if (shouldLogStack) {
      logger.error(logPayload, 'Error al cerrar ticket de middleman con prefijo.');
    } else {
      logger.warn(logPayload, 'Error controlado al cerrar ticket de middleman con prefijo.');
    }

    await message.reply({
      embeds:
        embeds ?? [
          embedFactory.error({
            title: 'No se pudo cerrar el ticket',
            description: 'Hubo un problema al cerrar el ticket. Intenta nuevamente en unos minutos.',
          }),
        ],
      allowedMentions: { repliedUser: false },
    });
  }
};

const handlePrefixCloseRequestCommand = async (message: Message): Promise<void> => {
  if (!(await ensureMessageInGuild(message))) {
    return;
  }

  const channel = await ensureTextChannelFromMessage(
    message,
    'Para solicitar el cierre ejecuta el comando dentro del canal middleman.',
  );

  if (!channel) {
    return;
  }

  const ticket = await ticketRepo.findByChannelId(BigInt(channel.id));

  if (!ticket) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Ticket no encontrado',
          description: 'No existe un ticket de middleman asociado a este canal.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return;
  }

  try {
    const result = await requestClosureUseCase.execute(
      ticket.id,
      BigInt(message.author.id),
      channel,
    );

    const messageText = result.completed
      ? 'Todos los traders ya confirmaron el cierre. Puedes proceder a finalizar el ticket.'
      : result.alreadyPending
        ? 'Se actualizo el panel de confirmacion para que los traders registren su cierre.'
        : 'Se publico el panel de confirmacion para que los traders registren su cierre.';

    await message.reply({
      embeds: [
        embedFactory.success({
          title: 'Solicitud de cierre enviada',
          description: messageText,
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
  } catch (error) {
    const { shouldLogStack, referenceId, embeds } = mapErrorToDiscordResponse(error);
    const logPayload = {
      err: error,
      referenceId,
      ticketId: ticket.id,
      channelId: channel.id,
      userId: message.author.id,
      source: 'prefix:middleman:close-request',
    };

    if (shouldLogStack) {
      logger.error(logPayload, 'Error al solicitar cierre de trade con prefijo.');
    } else {
      logger.warn(logPayload, 'Error controlado al solicitar cierre de trade con prefijo.');
    }

    await message.reply({
      embeds:
        embeds ?? [
          embedFactory.error({
            title: 'No se pudo solicitar el cierre',
            description: 'Hubo un problema durante la solicitud. Intenta nuevamente o contacta al staff.',
          }),
        ],
      allowedMentions: { repliedUser: false },
    });
  }
};



export const middlemanCommand: Command = {
  data: new SlashCommandBuilder()

    .setName('middleman')

    .setDescription('Sistema de middleman del servidor')

    .addSubcommand((sub) => sub.setName('open').setDescription('Abrir ticket de middleman'))

    .addSubcommand((sub) => sub.setName('claim').setDescription('Reclamar ticket (solo middlemen)'))

    .addSubcommand((sub) =>
      sub.setName('close').setDescription('Cerrar ticket (solo middleman asignado)'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('close-request')
        .setDescription('Solicitar confirmacion de cierre a los traders (solo middleman asignado)'),
    )
    .addSubcommand((sub) =>
      sub.setName('panel').setDescription('Publicar el panel informativo de middleman'),
    ),

  category: 'Middleman',

  examples: [
    '/middleman open',
    '/middleman claim',
    '/middleman close',
    '/middleman close-request',
    '/middleman panel',
    `${env.COMMAND_PREFIX}middleman open @usuario descripcion`,
    `${env.COMMAND_PREFIX}middleman claim`,
    `${env.COMMAND_PREFIX}middleman close`,
    `${env.COMMAND_PREFIX}middleman close-request`,
  ],

  prefix: {
    name: 'middleman',
    async execute(message, args) {
      const [rawSubcommand, ...rest] = args;
      const subcommand = rawSubcommand?.toLowerCase();

      if (!subcommand || subcommand === 'panel') {
        const panel = buildMiddlemanPanelMessage();

        if (!isSendableChannel(message.channel)) {
          logger.warn(
            { channelId: message.channel?.id ?? null, messageId: message.id },
            'No se pudo enviar el panel de middleman desde texto: canal no soporta envios.',
          );

          return;
        }

        await message.channel.send(
          brandMessageOptions({
            ...panel,
            allowedMentions: { parse: [] },
          }),
        );

        return;
      }

      if (subcommand === 'open') {
        await handlePrefixOpenCommand(message, rest);
        return;
      }

      if (subcommand === 'claim') {
        await handlePrefixClaimCommand(message);
        return;
      }

      if (subcommand === 'close') {
        await handlePrefixCloseCommand(message);
        return;
      }

      if (subcommand === 'close-request') {
        await handlePrefixCloseRequestCommand(message);
        return;
      }

      await message.reply({
        embeds: [
          embedFactory.warning({
            title: 'Subcomando no reconocido',
            description:
              'Opciones validas: `panel`, `open`, `claim`, `close`, `close-request`. Usa `;middleman panel` para publicar el panel.',
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

      case 'close-request':
        await handleCloseRequest(interaction);

        break;

      case 'panel':
        await handlePanel(interaction);

        break;

      default:
        await interaction.reply(
          brandReplyOptions({
            embeds: [
              embedFactory.error({
                title: 'Subcomando no disponible',

                description: 'La accion solicitada no est implementada.',
              }),
            ],

            flags: MessageFlags.Ephemeral,
          }),
        );
    }
  },
};

export const middlemanReviewUseCase = submitReviewUseCase;




















