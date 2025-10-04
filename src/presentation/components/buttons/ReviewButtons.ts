// =============================================================================
// RUTA: src/presentation/components/buttons/ReviewButtons.ts
// =============================================================================

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const REVIEW_BUTTON_CUSTOM_ID = 'middleman-review';

export const buildReviewButtonRow = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(REVIEW_BUTTON_CUSTOM_ID)
      .setLabel('Enviar reseña')
      .setEmoji('⭐')
      .setStyle(ButtonStyle.Primary),
  );
