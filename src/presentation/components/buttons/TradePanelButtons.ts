// ============================================================================
// RUTA: src/presentation/components/buttons/TradePanelButtons.ts
// ============================================================================

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const TRADE_DATA_BUTTON_ID = 'middleman:trade:data';
export const TRADE_CONFIRM_BUTTON_ID = 'middleman:trade:confirm';
export const TRADE_HELP_BUTTON_ID = 'middleman:trade:help';

interface TradePanelButtonOptions {
  readonly canConfirm?: boolean;
}

export const buildTradePanelButtons = (
  options: TradePanelButtonOptions = {},
): ActionRowBuilder<ButtonBuilder> => {
  const { canConfirm = true } = options;

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(TRADE_DATA_BUTTON_ID)
      .setLabel('Mis datos de trade')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(TRADE_CONFIRM_BUTTON_ID)
      .setLabel('Confirmar trade')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canConfirm),
    new ButtonBuilder()
      .setCustomId(TRADE_HELP_BUTTON_ID)
      .setLabel('Pedir ayuda')
      .setEmoji('🚨')
      .setStyle(ButtonStyle.Danger),
  );
};
