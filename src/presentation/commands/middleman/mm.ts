// ============================================================================
// RUTA: src/presentation/commands/middleman/mm.ts
// ============================================================================

import type { ChatInputCommandInteraction, GuildMember, Message } from 'discord.js';
import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { MiddlemanProfile } from '@/domain/repositories/IMiddlemanRepository';
import { parseMiddlemanCardConfig } from '@/domain/value-objects/MiddlemanCardConfig';
import { prisma } from '@/infrastructure/db/prisma';
import { middlemanCardGenerator } from '@/infrastructure/external/MiddlemanCardGenerator';
import { PrismaMiddlemanRepository } from '@/infrastructure/repositories/PrismaMiddlemanRepository';
import type { Command } from '@/presentation/commands/types';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import { env } from '@/shared/config/env';
import { mapErrorToDiscordResponse } from '@/shared/errors/discord-error-mapper';
import { UnauthorizedActionError } from '@/shared/errors/domain.errors';
import { logger } from '@/shared/logger/pino';
import {
  brandEditReplyOptions,
  brandReplyOptions,
} from '@/shared/utils/branding';

const middlemanDirectoryRepo = new PrismaMiddlemanRepository(prisma);
const integerFormatter = new Intl.NumberFormat('es-MX');

const MENTION_PATTERN = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/u;

const parseCardConfigInput = (raw: string | null): { value: ReturnType<typeof parseMiddlemanCardConfig> | null | undefined; error?: string } => {
  if (raw === null || raw === undefined) {
    return { value: undefined };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { value: undefined };
  }

  if (trimmed.toLowerCase() === 'reset') {
    return { value: null };
  }

  try {
    const parsedJson = JSON.parse(trimmed);
    return { value: parseMiddlemanCardConfig(parsedJson) };
  } catch {
    return {
      value: undefined,
      error: 'Formato de decoración inválido. Proporciona JSON válido o utiliza "reset".',
    };
  }
};


