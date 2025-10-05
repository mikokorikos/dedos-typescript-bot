// ============================================================================
// RUTA: src/application/usecases/middleman/ClaimTradeUseCase.ts
// ============================================================================

import type { TextChannel } from 'discord.js';
import type { Logger } from 'pino';

import { type ClaimTicketDTO, ClaimTicketSchema } from '@/application/dto/ticket.dto';
import { TicketStatus } from '@/domain/entities/types';
import type { IMiddlemanRepository } from '@/domain/repositories/IMiddlemanRepository';
import type { ITicketRepository } from '@/domain/repositories/ITicketRepository';
import { middlemanCardGenerator } from '@/infrastructure/external/MiddlemanCardGenerator';
import type { EmbedFactory } from '@/presentation/embeds/EmbedFactory';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';
import {
  TicketAlreadyClaimedError,
  TicketNotFoundError,
  UnauthorizedActionError,
} from '@/shared/errors/domain.errors';
import { brandMessageOptions } from '@/shared/utils/branding';

export class ClaimTradeUseCase {
  public constructor(
    private readonly ticketRepo: ITicketRepository,
    private readonly middlemanRepo: IMiddlemanRepository,
    private readonly logger: Logger,
    private readonly embeds: EmbedFactory = embedFactory,
  ) {}

  public async execute(dto: ClaimTicketDTO, channel: TextChannel): Promise<void> {
    const payload = ClaimTicketSchema.parse(dto);
    const ticket = await this.ticketRepo.findById(payload.ticketId);

    if (!ticket) {
      throw new TicketNotFoundError(String(payload.ticketId));
    }

    if (ticket.status === TicketStatus.CLAIMED || ticket.assignedMiddlemanId) {
      throw new TicketAlreadyClaimedError(ticket.id);
    }

    const middlemanId = BigInt(payload.middlemanId);
    const isMiddleman = await this.middlemanRepo.isMiddleman(middlemanId);
    if (!isMiddleman) {
      throw new UnauthorizedActionError('middleman:claim');
    }

    const existingClaim = await this.middlemanRepo.getClaimByTicket(ticket.id);
    if (existingClaim) {
      throw new TicketAlreadyClaimedError(ticket.id);
    }

    ticket.claim(middlemanId);

    await this.middlemanRepo.createClaim(ticket.id, middlemanId);
    await this.ticketRepo.update(ticket);

    const profile = await this.middlemanRepo.getProfile(middlemanId);
    const averageRating = profile && profile.ratingCount > 0 ? profile.ratingSum / profile.ratingCount : null;
    const ratingLabel =
      profile && averageRating !== null
        ? `${'⭐'.repeat(Math.round(averageRating))}${'☆'.repeat(5 - Math.round(averageRating))} (${averageRating.toFixed(2)} / 5 · ${profile.ratingCount} reseñas)`
        : 'Sin reseñas registradas';
    const robloxUsername = profile?.primaryIdentity?.username ?? 'Sin registrar';
    const vouches = profile?.vouches ?? 0;

    const middlemanMention = `<@${payload.middlemanId}>`;
    const middlemanMember = await channel.guild.members.fetch(payload.middlemanId).catch(() => null);

    const baseUser = middlemanMember?.user ?? (await channel.client.users.fetch(payload.middlemanId).catch(() => null));
    const needsProfileRefresh =
      baseUser !== null && (baseUser.banner === undefined || baseUser.accentColor === undefined);
    const canFetchProfile = Boolean(baseUser && typeof baseUser.fetch === 'function');
    const enrichedUser =
      baseUser && needsProfileRefresh && canFetchProfile
        ? await baseUser
            .fetch(true)
            .then((user) => user)
            .catch(() => baseUser)
        : baseUser;

    const middlemanDisplayName =
      middlemanMember?.displayName ?? enrichedUser?.globalName ?? enrichedUser?.username ?? null;
    const middlemanAvatarUrl =
      (enrichedUser && typeof enrichedUser.displayAvatarURL === 'function'
        ? enrichedUser.displayAvatarURL({ size: 256 })
        : undefined) ??
      (middlemanMember && typeof middlemanMember.displayAvatarURL === 'function'
        ? middlemanMember.displayAvatarURL({ size: 256 })
        : undefined);
    const middlemanBannerUrl =
      enrichedUser && typeof enrichedUser.bannerURL === 'function'
        ? enrichedUser.bannerURL({ size: 2048 }) ?? undefined
        : undefined;
    const accentHex =
      enrichedUser && 'hexAccentColor' in enrichedUser
        ? (enrichedUser.hexAccentColor as string | null)
        : null;


    const cardAttachment = await middlemanCardGenerator.renderProfileCard({
      discordTag: middlemanMention,
      discordDisplayName: middlemanDisplayName,
      discordAvatarUrl: middlemanAvatarUrl,

      discordBannerUrl: middlemanBannerUrl,
      accentColor: accentHex,

      profile,
      highlight: 'Disponible para asistencia',
    });

    await channel.permissionOverwrites.edit(payload.middlemanId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      ManageMessages: false,
      ManageChannels: false,
    });

    const infoEmbed = this.embeds.info({
      title: '🛡️ Middleman asignado',
      description: [
        `**Aviso:** ${middlemanMention} ha reclamado este ticket.`,
        '',
        `**Middleman:** ${middlemanMention}`,
        `**Roblox:** ${robloxUsername}`,
        `**Vouches acumulados:** ${vouches}`,
        `**Calificacion:** ${ratingLabel}`,
      ].join('\n'),
    });

    const accentColorNumber = accentHex ? Number.parseInt(accentHex.replace('#', ''), 16) : undefined;
    const decorations = {
      ...(cardAttachment ? { useHeroImage: true } : {}),
      ...(accentColorNumber !== undefined ? { color: accentColorNumber } : {}),
    };

    await channel.send(
      brandMessageOptions(
        {
          embeds: [infoEmbed],
          files: cardAttachment ? [cardAttachment] : [],
          allowedMentions: { users: [payload.middlemanId] },
        },
        decorations,
      ),
    );


    this.logger.info(
      { ticketId: ticket.id, channelId: channel.id, middlemanId: payload.middlemanId },
      'Ticket reclamado correctamente.',
    );
  }
}
