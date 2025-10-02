// ============================================================================
// RUTA: src/presentation/commands/middleman/mm.ts
// ============================================================================

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import { prisma } from '@/infrastructure/db/prisma';
import { PrismaMiddlemanRepository } from '@/infrastructure/repositories/PrismaMiddlemanRepository';
import type { Command } from '@/presentation/commands/types';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import { mapErrorToDiscordResponse } from '@/shared/errors/discord-error-mapper';
import { UnauthorizedActionError } from '@/shared/errors/domain.errors';
import { logger } from '@/shared/logger/pino';

const middlemanDirectoryRepo = new PrismaMiddlemanRepository(prisma);

const ensureCanManageDirectory = (interaction: ChatInputCommandInteraction): void => {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return;
  }

  throw new UnauthorizedActionError('middleman:directory');
};

const handleAdd = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  ensureCanManageDirectory(interaction);

  const target = interaction.options.getUser('usuario', true);
  const robloxUsername = interaction.options.getString('roblox', true);

  await middlemanDirectoryRepo.upsertProfile({
    userId: BigInt(target.id),
    robloxUsername,
  });

  await interaction.reply({
    embeds: [
      embedFactory.success({
        title: 'Middleman registrado',
        description: `${target.toString()} ahora forma parte del directorio de middlemen con el usuario Roblox **${robloxUsername}**.`,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
};

const handleSet = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  ensureCanManageDirectory(interaction);

  const target = interaction.options.getUser('usuario', true);
  const robloxUsername = interaction.options.getString('roblox');

  await middlemanDirectoryRepo.updateProfile({
    userId: BigInt(target.id),
    robloxUsername: robloxUsername ?? null,
  });

  await interaction.reply({
    embeds: [
      embedFactory.success({
        title: 'Middleman actualizado',
        description: robloxUsername
          ? `${target.toString()} ahora utiliza el usuario Roblox **${robloxUsername}**.`
          : `${target.toString()} mantiene su información pero se actualizó la ficha.`,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
};

const handleStats = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const target = interaction.options.getUser('usuario') ?? interaction.user;
  const profile = await middlemanDirectoryRepo.getProfile(BigInt(target.id));

  if (!profile) {
    await interaction.reply({
      embeds: [
        embedFactory.warning({
          title: 'Sin datos registrados',
          description: `${target.toString()} todavía no cuenta con estadísticas como middleman.`,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const average = profile.ratingCount > 0 ? profile.ratingSum / profile.ratingCount : 0;
  const robloxUsername = profile.primaryIdentity?.username ?? 'Sin registrar';
  const description = [
    `• Usuario de Roblox: **${robloxUsername}**`,
    `• Vouches registrados: **${profile.vouches}**`,
    `• Valoraciones recibidas: **${profile.ratingCount}**`,
    `• Promedio actual: **${average.toFixed(2)} ⭐**`,
  ].join('\n');

  await interaction.reply({
    embeds: [
      embedFactory.info({
        title: `Estadísticas de ${target.username}`,
        description,
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
};

const handleList = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const limit = interaction.options.getInteger('limite') ?? 10;
  const profiles = await middlemanDirectoryRepo.listTopProfiles(limit);

  if (profiles.length === 0) {
    await interaction.reply({
      embeds: [
        embedFactory.info({
          title: 'Directorio vacío',
          description: 'Aún no se registran middlemen en el sistema.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = profiles.map((profile, index) => {
    const average = profile.ratingCount > 0 ? profile.ratingSum / profile.ratingCount : 0;
    const robloxUsername = profile.primaryIdentity?.username ?? 'Sin registrar';
    return `${index + 1}. <@${profile.userId.toString()}> — Roblox: **${robloxUsername}** | Vouches: ${profile.vouches} | Rating: ${average.toFixed(2)} (${profile.ratingCount})`;
  });

  await interaction.reply({
    embeds: [
      embedFactory.info({
        title: 'Top middlemen',
        description: lines.join('\n'),
      }),
    ],
    flags: MessageFlags.Ephemeral,
  });
};

export const middlemanDirectoryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('mm')
    .setDescription('Herramientas para gestionar el directorio de middlemen')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Registrar un nuevo middleman')
        .addUserOption((option) => option.setName('usuario').setDescription('Usuario de Discord').setRequired(true))
        .addStringOption((option) =>
          option
            .setName('roblox')
            .setDescription('Usuario de Roblox asociado')
            .setMinLength(3)
            .setMaxLength(50)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Actualizar la ficha de un middleman existente')
        .addUserOption((option) => option.setName('usuario').setDescription('Usuario de Discord').setRequired(true))
        .addStringOption((option) =>
          option
            .setName('roblox')
            .setDescription('Nuevo usuario de Roblox (opcional)')
            .setMinLength(3)
            .setMaxLength(50)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('Consultar estadísticas de un middleman')
        .addUserOption((option) => option.setName('usuario').setDescription('Usuario a consultar').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Mostrar el top de middlemen registrados')
        .addIntegerOption((option) =>
          option
            .setName('limite')
            .setDescription('Cantidad de resultados a mostrar (1-50)')
            .setMinValue(1)
            .setMaxValue(50)
            .setRequired(false),
        ),
    ),
  category: 'Middleman',
  examples: ['/mm add @usuario Mikokorikos', '/mm stats @usuario', '/mm list'],
  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'add':
          await handleAdd(interaction);
          break;
        case 'set':
          await handleSet(interaction);
          break;
        case 'stats':
          await handleStats(interaction);
          break;
        case 'list':
          await handleList(interaction);
          break;
        default:
          await interaction.reply({
            embeds: [
              embedFactory.warning({
                title: 'Acción no disponible',
                description: 'El subcomando solicitado no está implementado.',
              }),
            ],
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const { shouldLogStack, referenceId, embeds, ...payload } = mapErrorToDiscordResponse(error);

      if (shouldLogStack) {
        logger.error({ err: error, referenceId }, 'Error inesperado en comando /mm.');
      } else {
        logger.warn({ err: error, referenceId }, 'Error controlado en comando /mm.');
      }

      await interaction.reply({
        ...payload,
        embeds:
          embeds ?? [
            embedFactory.error({
              title: 'No se pudo completar la acción',
              description: 'Ocurrió un problema al ejecutar el comando.',
            }),
          ],
      });
    }
  },
};
