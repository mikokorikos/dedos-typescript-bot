// ============================================================================
// RUTA: src/presentation/events/interactionCreate.ts
// ============================================================================

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { Events } from 'discord.js';

import { commandRegistry } from '@/presentation/commands';
import {
  buttonHandlers,
  modalHandlers,
  selectMenuHandlers,
} from '@/presentation/components/registry';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import type { EventDescriptor } from '@/presentation/events/types';
import { mapErrorToDiscordResponse } from '@/shared/errors/discord-error-mapper';
import { logger } from '@/shared/logger/pino';

const handleChatInput = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const command = commandRegistry.get(interaction.commandName);

  if (!command) {
    logger.warn({ commandName: interaction.commandName }, 'Se intentó ejecutar un comando no registrado.');
    await interaction.reply({
      embeds: [
        embedFactory.warning({
          title: 'Comando no disponible',
          description: 'El comando solicitado ya no está registrado. Usa `/help` para ver la lista actual.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  await command.execute(interaction);
};

const handleButton = async (interaction: ButtonInteraction): Promise<void> => {
  const handler = buttonHandlers.get(interaction.customId);

  if (!handler) {
    logger.warn({ customId: interaction.customId }, 'No existe handler registrado para el botón.');
    await interaction.reply({
      embeds: [
        embedFactory.warning({
          title: 'Acción no disponible',
          description:
            'Este botón ya no está activo. Recarga la interfaz o ejecuta nuevamente el comando para obtener una versión actualizada.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  await handler(interaction);
};

const handleModal = async (interaction: ModalSubmitInteraction): Promise<void> => {
  const handler = modalHandlers.get(interaction.customId);

  if (!handler) {
    logger.warn({ customId: interaction.customId }, 'No existe handler registrado para el modal.');
    await interaction.reply({
      embeds: [
        embedFactory.warning({
          title: 'Formulario expirado',
          description: 'Este formulario ya no es válido. Intenta ejecutar nuevamente el flujo desde el comando original.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  await handler(interaction);
};

const handleSelectMenu = async (interaction: StringSelectMenuInteraction): Promise<void> => {
  const handler = selectMenuHandlers.get(interaction.customId);

  if (!handler) {
    logger.warn({ customId: interaction.customId }, 'No existe handler registrado para el menú.');
    await interaction.reply({
      embeds: [
        embedFactory.warning({
          title: 'Acción no disponible',
          description:
            'Este menú ya no está activo. Vuelve a ejecutar el comando para obtener una versión actualizada.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  await handler(interaction);
};

export const interactionCreateEvent: EventDescriptor<typeof Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        await handleChatInput(interaction);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModal(interaction);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(interaction);
        return;
      }
    } catch (error) {
      const { shouldLogStack, referenceId, ...response } = mapErrorToDiscordResponse(error);
      const baseLog = {
        interactionType: interaction.type,
        userId: interaction.user?.id,
        referenceId,
      };

      if (shouldLogStack) {
        logger.error({ ...baseLog, err: error }, 'Error inesperado procesando interacción.');
      } else {
        logger.warn({ ...baseLog, err: error }, 'Error controlado procesando interacción.');
      }

      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(response);
        } else {
          await interaction.reply(response);
        }
      }
    }
  },
};
