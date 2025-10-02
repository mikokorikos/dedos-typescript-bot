// ============================================================================
// RUTA: src/presentation/commands/tickets/tickets.ts
// ============================================================================

import {
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildMember,
  SlashCommandBuilder,
} from 'discord.js';

import { OpenSupportTicketUseCase } from '@/application/usecases/tickets/OpenSupportTicketUseCase';
import { TicketType } from '@/domain/entities/types';
import { prisma } from '@/infrastructure/db/prisma';
import { PrismaTicketRepository } from '@/infrastructure/repositories/PrismaTicketRepository';
import type { Command } from '@/presentation/commands/types';
import { MiddlemanModal } from '@/presentation/components/modals/MiddlemanModal';
import { registerSelectMenuHandler } from '@/presentation/components/registry';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import {
  buildTicketPanelMessage,
  resolveTicketType,
  TICKET_PANEL_MENU_ID,
} from '@/presentation/tickets/TicketPanelBuilder';
import { env } from '@/shared/config/env';
import { mapErrorToDiscordResponse } from '@/shared/errors/discord-error-mapper';
import { ValidationFailedError } from '@/shared/errors/domain.errors';
import { logger } from '@/shared/logger/pino';

const ticketRepository = new PrismaTicketRepository(prisma);

const supportTicketUseCase = new OpenSupportTicketUseCase(
  ticketRepository,
  logger,
  {
    categoryId: env.TICKET_CATEGORY_ID ?? '',
    staffRoleIds: env.TICKET_STAFF_ROLE_IDS,
    maxTicketsPerUser: env.TICKET_MAX_PER_USER,
    cooldownMs: env.TICKET_COOLDOWN_MS,
  },
  embedFactory,
);

const ensureGuildMember = (member: unknown): GuildMember => {
  if (!member || typeof member !== 'object' || !('user' in member)) {
    throw new ValidationFailedError({
      member: 'No fue posible identificar al miembro que solicitó el ticket.',
    });
  }

  return member as GuildMember;
};

registerSelectMenuHandler(TICKET_PANEL_MENU_ID, async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply({
      embeds: [
        embedFactory.error({
          title: 'Acción no disponible',
          description: 'Este menú solo puede usarse dentro de un servidor de Discord.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  try {
    const type = resolveTicketType(interaction);

    if (type === TicketType.MM) {
      await interaction.showModal(MiddlemanModal.build());
      return;
    }

    const member = ensureGuildMember(interaction.member);

    await interaction.deferReply({ ephemeral: true });

    const { ticket, channel } = await supportTicketUseCase.execute({
      guild: interaction.guild,
      member,
      type,
    });

    await interaction.editReply({
      embeds: [
        embedFactory.success({
          title: 'Ticket creado',
          description: `Tu ticket #${ticket.id} está listo en ${channel.toString()}.`,
        }),
      ],
    });
  } catch (error) {
    const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);

    if (shouldLogStack) {
      logger.error({ err: error, referenceId }, 'Error inesperado al crear ticket de soporte.');
    } else {
      logger.warn({ err: error, referenceId }, 'Error controlado al crear ticket de soporte.');
    }

    if (interaction.deferred || interaction.replied) {
      const { ephemeral, flags, ...editPayload } = payload;
      await interaction.editReply({
        ...editPayload,
        embeds:
          embeds ?? [
            embedFactory.error({
              title: 'No se pudo crear el ticket',
              description: 'Verifica los requisitos e inténtalo nuevamente más tarde.',
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
            title: 'No se pudo crear el ticket',
            description: 'Verifica los requisitos e inténtalo nuevamente más tarde.',
          }),
        ],
      ephemeral: true,
    });
  }
});

const publishTicketPanel = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const panel = buildTicketPanelMessage();

  await interaction.reply({
    ...panel,
    allowedMentions: { parse: [] },
  });
};

export const ticketsPanelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Publica el panel interactivo para crear tickets de soporte.'),
  category: 'Tickets',
  examples: ['/tickets', `${env.COMMAND_PREFIX}tickets`],
  prefix: {
    name: 'tickets',
    async execute(message) {
      if (message.channel.type !== ChannelType.GuildText) {
        await message.reply({
          embeds: [
            embedFactory.warning({
              title: 'Canal no compatible',
              description: 'El panel solo puede publicarse en canales de texto del servidor.',
            }),
          ],
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      const panel = buildTicketPanelMessage();
      await message.channel.send({
        ...panel,
        allowedMentions: { parse: [] },
      });
    },
  },
  async execute(interaction) {
    await publishTicketPanel(interaction);
  },
};
