// ============================================================================
// RUTA: src/presentation/middleman/TradePanelRenderer.ts
// ============================================================================

import type { TextChannel } from 'discord.js';
import type { Logger } from 'pino';

import { tradePanelStore } from '@/application/services/TradePanelStore';
import type { Ticket } from '@/domain/entities/Ticket';
import type { Trade } from '@/domain/entities/Trade';
import { TicketStatus } from '@/domain/entities/types';
import type { ITicketRepository } from '@/domain/repositories/ITicketRepository';
import type { ITradeRepository } from '@/domain/repositories/ITradeRepository';
import { buildTradePanelButtons } from '@/presentation/components/buttons/TradePanelButtons';
import type { EmbedFactory } from '@/presentation/embeds/EmbedFactory';
import { embedFactory } from '@/presentation/embeds/EmbedFactory';

const hasDescriptionMetadata = (
  value: unknown,
): value is { description?: unknown } => typeof value === 'object' && value !== null && 'description' in value;

const formatTradeSummary = (trade: Trade | undefined): string => {
  if (!trade) {
    return [
      '• Roblox: ❌ Sin registrar',
      '• Oferta: ❌ Sin registrar',
      '• Confirmación: ⏳ Pendiente',
    ].join('\n');
  }

  const metadata = trade.items[0]?.metadata;
  const rawDescription = hasDescriptionMetadata(metadata) ? metadata.description : null;
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : null;

  return [
    `• Roblox: **${trade.robloxUsername}**`,
    description ? `• Oferta: ${description}` : '• Oferta: ❌ Sin registrar',
    `• Confirmación: ${trade.confirmed ? '✅ Registrada' : '⏳ Pendiente'}`,
  ].join('\n');
};

const resolvePartnerId = (
  ticket: Ticket,
  participants: Awaited<ReturnType<ITicketRepository['listParticipants']>>,
): bigint | null => {
  const partner = participants.find((participant) => participant.userId !== ticket.ownerId);
  return partner?.userId ?? null;
};

export class TradePanelRenderer {
  public constructor(
    private readonly ticketRepo: ITicketRepository,
    private readonly tradeRepo: ITradeRepository,
    private readonly logger: Logger,
    private readonly embeds: EmbedFactory = embedFactory,
  ) {}

  public async render(channel: TextChannel, ticketId: number): Promise<void> {
    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket) {
      this.logger.warn({ ticketId, channelId: channel.id }, 'No se pudo renderizar panel: ticket inexistente.');
      return;
    }

    const [participants, trades] = await Promise.all([
      this.ticketRepo.listParticipants(ticket.id),
      this.tradeRepo.findByTicketId(ticket.id),
    ]);

    const ownerMention = `<@${ticket.ownerId.toString()}>`;
    const partnerId = resolvePartnerId(ticket, participants);
    const partnerMention = partnerId ? `<@${partnerId.toString()}>` : 'Pendiente de registrar';

    const ownerTrade = trades.find((trade) => trade.userId === ticket.ownerId);
    const partnerTrade = partnerId ? trades.find((trade) => trade.userId === partnerId) : undefined;

    const everyoneConfirmed =
      trades.length >= 2 && trades.every((trade) => trade.confirmed) && ticket.status === TicketStatus.CONFIRMED;

    const embed = this.embeds.middlemanPanel({
      ticketId: ticket.id,
      buyerTag: ownerMention,
      sellerTag: partnerMention,
      status: everyoneConfirmed ? 'Trade listo para middleman' : 'Pendiente de confirmación',
      notes: [
        `**${ownerMention}**\n${formatTradeSummary(ownerTrade)}`,
        `**${partnerMention}**\n${formatTradeSummary(partnerTrade)}`,
      ].join('\n\n'),
    });

    const canConfirm = Boolean(ownerTrade && partnerTrade && !everyoneConfirmed);

    const payload: Parameters<TextChannel['send']>[0] = {
      embeds: [embed],
      components: [buildTradePanelButtons({ canConfirm })],
      allowedMentions: { parse: [] },
    };

    const storedMessageId = tradePanelStore.get(channel.id);

    if (storedMessageId) {
      try {
        const message = await channel.messages.fetch(storedMessageId);
        await message.edit(payload);
        return;
      } catch (error) {
        this.logger.warn(
          { channelId: channel.id, messageId: storedMessageId, err: error },
          'No se pudo actualizar el panel existente, se enviará uno nuevo.',
        );
        tradePanelStore.delete(channel.id);
      }
    }

    const message = await channel.send(payload);
    tradePanelStore.set(channel.id, message.id);
  }
}