const ensureMessageCanManageDirectory = async (message: Message): Promise<GuildMember | null> => {
  if (!message.guild) {
    await message.reply({
      embeds: [
        embedFactory.error({
          title: 'Accion no disponible',
          description: 'Este comando solo puede utilizarse dentro de un servidor.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return null;
  }

  const existingMember = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));

  if (!existingMember) {
    await message.reply({
      embeds: [
        embedFactory.error({
          title: 'No se pudo validar permisos',
          description: 'No pude obtener tu informacion dentro del servidor.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return null;
  }

  const hasManageGuild = existingMember.permissions.has(PermissionFlagsBits.ManageGuild);
  const adminRole = env.ADMIN_ROLE_ID;
  const isAdminRole = adminRole ? existingMember.roles.cache.has(adminRole) : false;

  if (!hasManageGuild && !isAdminRole) {
    await message.reply({
      embeds: [
        embedFactory.error({
          title: 'Permisos insuficientes',
          description: 'Requieres Manage Guild o el rol administrador configurado en el bot.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });

    return null;
  }

  return existingMember;
};

const extractUserIdFromArg = (message: Message, rawArg?: string): string | null => {
  const mention = message.mentions.users.first();
  if (mention) {
    return mention.id;
  }

  if (!rawArg) {
    return null;
  }

  const match = MENTION_PATTERN.exec(rawArg);
  if (!match) {
    return null;
  }

  return match[1] ?? match[2] ?? null;
};

const ensureCanManageDirectory = (interaction: ChatInputCommandInteraction): void => {
  const hasManageGuild = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  const member = interaction.member;
  const adminRole = env.ADMIN_ROLE_ID;
  let isAdminRole = false;
  if (adminRole && member && 'roles' in member) {
    const guildMember = member as GuildMember;
    isAdminRole = Boolean(guildMember.roles?.cache?.has?.(adminRole));
  }

  if (hasManageGuild || isAdminRole) {
    return;
  }

  throw new UnauthorizedActionError('middleman:directory');
};

const handleAdd = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  ensureCanManageDirectory(interaction);

  const target = interaction.options.getUser('usuario', true);
  const robloxUsername = interaction.options.getString('roblox', true);
  const decorOption = interaction.options.getString('decor');
  const { value: cardConfig, error } = parseCardConfigInput(decorOption);

  if (error) {
    await interaction.editReply(
      brandEditReplyOptions({
        embeds: [
          embedFactory.error({
            title: 'Decoración inválida',
            description: error,
          }),
        ],
      }),
    );

    return;
  }

  await middlemanDirectoryRepo.upsertProfile({
    userId: BigInt(target.id),
    robloxUsername,
    cardConfig: cardConfig ?? undefined,
  });

  const decorMessage = cardConfig === null
    ? ' Se restableció la decoración al diseño predeterminado.'
    : cardConfig
    ? ' Se aplicó la decoración personalizada.'
    : '';

  await interaction.editReply(
    brandEditReplyOptions({
      embeds: [
        embedFactory.success({
          title: 'Middleman registrado',
          description: `${target.toString()} ahora forma parte del directorio de middlemen con el usuario Roblox **${robloxUsername}**.${decorMessage}`,
        }),
      ],
    }),
  );
};

const handleSet = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  ensureCanManageDirectory(interaction);

  const target = interaction.options.getUser('usuario', true);
  const robloxUsername = interaction.options.getString('roblox');
  const decorOption = interaction.options.getString('decor');
  const { value: cardConfig, error } = parseCardConfigInput(decorOption);

  if (error) {
    await interaction.editReply(
      brandEditReplyOptions({
        embeds: [
          embedFactory.error({
            title: 'Decoración inválida',
            description: error,
          }),
        ],
      }),
    );

    return;
  }

  const updatePayload: { userId: bigint; robloxUsername?: string | null; cardConfig?: ReturnType<typeof parseMiddlemanCardConfig> | null } = {
    userId: BigInt(target.id),
    robloxUsername: robloxUsername ?? null,
  };

  if (cardConfig !== undefined) {
    updatePayload.cardConfig = cardConfig;
  }

  await middlemanDirectoryRepo.updateProfile(updatePayload);

  const decorMessage = cardConfig === null
    ? ' Se restableció la decoración al diseño predeterminado.'
    : cardConfig
    ? ' Se aplicó la decoración personalizada.'
    : '';
  const baseDescription = robloxUsername
    ? `${target.toString()} ahora utiliza el usuario Roblox **${robloxUsername}**.`
    : `${target.toString()} mantiene su informacion pero se actualizo la ficha.`;

  await interaction.editReply(
    brandEditReplyOptions({
      embeds: [
        embedFactory.success({
          title: 'Middleman actualizado',
          description: `${baseDescription}${decorMessage}`,
        }),
      ],
    }),
  );
};

interface StatsViewModel {
  readonly average: number;
  readonly robloxUsername: string;
  readonly metrics: ReadonlyArray<{ label: string; value: string; emphasis?: boolean }>;
  readonly subtitleParts: string[];
}

const buildStatsViewModel = (profile: MiddlemanProfile): StatsViewModel => {
  const average = profile.ratingCount > 0 ? profile.ratingSum / profile.ratingCount : 0;
  const robloxUsername = profile.primaryIdentity?.username ?? 'Sin registrar';
  const metrics: StatsViewModel['metrics'] = [
    {
      label: 'Vouches',
      value: integerFormatter.format(profile.vouches),
      emphasis: true,
    },
    {
      label: 'Valoraciones',
      value: integerFormatter.format(profile.ratingCount),
    },
    {
      label: 'Promedio',
      value: `${average.toFixed(2)} / 5 ⭐`,
    },
  ];

  const subtitleParts = [`Roblox: ${robloxUsername}`];
  if (profile.cardConfig.highlight) {
    subtitleParts.push(profile.cardConfig.highlight);
  }

  return {
    average,
    robloxUsername,
    metrics,
    subtitleParts,
  };
};

const handleStats = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const target = interaction.options.getUser('usuario') ?? interaction.user;
  const profile = await middlemanDirectoryRepo.getProfile(BigInt(target.id));

  if (!profile) {
    await interaction.editReply({
      embeds: [
        embedFactory.warning({
          title: 'Sin datos registrados',
          description: `${target.toString()} todava no cuenta con estadsticas como middleman.`,
        }),
      ],
    });
    return;
  }


  const statsView = buildStatsViewModel(profile);


  logger.info(
    {
      command: 'mm.stats',
      targetId: target.id,
      paletteAccent: profile.cardConfig.accent,

      metrics: statsView.metrics,
      format: 'gif',

    },
    'Generando estadisticas de middleman.',
  );

  const statsCard = await middlemanCardGenerator.renderStatsCard({
    title: `Estadsticas de ${target.username}`,
    subtitle: subtitleParts.join(' • '),
    metrics,
    paletteOverrides: {
      backgroundStart: profile.cardConfig.gradientStart,
      backgroundEnd: profile.cardConfig.gradientEnd,
      accent: profile.cardConfig.accent,
      highlight: profile.cardConfig.accent,
      highlightSoft: profile.cardConfig.accentSoft,
    },
    pattern: profile.cardConfig.pattern,
    watermark: profile.cardConfig.watermark ?? null,
  });

  if (statsCard) {
    logger.info(
      {
        command: 'mm.stats',
        targetId: target.id,
        attachmentName: statsCard.name,
      },
      'Enviando tarjeta de estadisticas de middleman con decoracion personalizada.',
    );

    await interaction.editReply(
      brandEditReplyOptions({
        embeds: [
          embedFactory.info({
            title: `Estadsticas de ${target.username}`,
            description: `Se adjunta la tarjeta de estadsticas actualizada con los colores configurados por ${target.toString()}.`,
          }),
        ],
        files: [statsCard],
      }),
    );
    return;
  }

  logger.warn(
    {
      command: 'mm.stats',
      targetId: target.id,
    },
    'Fallo la generacion de la tarjeta de estadisticas, respondiendo con embed de texto.',
  );

  const description = [
    ` Usuario de Roblox: **${statsView.robloxUsername}**`,
    ` Vouches registrados: **${profile.vouches}**`,
    ` Valoraciones recibidas: **${profile.ratingCount}**`,
    ` Promedio actual: **${statsView.average.toFixed(2)} **`,
  ].join('\n');

  await interaction.editReply(
    brandEditReplyOptions({
      embeds: [
        embedFactory.info({
          title: `Estadsticas de ${target.username}`,
          description,
        }),
      ],
    }),
  );
};

const handleList = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const limit = interaction.options.getInteger('limite') ?? 10;
  const profiles = await middlemanDirectoryRepo.listTopProfiles(limit);

  if (profiles.length === 0) {
    await interaction.reply({
      embeds: [
        embedFactory.info({
          title: 'Directorio vaco',
          description: 'Aon no se registran middlemen en el sistema.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = profiles.map((profile, index) => {
    const average = profile.ratingCount > 0 ? profile.ratingSum / profile.ratingCount : 0;
    const robloxUsername = profile.primaryIdentity?.username ?? 'Sin registrar';
    return `${index + 1}. <@${profile.userId.toString()}>  Roblox: **${robloxUsername}** | Vouches: ${profile.vouches} | Rating: ${average.toFixed(2)} (${profile.ratingCount})`;
  });

  await interaction.editReply(
    brandEditReplyOptions({
      embeds: [
        embedFactory.info({
          title: 'Top middlemen',
          description: lines.join('\n'),
        }),
      ],
    }),
  );
};

const handlePrefixDirectoryAdd = async (message: Message, args: ReadonlyArray<string>): Promise<void> => {
  const [userArg, ...rawParts] = args;

  if (!userArg || rawParts.length === 0) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Uso del comando',
          description: 'Sintaxis: `;mm add @usuario roblox_username [decor_json|reset]`',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const member = await ensureMessageCanManageDirectory(message);
  if (!member) {
    return;
  }

  const targetId = extractUserIdFromArg(message, userArg);
  if (!targetId) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Usuario invalido',
          description: 'Menciona al usuario de Discord o proporciona su ID numerico.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  let decorRaw: string | null = null;
  let usernameTokens = rawParts;

  for (let i = 0; i < rawParts.length; i += 1) {
    const token = rawParts[i];
    if (!token) {
      continue;
    }

    if (token.toLowerCase() === 'reset') {
      decorRaw = 'reset';
      usernameTokens = rawParts.slice(0, i);
      break;
    }

    if (token.startsWith('{')) {
      decorRaw = rawParts.slice(i).join(' ').trim();
      usernameTokens = rawParts.slice(0, i);
      break;
    }
  }

  const robloxUsername = usernameTokens.join(' ').trim();
  if (robloxUsername.length < 3 || robloxUsername.length > 50) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Usuario de Roblox invalido',
          description: 'Debe tener entre 3 y 50 caracteres.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const { value: cardConfig, error } = parseCardConfigInput(decorRaw);

  if (error) {
    await message.reply({
      embeds: [
        embedFactory.error({
          title: 'Decoración inválida',
          description: error,
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  await middlemanDirectoryRepo.upsertProfile({
    userId: BigInt(targetId),
    robloxUsername,
    cardConfig: cardConfig ?? undefined,
  });

  const decorMessage = cardConfig === null
    ? ' Se restableció la decoración al diseño predeterminado.'
    : cardConfig
    ? ' Se aplicó la decoración personalizada.'
    : '';

  await message.reply({
    embeds: [
      embedFactory.success({
        title: 'Middleman registrado',
        description: `<@${targetId}> ahora forma parte del directorio de middlemen con el usuario Roblox **${robloxUsername}**.${decorMessage}`,
      }),
    ],
    allowedMentions: { repliedUser: false },
  });
};

const handlePrefixDirectorySet = async (message: Message, args: ReadonlyArray<string>): Promise<void> => {
  const [userArg, ...rawParts] = args;

  if (!userArg) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Uso del comando',
          description: 'Sintaxis: `;mm set @usuario [roblox_username] [decor_json|reset]`',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const member = await ensureMessageCanManageDirectory(message);
  if (!member) {
    return;
  }

  const targetId = extractUserIdFromArg(message, userArg);
  if (!targetId) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Usuario invalido',
          description: 'Menciona al usuario de Discord o proporciona su ID numerico.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  let decorRaw: string | null = null;
  let usernameTokens = rawParts;

  for (let i = 0; i < rawParts.length; i += 1) {
    const token = rawParts[i];
    if (!token) {
      continue;
    }

    if (token.toLowerCase() === 'reset') {
      decorRaw = 'reset';
      usernameTokens = rawParts.slice(0, i);
      break;
    }

    if (token.startsWith('{')) {
      decorRaw = rawParts.slice(i).join(' ').trim();
      usernameTokens = rawParts.slice(0, i);
      break;
    }
  }

  const robloxUsername = usernameTokens.join(' ').trim();
  if (robloxUsername && (robloxUsername.length < 3 || robloxUsername.length > 50)) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Usuario de Roblox invalido',
          description: 'Debe tener entre 3 y 50 caracteres.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const { value: cardConfig, error } = parseCardConfigInput(decorRaw);

  if (error) {
    await message.reply({
      embeds: [
        embedFactory.error({
          title: 'Decoración inválida',
          description: error,
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const updatePayload: { userId: bigint; robloxUsername?: string | null; cardConfig?: ReturnType<typeof parseMiddlemanCardConfig> | null } = {
    userId: BigInt(targetId),
  };

  if (robloxUsername.length > 0) {
    updatePayload.robloxUsername = robloxUsername;
  }

  if (cardConfig !== undefined) {
    updatePayload.cardConfig = cardConfig;
  }

  await middlemanDirectoryRepo.updateProfile(updatePayload);

  const decorMessage = cardConfig === null
    ? ' Se restableció la decoración al diseño predeterminado.'
    : cardConfig
    ? ' Se aplicó la decoración personalizada.'
    : '';
  const baseDescription = robloxUsername.length > 0
    ? `<@${targetId}> ahora utiliza el usuario Roblox **${robloxUsername}**.`
    : `<@${targetId}> mantiene su informacion pero se actualizo la ficha.`;

  await message.reply({
    embeds: [
      embedFactory.success({
        title: 'Middleman actualizado',
        description: `${baseDescription}${decorMessage}`,
      }),
    ],
    allowedMentions: { repliedUser: false },
  });
};

const handlePrefixDirectoryStats = async (message: Message, args: ReadonlyArray<string>): Promise<void> => {
  const [userArg] = args;
  const targetId = extractUserIdFromArg(message, userArg) ?? message.author.id;
  const profile = await middlemanDirectoryRepo.getProfile(BigInt(targetId));

  if (!profile) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Sin datos registrados',
          description: `<@${targetId}> todavia no tiene estadisticas como middleman.`,
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const statsView = buildStatsViewModel(profile);
  const cachedMentionUser = message.mentions.users.first();
  const targetUser =
    cachedMentionUser?.id === targetId
      ? cachedMentionUser
      : await message.client.users.fetch(targetId).catch(() => null);
  const displayName = targetUser?.username ?? `Usuario ${targetId}`;

  logger.info(
    {
      command: 'mm.stats.prefix',
      targetId,
      paletteAccent: profile.cardConfig.accent,
      metrics: statsView.metrics,
      format: 'gif',
    },
    'Generando estadisticas de middleman via prefijo.',
  );

  const statsCard = await middlemanCardGenerator.renderStatsCard({
    title: `Estadsticas de ${displayName}`,
    subtitle: statsView.subtitleParts.join(' • '),
    metrics: statsView.metrics,
    paletteOverrides: {
      backgroundStart: profile.cardConfig.gradientStart,
      backgroundEnd: profile.cardConfig.gradientEnd,
      accent: profile.cardConfig.accent,
      highlight: profile.cardConfig.accent,
      highlightSoft: profile.cardConfig.accentSoft,
    },
    pattern: profile.cardConfig.pattern,
    watermark: profile.cardConfig.watermark ?? null,
  });

  if (statsCard) {
    logger.info(
      {
        command: 'mm.stats.prefix',
        targetId,
        attachmentName: statsCard.name,
        format: 'gif',
      },
      'Enviando tarjeta de estadisticas en formato GIF via prefijo.',
    );

    await message.reply({
      content: `Tarjeta de estadsticas de <@${targetId}> generada con la decoracion configurada.`,
      files: [statsCard],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  logger.warn(
    {
      command: 'mm.stats.prefix',
      targetId,
      format: 'gif',
    },
    'No se pudo generar la tarjeta de estadisticas GIF, respondiendo con embed de texto.',
  );

  const description = [
    `- Usuario de Roblox: **${statsView.robloxUsername}**`,
    `- Vouches registrados: **${profile.vouches}**`,
    `- Valoraciones recibidas: **${profile.ratingCount}**`,
    `- Promedio actual: **${statsView.average.toFixed(2)}**`,
  ].join('\n');

  await message.reply({
    embeds: [
      embedFactory.info({
        title: `Estadisticas de ${displayName}`,
        description,
      }),
    ],
    allowedMentions: { repliedUser: false },
  });
};

const handlePrefixDirectoryList = async (message: Message, args: ReadonlyArray<string>): Promise<void> => {
  const [limitArg] = args;
  let limit = Number.parseInt(limitArg ?? '', 10);
  if (!Number.isFinite(limit)) {
    limit = 10;
  }

  if (limit < 1 || limit > 50) {
    await message.reply({
      embeds: [
        embedFactory.warning({
          title: 'Limite invalido',
          description: 'El limite debe estar entre 1 y 50.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const profiles = await middlemanDirectoryRepo.listTopProfiles(limit);

  if (profiles.length === 0) {
    await message.reply({
      embeds: [
        embedFactory.info({
          title: 'Sin middlemen registrados',
          description: 'Todavia no existen perfiles en el directorio.',
        }),
      ],
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  const lines = profiles
    .map((profile, index) => {
      const position = index + 1;
      const average = profile.ratingCount > 0 ? profile.ratingSum / profile.ratingCount : 0;
      const robloxUsername = profile.primaryIdentity?.username ?? 'Sin registrar';
      return `${position}. <@${profile.userId.toString()}> - Roblox: ${robloxUsername} - Vouches: ${profile.vouches} - Rating: ${average.toFixed(2)}`;
    })
    .join('\n');

  await message.reply({
    embeds: [
      embedFactory.info({
        title: 'Directorio de middlemen',
        description: lines,
      }),
    ],
    allowedMentions: { repliedUser: false },
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
        )
        .addStringOption((option) =>
          option
            .setName('decor')
            .setDescription('Configuración JSON para la tarjeta (usa "reset" para restablecer)')
            .setRequired(false),
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
        )
        .addStringOption((option) =>
          option
            .setName('decor')
            .setDescription('Configuración JSON para personalizar la tarjeta (usa "reset" para restablecer)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('stats')
        .setDescription('Consultar estadisticas de un middleman')
        .addUserOption((option) => option.setName('usuario').setDescription('Usuario a consultar').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Ver el top de middlemen registrados')
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
  examples: [
    '/mm add @usuario Mikokorikos',
    '/mm stats @usuario',
    '/mm list',
    `${env.COMMAND_PREFIX}mm add @usuario roblox_username`,
    `${env.COMMAND_PREFIX}mm stats`,
    `${env.COMMAND_PREFIX}mm list`,
  ],
  prefix: {
    name: 'mm',
    aliases: ['middlemandir'],
    async execute(message, args) {
      const [rawSubcommand, ...rest] = args;
      const subcommand = rawSubcommand?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        await message.reply({
          embeds: [
            embedFactory.info({
              title: 'Uso de ;mm',
              description: 'Subcomandos: `add`, `set`, `stats`, `list`. Ejemplo: `;mm add @usuario roblox_username`.',
            }),
          ],
          allowedMentions: { repliedUser: false },
        });
        return;
      }

      if (subcommand === 'add') {
        await handlePrefixDirectoryAdd(message, rest);
        return;
      }

      if (subcommand === 'set') {
        await handlePrefixDirectorySet(message, rest);
        return;
      }

      if (subcommand === 'stats') {
        await handlePrefixDirectoryStats(message, rest);
        return;
      }

      if (subcommand === 'list') {
        await handlePrefixDirectoryList(message, rest);
        return;
      }

      await message.reply({
        embeds: [
          embedFactory.warning({
            title: 'Subcomando no reconocido',
            description: 'Usa `add`, `set`, `stats` o `list` para gestionar el directorio.',
          }),
        ],
        allowedMentions: { repliedUser: false },
      });
    },
  },
  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
                title: 'Accion no disponible',
                description: 'El subcomando solicitado no est implementado.',
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

      if (interaction.deferred || interaction.replied) {
        const { flags, ...editPayload } = payload;
        await interaction.editReply(
          brandEditReplyOptions({
            ...editPayload,
            embeds:
              embeds ?? [
                embedFactory.error({
                  title: 'No se pudo completar la accion',
                description: 'Ocurrio un problema al ejecutar el comando.',
                }),
              ],
          }),
        );
      } else {
        await interaction.reply(
          brandReplyOptions({
            ...payload,
            embeds:
              embeds ?? [
                embedFactory.error({
                  title: 'No se pudo completar la accion',
                  description: 'Ocurrio un problema al ejecutar el comando.',
                }),
              ],
            flags: MessageFlags.Ephemeral,
          }),
        );
      }
    }
  },
};
