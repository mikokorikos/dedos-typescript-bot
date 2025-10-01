// ============================================================================
// RUTA: src/presentation/embeds/EmbedFactory.ts
// ============================================================================

import type { APIEmbedField } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

import { COLORS, EMBED_LIMITS } from '@/shared/config/constants';
import { clampEmbedField, splitIntoEmbedFields, truncateText } from '@/shared/utils/discord.utils';

interface BaseEmbed {
  readonly title?: string;
  readonly description?: string;
  readonly fields?: ReadonlyArray<APIEmbedField>;
  readonly footer?: string;
  readonly timestamp?: Date;
}

interface TicketEmbedData {
  readonly ticketId: string | number;
  readonly type: string;
  readonly ownerTag: string;
  readonly description: string;
}

interface MiddlemanPanelData {
  readonly ticketId: string | number;
  readonly buyerTag: string;
  readonly sellerTag: string;
  readonly status: string;
  readonly notes?: string;
}

interface ReviewRequestData {
  readonly middlemanTag: string;
  readonly tradeSummary: string;
}

interface ReviewPublishedData {
  readonly ticketId: number;
  readonly middlemanTag: string;
  readonly reviewerTag: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly averageRating: number;
}

interface StatsEmbedData {
  readonly title: string;
  readonly stats: Record<string, string | number>;
}

export class EmbedFactory {
  public success(payload: BaseEmbed): EmbedBuilder {
    return this.base({
      color: COLORS.success,
      title: payload.title ?? 'Operación exitosa',
      description: payload.description,
      fields: payload.fields,
      footer: payload.footer,
      timestamp: payload.timestamp ?? new Date(),
    });
  }

  public error(payload: BaseEmbed): EmbedBuilder {
    return this.base({
      color: COLORS.danger,
      title: payload.title ?? 'Ha ocurrido un problema',
      description: payload.description,
      fields: payload.fields,
      footer: payload.footer,
      timestamp: payload.timestamp ?? new Date(),
    });
  }

  public info(payload: BaseEmbed): EmbedBuilder {
    return this.base({
      color: COLORS.info,
      title: payload.title ?? 'Información',
      description: payload.description,
      fields: payload.fields,
      footer: payload.footer,
      timestamp: payload.timestamp ?? new Date(),
    });
  }

  public warning(payload: BaseEmbed): EmbedBuilder {
    return this.base({
      color: COLORS.warning,
      title: payload.title ?? 'Atención requerida',
      description: payload.description,
      fields: payload.fields,
      footer: payload.footer,
      timestamp: payload.timestamp ?? new Date(),
    });
  }

  public ticketCreated(data: TicketEmbedData): EmbedBuilder {
    return this.base({
      color: COLORS.primary,
      title: `Ticket #${data.ticketId} creado`,
      description: data.description,
      fields: [
        { name: 'Tipo', value: clampEmbedField(data.type), inline: true },
        { name: 'Propietario', value: clampEmbedField(data.ownerTag), inline: true },
      ],
    });
  }

  public middlemanPanel(data: MiddlemanPanelData): EmbedBuilder {
    return this.base({
      color: COLORS.primary,
      title: `Panel middleman #${data.ticketId}`,
      description: data.notes ?? 'Gestiona la transacción desde este panel.',
      fields: [
        { name: 'Comprador', value: clampEmbedField(data.buyerTag), inline: true },
        { name: 'Vendedor', value: clampEmbedField(data.sellerTag), inline: true },
        { name: 'Estado', value: clampEmbedField(data.status), inline: true },
      ],
    });
  }

  public reviewRequest(data: ReviewRequestData): EmbedBuilder {
    return this.base({
      color: COLORS.info,
      title: 'Cuéntanos tu experiencia',
      description: data.tradeSummary,
      fields: [{ name: 'Middleman', value: clampEmbedField(data.middlemanTag), inline: true }],
    });
  }

  public reviewPublished(data: ReviewPublishedData): EmbedBuilder {
    const fullStars = '⭐'.repeat(data.rating);
    const emptyStars = '☆'.repeat(Math.max(0, 5 - data.rating));
    const formattedAverage = data.averageRating.toFixed(2);

    const commentBlock = data.comment
      ? `\n\n${truncateText(data.comment, EMBED_LIMITS.description)}`
      : '';

    return this.base({
      color: COLORS.success,
      title: `Nueva reseña para ${data.middlemanTag}`,
      description: `${fullStars}${emptyStars}${commentBlock}`,
      fields: [
        {
          name: 'Ticket',
          value: clampEmbedField(`#${data.ticketId}`),
          inline: true,
        },
        {
          name: 'Autor',
          value: clampEmbedField(data.reviewerTag),
          inline: true,
        },
        {
          name: 'Promedio actualizado',
          value: clampEmbedField(`${formattedAverage} ⭐`),
          inline: true,
        },
      ],
      footer: data.comment ? undefined : 'Sin comentarios adicionales.',
    });
  }

  public stats(data: StatsEmbedData): EmbedBuilder {
    const fields = Object.entries(data.stats).map(([key, value]) => ({
      name: truncateText(key, EMBED_LIMITS.fieldName),
      value: clampEmbedField(String(value)),
      inline: true,
    }));

    return this.base({
      color: COLORS.info,
      title: data.title,
      fields,
    });
  }

  private base(options: {
    readonly color: number;
    readonly title: string;
    readonly description?: string;
    readonly fields?: ReadonlyArray<APIEmbedField>;
    readonly footer?: string;
    readonly timestamp?: Date;
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(options.color)
      .setTitle(truncateText(options.title, EMBED_LIMITS.title));

    if (options.description) {
      const truncatedDescription = truncateText(options.description, EMBED_LIMITS.description);
      embed.setDescription(truncatedDescription);

      if (options.description.length > EMBED_LIMITS.description) {
        const overflow = options.description.slice(EMBED_LIMITS.description);
        const extraFields = splitIntoEmbedFields(overflow).map((value, index) => ({
          name: `Detalle ${index + 1}`,
          value: clampEmbedField(value),
        }));
        embed.addFields(extraFields.slice(0, EMBED_LIMITS.maxFields));
      }
    }

    if (options.fields) {
      const sanitized = options.fields.slice(0, EMBED_LIMITS.maxFields).map((field) => ({
        name: truncateText(field.name, EMBED_LIMITS.fieldName),
        value: clampEmbedField(field.value),
        inline: field.inline ?? false,
      }));

      embed.addFields(sanitized);
    }

    if (options.footer) {
      embed.setFooter({ text: truncateText(options.footer, EMBED_LIMITS.footerText) });
    }

    embed.setTimestamp(options.timestamp ?? new Date());

    return embed;
  }
}

export const embedFactory = new EmbedFactory();
